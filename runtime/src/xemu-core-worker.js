// Dedicated worker that hosts the xemu WebAssembly core.
//
// This worker is Emscripten's runtime thread. main() runs on a proxied pthread
// (PROXY_TO_PTHREAD), so this thread's event loop stays free to service
// proxied syscalls (files, poll), start pthread workers and relay commands.
//
// Protocol (page -> worker): {type:'boot', ...}, {type:'command', id, cmd, arg},
// {type:'mount', ...}. Worker -> page: {type:'host-port', port} for each
// pthread worker, plus {xemu:{type,...}} events from the runtime thread.
import {buildConfigToml, CORE_PATHS} from './xemu-config.js';
import {mountOpfsFile} from './xemu-opfs-fs.js';

let Module = null;
let FS = null;
const portedWorkers = new WeakSet();

const send = (msg, transfer = []) => postMessage({xemu: msg}, transfer);

// Core logs are batched: at most one message per interval with repeated lines
// collapsed (per-line page updates were a major slowdown in the sibling
// emulator ports). The first line after a quiet period is sent at once, so a
// fatal message still reaches the page if this thread blocks right after.
const log = {lines: [], timer: 0, last: '', repeats: 0, lastSent: 0, echo: false};
function flushLog() {
  log.timer = 0;
  if (!log.lines.length) return;
  const lines = log.lines;
  log.lines = [];
  log.lastSent = performance.now();
  send({type: 'log', lines});
}
function logLine(stream, text) {
  if (log.echo) (stream === 'err' ? console.error : console.log)(text);
  if (text === log.last) {
    log.repeats++;
    return;
  }
  if (log.repeats) {
    log.lines.push({stream, text: `(previous line repeated ${log.repeats} more times)`});
    log.repeats = 0;
  }
  log.last = text;
  log.lines.push({stream, text});
  if (log.lines.length > 2000) log.lines.splice(0, log.lines.length - 2000);
  if (performance.now() - log.lastSent > 100) {
    flushLog();
  } else if (!log.timer) {
    log.timer = setTimeout(flushLog, 100);
  }
}

// Gives every pthread worker its own MessagePort to the page. Running
// pthreads never return to their event loop, so this must happen while the
// worker idles in the pool (before Emscripten posts its 'run' message).
function installHostPorts(PThread) {
  const give = worker => {
    if (!worker || portedWorkers.has(worker)) return;
    portedWorkers.add(worker);
    const channel = new MessageChannel();
    worker.postMessage({xemuHostPort: channel.port2}, [channel.port2]);
    send({type: 'host-port', port: channel.port1}, [channel.port1]);
  };
  // Emscripten has kept these as arrays or as id-keyed objects across versions.
  const workers = set => Array.isArray(set) ? set : Object.values(set || {});
  for (const w of workers(PThread.unusedWorkers)) give(w);
  for (const w of workers(PThread.runningWorkers)) give(w);
  const allocate = PThread.allocateUnusedWorker.bind(PThread);
  PThread.allocateUnusedWorker = (...args) => {
    const result = allocate(...args);
    for (const w of workers(PThread.unusedWorkers)) give(w);
    return result;
  };
}

function writeFile(path, data) {
  FS.writeFile(path, data instanceof Uint8Array ? data : new Uint8Array(data));
}

function mkdirp(path) {
  let at = '';
  for (const part of path.split('/').filter(Boolean)) {
    at += '/' + part;
    try { FS.mkdir(at); } catch (e) { /* exists */ }
  }
}

// Files from the page arrive as Blobs/Files (read lazily through WORKERFS),
// ArrayBuffers (copied into memory) or OPFS paths (read/write in place).
async function placeFile(spec, target) {
  if (!spec) return false;
  const dir = target.slice(0, target.lastIndexOf('/')) || '/';
  const name = target.slice(target.lastIndexOf('/') + 1);
  mkdirp(dir);
  if (spec.opfs) {
    await mountOpfsFile(Module, FS, spec.opfs, dir, name, {writable: !!spec.writable});
  } else if (spec instanceof Blob || spec.blob) {
    const blob = spec.blob || spec;
    if (spec.copy || blob.size <= 16 * 1024 * 1024) {
      writeFile(target, new Uint8Array(await blob.arrayBuffer()));
    } else {
      const mountDir = `${dir}/.blob-${name}`;
      mkdirp(mountDir);
      FS.mount(FS.filesystems.WORKERFS ?? Module.WORKERFS, {blobs: [{name, data: blob}]}, mountDir);
      FS.symlink(`${mountDir}/${name}`, target);
    }
  } else if (spec instanceof ArrayBuffer || ArrayBuffer.isView(spec)) {
    writeFile(target, spec instanceof ArrayBuffer ? new Uint8Array(spec) : new Uint8Array(spec.buffer, spec.byteOffset, spec.byteLength));
  } else {
    throw new Error(`Unsupported file description for ${target}`);
  }
  return true;
}

