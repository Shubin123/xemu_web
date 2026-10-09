import {XemuHost, Buttons} from './src/xemu-host.js';
const $ = id => document.getElementById(id);
let host, selected, paused = false;
let disks = [];
const keys = new Set();
const status = text => { $('status').textContent = text; };
const report = error => { status(error.message || String(error)); };
const action = fn => async () => { try { await fn(); } catch (e) { report(e); } };
function controls(enabled) { for (const id of ['pause','stop','audio','save','refresh']) $(id).disabled = !enabled; $('boot').disabled = enabled; }
async function importHdd(file) {
  if (!file.name.toLowerCase().endsWith('.qcow2')) throw new Error('Select a qcow2 hard disk image');
  status('Importing hard disk…');
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle('xbox-hdd.qcow2', {create:true});
  const writable = await handle.createWritable();
  try { await file.stream().pipeTo(writable); } catch (e) { await writable.abort().catch(() => {}); throw e; }
  $('storage').textContent = `Hard disk stored locally · ${(file.size / 1024 ** 3).toFixed(2)} GB`;
}
$('boot').onclick = action(async () => {
  if (!crossOriginIsolated) throw new Error('Cross-origin isolation is required. Start this page with npm start.');
  const files = {};
  for (const id of ['mcpx','flash','eeprom']) if ($(id).files[0]) files[id] = $(id).files[0];
  if (!files.mcpx || !files.flash) throw new Error('Select an MCPX boot ROM and flash BIOS');
  if ($('hdd').files[0]) await importHdd($('hdd').files[0]);
  const root = await navigator.storage.getDirectory();
  try { await root.getFileHandle('xbox-hdd.qcow2'); } catch { throw new Error('Select a hard disk image first'); }
  files.hdd = {opfs:'xbox-hdd.qcow2', writable:true};
  if (selected) files.disc = selected;
  status('Starting console…');
  $('boot').disabled = true;
  connected = [true,false,false,false];
  host = new XemuHost({canvas:$('screen')});
  for (const event of ['error','abort']) host.addEventListener(event,e => { report(e.detail); shutdown(); });
  host.addEventListener('exited',e => { status(`Console exited (${e.detail.status})`); shutdown(); });
  host.addEventListener('started',() => { status('Console running'); controls(true); });
  host.addEventListener('log',e => { $('logs').textContent = ($('logs').textContent + e.detail.lines.map(l => l.text).join('\n') + '\n').slice(-20000); });
  try { await host.boot({files,settings:{surfaceScale:Number($('scale').value)}}); }
  catch(e) { shutdown(); throw e; }
});
function shutdown() { host?.terminate(); host = null; paused = false; $('pause').textContent='Pause'; $('audio').textContent='Enable audio'; controls(false); }
$('stop').onclick = () => { shutdown(); status('Console off'); };
$('pause').onclick = action(async () => { if(paused) await host.resume(); else await host.pause(); paused=!paused; $('pause').textContent=paused?'Resume':'Pause'; status(paused?'Console paused':'Console running'); });
$('audio').onclick = action(async () => { await host.startAudio({volume:Number($('volume').value)}); $('audio').textContent='Audio enabled'; });
$('volume').oninput = () => host?.setVolume(Number($('volume').value));
$('fullscreen').onclick = action(() => $('screen').requestFullscreen());
$('scale').onchange = action(async () => { if(host) await host.setSurfaceScale(Number($('scale').value)); });
$('discs').onchange = () => { disks.push(...$('discs').files); renderLibrary(); $('discs').value=''; };
function renderLibrary() {
  $('library').replaceChildren();
  for(const file of disks) { const b=document.createElement('button'); b.textContent=file.name; b.classList.toggle('selected',selected===file); b.onclick=action(async () => { if(host) await host.loadDisc(file); selected=file; renderLibrary(); }); $('library').append(b); }
}
async function refreshStates() {
  const states=await host.listSnapshots(); $('states').replaceChildren();
  for(const entry of states) { const name=typeof entry==='string'?entry:entry.name; const row=document.createElement('div'); const label=document.createElement('span'); label.textContent=name; row.append(label); for(const [text,fn] of [['Load',()=>host.loadSnapshot(name)],['Delete',async()=>{await host.deleteSnapshot(name);await refreshStates();}]]) {const b=document.createElement('button');b.textContent=text;b.onclick=action(fn);row.append(b);} $('states').append(row); }
}
$('save').onclick=action(async()=>{ const name=$('state-name').value.trim(); if(!name) throw new Error('Enter a state name'); await host.saveSnapshot(name); await refreshStates(); });
$('refresh').onclick=action(refreshStates);
const keyboard={ArrowLeft:Buttons.DPAD_LEFT,ArrowRight:Buttons.DPAD_RIGHT,ArrowUp:Buttons.DPAD_UP,ArrowDown:Buttons.DPAD_DOWN,KeyZ:Buttons.A,KeyX:Buttons.B,KeyA:Buttons.X,KeyS:Buttons.Y,Enter:Buttons.START,Backspace:Buttons.BACK};
for(const type of ['keydown','keyup']) window.addEventListener(type,e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return; if(keyboard[e.code]||['KeyQ','KeyW'].includes(e.code)){e.preventDefault();type==='keydown'?keys.add(e.code):keys.delete(e.code);}});
window.addEventListener('blur',()=>keys.clear());
let connected=[true,false,false,false];
function input() {
  if(host?.memory) {
    const pads=navigator.getGamepads?.()||[];
    for(let slot=0;slot<4;slot++) {
      const pad=pads[slot]; const present=slot===0||!!pad;
      if(present!==connected[slot]){connected[slot]=present;host.setPadConnected(slot,present).catch(report);}
      let buttons=0; const axes=[0,0,0,0,0,0];
      if(slot===0){for(const k of keys) buttons|=keyboard[k]||0;axes[0]=keys.has('KeyQ')?32767:0;axes[1]=keys.has('KeyW')?32767:0;}
      if(pad?.mapping==='standard') {
        const map=[Buttons.A,Buttons.B,Buttons.X,Buttons.Y,Buttons.WHITE,Buttons.BLACK,0,0,Buttons.BACK,Buttons.START,Buttons.LSTICK,Buttons.RSTICK,Buttons.DPAD_UP,Buttons.DPAD_DOWN,Buttons.DPAD_LEFT,Buttons.DPAD_RIGHT];
        pad.buttons.forEach((b,i)=>{if(b.pressed)buttons|=map[i]||0;});
        axes[0]=Math.round((pad.buttons[6]?.value||0)*32767);axes[1]=Math.round((pad.buttons[7]?.value||0)*32767);
        for(let i=0;i<4;i++) axes[i+2]=Math.round((pad.axes[i]||0)*32767)*(i%2?-1:1);
      }
      host.setPad(slot,{buttons,axes});
    }
  }
  requestAnimationFrame(input);
}
input();
setInterval(()=>{const s=host?.getStats();if(s)$('stats').textContent=`${s.width} × ${s.height} · ${s.framesConsumed} frames · audio queue ${s.audioQueuedFrames} frames`;},1000);
window.addEventListener('beforeunload',()=>host?.terminate());
if(!crossOriginIsolated)status('Start with npm start to enable browser threads');
