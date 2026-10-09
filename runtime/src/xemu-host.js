// Page-side API for the xemu WebAssembly core.
//
//   const host = new XemuHost({canvas});
//   await host.boot({files: {flash, mcpx, hdd, disc}, settings});
//   host.setPad(0, {buttons, axes});  host.pause();  host.loadDisc(file);
//
// The core runs in a dedicated worker (src/xemu-core-worker.js). Frames arrive
// as ImageBitmaps over MessagePorts straight from the GPU thread; controller
// state, audio and counters live in the core's shared wasm memory.

export const Commands = Object.freeze({
  PAUSE: 1, RESUME: 2, RESET: 3, POWER_OFF: 4, LOAD_DISC: 5, EJECT_DISC: 6,
  SAVE_SNAPSHOT: 7, LOAD_SNAPSHOT: 8, DELETE_SNAPSHOT: 9, LIST_SNAPSHOTS: 10,
  SYNC_CONTROLLERS: 11, SAVE_SETTINGS: 12, SET_SURFACE_SCALE: 13,
});

export const Buttons = Object.freeze({
  A: 1 << 0, B: 1 << 1, X: 1 << 2, Y: 1 << 3,
  DPAD_LEFT: 1 << 4, DPAD_UP: 1 << 5, DPAD_RIGHT: 1 << 6, DPAD_DOWN: 1 << 7,
  BACK: 1 << 8, START: 1 << 9, WHITE: 1 << 10, BLACK: 1 << 11,
  LSTICK: 1 << 12, RSTICK: 1 << 13, GUIDE: 1 << 14,
});

// Axis order matches ui/xemu-input.h: triggers, left stick, right stick.
export const Axes = Object.freeze({LTRIG: 0, RTRIG: 1, LSTICK_X: 2, LSTICK_Y: 3, RSTICK_X: 4, RSTICK_Y: 5});

const STATS = {presented: 0, consumed: 1, maxInflight: 2, vblanks: 3, width: 4, height: 5, paused: 6, running: 7};
const RING = {write: 0, read: 1, capacity: 2, rate: 3, active: 4, latency: 5, underruns: 6, overruns: 7};

export class XemuHost extends EventTarget {
  constructor({canvas = null, workerUrl = new URL('./xemu-core-worker.js', import.meta.url),
               coreUrl = new URL('../cores/xemu/xemu-core.js', import.meta.url)} = {}) {
    super();
    this.canvas = canvas;
    this.workerUrl = String(workerUrl);
    this.coreUrl = String(coreUrl);
    this.worker = null;
    this.memory = null;
    this.ptr = null;
    this.layout = null;
    this.nextId = 1;
    this.pending = new Map();
    this.ports = [];
    this.audio = null;
    this.frameSize = {width: 0, height: 0};
    this._ctx = null;
    this._ready = null;
  }