async function boot(msg) {
  log.echo = !!msg.echoLog;
  const factory = (await import(msg.coreUrl)).default;
  const started = performance.now();
  Module = await factory({
    locateFile: path => new URL(path, msg.coreUrl).href,
    print: text => logLine('out', text),
    printErr: text => logLine('err', text),
    onAbort: what => { flushLog(); send({type: 'abort', message: String(what)}); },
    onExit: status => { flushLog(); send({type: 'exited', status}); },
    ...(msg.wasmBinary ? {wasmBinary: msg.wasmBinary} : {}),
  });
  FS = Module.FS;
  installHostPorts(Module.PThread);

  mkdirp(CORE_PATHS.dir);
  const files = msg.files || {};
  const present = {
    flash: await placeFile(files.flash, CORE_PATHS.flash),
    mcpx: await placeFile(files.mcpx, CORE_PATHS.mcpx),
    hdd: await placeFile(files.hdd, CORE_PATHS.hdd),
  };
  if (files.eeprom) await placeFile(files.eeprom, CORE_PATHS.eeprom);
  let disc = '';
  if (files.disc) {
    disc = `${CORE_PATHS.media}/${files.disc.name || 'disc.iso'}`;
    await placeFile(files.disc, disc);
  }
  FS.writeFile(CORE_PATHS.config, buildConfigToml(msg.settings || {}, {...present, disc}));

  const memory = Module.wasmMemory;
  const ptr = {
    pads: Module._xemu_web_pads_ptr(),
    audio: Module._xemu_web_audio_ring_ptr(),
    stats: Module._xemu_web_stats_ptr(),
  };
  const layout = {};
  ['padSize', 'padButtons', 'padAxis', 'padRumble', 'audioSamples', 'statsLastPresent', 'audioFrames']
    .forEach((key, i) => { layout[key] = Module._xemu_web_layout(i); });

  // Shared memory goes to the page before main() so input/audio work at once.
  send({type: 'ready', memory, ptr, layout, loadMs: performance.now() - started});

  if (msg.jit === false && Module._tci_wasm_jit_set_enabled) Module._tci_wasm_jit_set_enabled(0);
  const args = ['-config_path', CORE_PATHS.config, ...(msg.args || [])];
  let rc;
  try {
    rc = Module.callMain(args);
  } catch (err) {
    send({type: 'diag', stage: 'callMain threw', message: String(err && err.stack || err)});
  }
  send({type: 'diag', stage: 'main started', rc, ...poolState()});
}

function poolState() {
  const P = Module?.PThread;
  const count = set => Array.isArray(set) ? set.length : Object.keys(set || {}).length;
  return P ? {unused: count(P.unusedWorkers), running: count(P.runningWorkers)} : {};
}

self.addEventListener('message', e => {
  if (e.data?.type === 'diag') send({type: 'diag', stage: 'probe', ...poolState()});
});

function command(msg) {
  if (!Module) throw new Error('Core is not booted');
  const arg = Module.stringToNewUTF8(msg.arg ?? '');
  try {
    const rc = Module._xemu_web_command(msg.id, msg.cmd, arg);
    if (rc !== 0) send({type: 'command-result', id: msg.id, ok: false, error: 'Unknown command'});
  } finally {
    Module._free(arg);
  }
}

// Places a file in the running core (e.g. a disc picked after boot).
async function mount(msg) {
  const path = `${CORE_PATHS.media}/${msg.name}`;
  try { FS.unlink(path); } catch (e) { /* absent */ }
  await placeFile(msg.file, path);
  send({type: 'mounted', id: msg.id, path});
}

self.onmessage = async e => {
  const msg = e.data;
  if (!msg || !msg.type) return;
  try {
    if (msg.type === 'boot') await boot(msg);
    else if (msg.type === 'command') command(msg);
    else if (msg.type === 'mount') await mount(msg);
  } catch (err) {
    send({type: 'error', message: String(err && err.stack || err), id: msg.id});
  }
};