  /** Starts the core. Resolves once shared memory is available. */
  boot({files = {}, settings = {}, args = [], wasmBinary, echoLog = false, jit = true} = {}) {
    if (this.worker) throw new Error('Already booted');
    this.worker = new Worker(this.workerUrl, {type: 'module', name: 'xemu-core'});
    this.worker.onmessage = e => this._onWorkerMessage(e.data);
    this.worker.onerror = e => {
      const error = new Error(e.message || 'Core worker failed to load');
      this._readyReject?.(error);
      this._emit('error', {message: error.message});
    };
    const transfer = [];
    for (const value of Object.values(files)) {
      if (value instanceof ArrayBuffer) transfer.push(value);
    }
    this._ready = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });
    this.worker.postMessage({type: 'boot', coreUrl: this.coreUrl, files, settings, args, wasmBinary, echoLog, jit}, transfer);
    return this._ready;
  }

  terminate() {
    const error = new Error('Core terminated');
    this._readyReject?.(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.stopAudio();
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.ports) p.close();
    this.ports = [];
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, {detail}));
  }

  _onWorkerMessage(data) {
    if (!data) return;
    const msg = data.xemu || data;
    if (msg.type === 'error' && msg.id) {
      const pending = this.pending.get(msg.id);
      if (pending) { this.pending.delete(msg.id); pending.reject(new Error(msg.message)); }
    }
    if (msg.type === 'host-port') {
      this.ports.push(msg.port);
      msg.port.onmessage = e => this._onCoreMessage(e.data);
      return;
    }
    if (msg.type === 'ready') {
      this.memory = msg.memory;
      this.ptr = msg.ptr;
      this.layout = msg.layout;
      this.u32 = new Uint32Array(this.memory.buffer);
      this.i32 = new Int32Array(this.memory.buffer);
      this.stats = new Uint32Array(this.memory.buffer, this.ptr.stats, 8);
      this._readyResolve?.(msg);
    } else if (msg.type === 'error' && this._readyReject && !this.memory) {
      this._readyReject(new Error(msg.message));
    }
    this._onCoreMessage(msg);
  }

  _onCoreMessage(msg) {
    switch (msg.type) {
      case 'frame':
        this._drawBitmap(msg.bitmap, msg.width, msg.height);
        return;
      case 'pixels':
        this._drawPixels(msg.buffer, msg.width, msg.height);
        return;
      case 'command-result': {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          msg.ok ? p.resolve(msg) : p.reject(Object.assign(new Error(msg.error || 'Command failed'), {result: msg}));
        }
        break;
      }
      case 'mounted': {
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); p.resolve(msg.path); }
        break;
      }
      default:
        break;
    }
    this._emit(msg.type, msg);
  }

  _acknowledgeFrame(width, height) {
    if (this.stats) Atomics.add(this.stats, STATS.consumed, 1);
    if (width !== this.frameSize.width || height !== this.frameSize.height) {
      this.frameSize = {width, height};
      this._emit('resize', {width, height});
    }
    this._emit('present', {width, height});
  }

  _drawBitmap(bitmap, width, height) {
    if (this.canvas) {
      if (!this._ctx) this._ctx = this.canvas.getContext('bitmaprenderer');
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this._ctx.transferFromImageBitmap(bitmap);
    } else {
      bitmap.close();
    }
    this._acknowledgeFrame(width, height);
  }

  async _drawPixels(buffer, width, height) {
    const image = new ImageData(new Uint8ClampedArray(buffer), width, height);
    const bitmap = await createImageBitmap(image);
    this._drawBitmap(bitmap, width, height);
  }

  /** Captures the latest frame as a PNG Blob (for save-state thumbnails). */
  async snapshotCanvas(maxWidth = 320) {
    if (!this.canvas || !this.canvas.width) return null;
    const scale = Math.min(1, maxWidth / this.canvas.width);
    const out = new OffscreenCanvas(Math.round(this.canvas.width * scale), Math.round(this.canvas.height * scale));
    out.getContext('2d').drawImage(this.canvas, 0, 0, out.width, out.height);
    return out.convertToBlob({type: 'image/png'});
  }

  command(cmd, arg = '') {
    if (!this.worker) return Promise.reject(new Error('Core is not booted'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.worker.postMessage({type: 'command', id, cmd, arg: String(arg)});
    });
  }

  pause() { return this.command(Commands.PAUSE); }
  resume() { return this.command(Commands.RESUME); }
  reset() { return this.command(Commands.RESET); }
  powerOff() { return this.command(Commands.POWER_OFF); }
  ejectDisc() { return this.command(Commands.EJECT_DISC); }
  saveSnapshot(name) { return this.command(Commands.SAVE_SNAPSHOT, name); }
  loadSnapshot(name) { return this.command(Commands.LOAD_SNAPSHOT, name); }
  deleteSnapshot(name) { return this.command(Commands.DELETE_SNAPSHOT, name); }
  async listSnapshots() { return (await this.command(Commands.LIST_SNAPSHOTS)).snapshots || []; }
  setSurfaceScale(scale) { return this.command(Commands.SET_SURFACE_SCALE, scale); }

  /** Inserts a disc: a File/Blob, or {opfs: 'path'} for a cached image. */
  async loadDisc(file, name = file?.name || 'disc.iso') {
    const id = this.nextId++;
    const path = await new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.worker.postMessage({type: 'mount', id, name, file});
    });
    return this.command(Commands.LOAD_DISC, path);
  }

  /** Writes controller slot `slot` (0-3). buttons: Buttons bitmask; axes: 6 ints in [-32768, 32767]. */
  setPad(slot, {buttons = 0, axes = [0, 0, 0, 0, 0, 0]} = {}) {
    if (!this.i32) return;
    const base = (this.ptr.pads + slot * this.layout.padSize) >> 2;
    Atomics.store(this.u32, base + (this.layout.padButtons >> 2), buttons >>> 0);
    const axisBase = base + (this.layout.padAxis >> 2);
    for (let i = 0; i < 6; i++) Atomics.store(this.i32, axisBase + i, axes[i] | 0);
    Atomics.add(this.u32, base + 10, 1);
  }

  /** Plugs or unplugs controller slot `slot` in the emulated console. */
  setPadConnected(slot, connected) {
    if (!this.u32) return Promise.resolve();
    const base = (this.ptr.pads + slot * this.layout.padSize) >> 2;
    Atomics.store(this.u32, base, connected ? 1 : 0);
    return this.command(Commands.SYNC_CONTROLLERS);
  }

  /** Rumble strength requested by the game for slot `slot`, 0..65535 each. */
  getRumble(slot) {
    if (!this.u32) return [0, 0];
    const base = (this.ptr.pads + slot * this.layout.padSize + this.layout.padRumble) >> 2;
    return [Atomics.load(this.u32, base), Atomics.load(this.u32, base + 1)];
  }

  getStats() {
    if (!this.stats) return null;
    const ring = new Uint32Array(this.memory.buffer, this.ptr.audio, 8);
    return {
      framesPresented: Atomics.load(this.stats, STATS.presented),
      framesConsumed: Atomics.load(this.stats, STATS.consumed),
      vblanks: Atomics.load(this.stats, STATS.vblanks),
      width: Atomics.load(this.stats, STATS.width),
      height: Atomics.load(this.stats, STATS.height),
      running: Atomics.load(this.stats, STATS.running) === 1,
      audioQueuedFrames: (Atomics.load(ring, RING.write) - Atomics.load(ring, RING.read)) >>> 0,
      audioUnderruns: Atomics.load(ring, RING.underruns),
      audioOverruns: Atomics.load(ring, RING.overruns),
    };
  }

  /** Frames the core may have in flight before it skips presenting (default 2). */
  setMaxFramesInFlight(n) {
    if (this.stats) Atomics.store(this.stats, STATS.maxInflight, Math.max(1, n | 0));
  }

  /** Starts audio output. Must follow a user gesture in most browsers. */
  async startAudio({latencyMs = 40, volume = 1} = {}) {
    if (this.audio || !this.memory) return;
    const ring = new Uint32Array(this.memory.buffer, this.ptr.audio, 8);
    Atomics.store(ring, RING.latency, latencyMs);
    let context;
    try {
      context = new AudioContext({sampleRate: 48000, latencyHint: 'interactive'});
    } catch (e) {
      context = new AudioContext({latencyHint: 'interactive'});
    }
    await context.audioWorklet.addModule(new URL('./xemu-audio-worklet.js', import.meta.url));
    const node = new AudioWorkletNode(context, 'xemu-audio', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: {
        buffer: this.memory.buffer, ring: this.ptr.audio,
        samples: this.ptr.audio + this.layout.audioSamples,
        frames: this.layout.audioFrames,
      },
    });
    const gain = context.createGain();
    gain.gain.value = volume;
    node.connect(gain).connect(context.destination);
    await context.resume();
    Atomics.store(ring, RING.active, 1);
    this.audio = {context, node, gain};
  }

  setVolume(volume) {
    if (this.audio) this.audio.gain.gain.value = volume;
  }

  stopAudio() {
    if (!this.audio) return;
    if (this.memory) Atomics.store(new Uint32Array(this.memory.buffer, this.ptr.audio, 8), RING.active, 0);
    this.audio.context.close();
    this.audio = null;
  }
}
