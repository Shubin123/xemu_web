import {XemuHost} from './src/xemu-host.js';
import {readCatalog,writeCatalog,importFile,removeFile,storageSummary} from './storage.js';
import {installInput} from './input.js';
import {showLoading,hideLoading,downloadEngine} from './loading.js';
const $=id=>document.getElementById(id);
let host, selected, paused=false, busy=false, sound=false;
let catalog={console:{},discs:[]}, discs=[];
const status=text=>{$('status').textContent=text;};
const report=error=>{hideLoading();status(error.message||String(error));};
function controls() {
  for(const id of ['pause','stop','reset','audio','save','refresh','eject'])$(id).disabled=!host?.memory||busy;
  $('boot').disabled=!!host||busy;
  for(const id of ['mcpx','flash','hdd','eeprom','renderer','memory'])$(id).disabled=!!host||busy;
}
const action=fn=>async()=>{if(busy)return;busy=true;controls();try{await fn();}catch(e){report(e);}finally{busy=false;controls();}};
function labelFile(kind, name) {document.querySelector(`label[for="${kind}"]`).textContent=name||`Choose ${kind==='hdd'?'hard disk image':kind.toUpperCase()}…`;}
for(const kind of ['mcpx','flash','hdd','eeprom'])$(kind).onchange=()=>labelFile(kind,$(kind).files[0]?.name||catalog.console[kind]?.name);
async function copyFile(file, label) {
  status(`Importing ${label}…`);showLoading(`Importing ${label}…`,0,'0%');
  try {return await importFile(file,ratio=>showLoading(`Importing ${label}…`,ratio,`${Math.round(ratio*100)}%`));}
  finally {hideLoading();}
}
async function updateStorage() {try{$('storage').textContent=`Files saved on this device. ${await storageSummary()}`;}catch{$('storage').textContent='Browser storage unavailable.';}}
async function prepareConsole() {
  if(!catalog.console.mcpx&&!$('mcpx').files[0]||!catalog.console.flash&&!$('flash').files[0])throw Error('Select an MCPX boot ROM and flash BIOS');
  if(!catalog.console.hdd&&!$('hdd').files[0])throw Error('Select a qcow2 hard disk image');
  for(const kind of ['mcpx','flash','hdd','eeprom']) {
    const file=$(kind).files[0];if(!file)continue;
    if(kind==='hdd') {
      if(!file.name.toLowerCase().endsWith('.qcow2'))throw Error('Select a qcow2 hard disk image');
      const magic=new Uint8Array(await file.slice(0,4).arrayBuffer());
      if(magic.length!==4||magic[0]!==0x51||magic[1]!==0x46||magic[2]!==0x49||magic[3]!==0xfb)throw Error('This file is not a qcow2 disk image');
      if(catalog.console.hdd&&!confirm('Use this new hard disk? The previous browser copy and its saves will be kept, but will no longer be the active disk.'))throw Error('Hard disk change cancelled');
    }
    const entry=await copyFile(file,file.name);
    catalog.console[kind]=entry;await writeCatalog(catalog);$(kind).value='';labelFile(kind,entry.name);
  }
  await updateStorage();
  const files={};for(const [kind,entry]of Object.entries(catalog.console))files[kind]={opfs:entry.opfs,writable:kind==='hdd'||kind==='eeprom'};
  return files;
}
async function bootConsole(){
  showLoading('Preparing console…');
  await window.xemuIsolationReady;
  if(!crossOriginIsolated)throw Error('Browser threads are unavailable. Reload the page or use a browser that allows the isolation service worker.');
  const files=await prepareConsole();if(selected)files.disc=selected.file||{opfs:selected.opfs};
  const wasmBinary=await downloadEngine();
  showLoading('Initializing engine…');
  status('Starting console…');host=new XemuHost({canvas:$('screen')});
  const current=host;
  for(const type of ['error','abort'])current.addEventListener(type,e=>{if(current!==host)return;report(e.detail);shutdown();});
  current.addEventListener('exited',e=>{if(current!==host)return;status(`Console exited (${e.detail.status})`);shutdown();});
  current.addEventListener('started',()=>{if(current===host){hideLoading();status('Console running');controls();}});
  current.addEventListener('log',e=>{$('logs').textContent=($('logs').textContent+e.detail.lines.map(l=>l.text).join('\n')+'\n').slice(-20000);});
  try{await current.boot({files,wasmBinary,settings:{renderer:$('renderer').value,memory:$('memory').value,surfaceScale:Number($('scale').value)}});}catch(e){shutdown();throw e;}
}
$('boot').onclick=action(bootConsole);
function shutdown() {hideLoading();host?.terminate();host=null;paused=false;sound=false;clearInput();$('pause').textContent='Pause';$('audio').textContent='Enable audio';controls();}
$('stop').onclick=()=>{shutdown();status('Console off');};
$('pause').onclick=action(async()=>{if(paused)await host.resume();else await host.pause();paused=!paused;$('pause').textContent=paused?'▶ Run / Resume':'Pause';status(paused?'Console paused':'Console running');});
$('reset').onclick=action(()=>host.reset());
$('eject').onclick=action(async()=>{await host.ejectDisc();selected=null;renderLibrary();});
$('audio').onclick=action(async()=>{if(sound){host.stopAudio();sound=false;}else{await host.startAudio({volume:Number($('volume').value),latencyMs:Number($('latency').value)});sound=true;}$('audio').textContent=sound?'🔇 Disable audio':'🔊 Enable audio';});
$('volume').oninput=()=>{$('volume-value').textContent=`${Math.round(Number($('volume').value)*100)}%`;host?.setVolume(Number($('volume').value));saveSettings();};
$('latency').onchange=saveSettings;
$('scale').onchange=action(async()=>{saveSettings();if(host)await host.setSurfaceScale(Number($('scale').value));});
for(const id of ['renderer','memory','touch-mode'])$(id).addEventListener('change',saveSettings);
function saveSettings(){try{localStorage.setItem('xemu-settings',JSON.stringify(Object.fromEntries(['renderer','memory','touch-mode','scale','volume','latency','filtering'].map(id=>[id,$(id).value]))));}catch{}}
try{const settings=JSON.parse(localStorage.getItem('xemu-settings')||'{}');for(const [id,value]of Object.entries(settings)){if(!$(id))continue;if($(id).tagName==='SELECT'&&![...$(id).options].some(o=>o.value===value))continue;$(id).value=value;}}catch{}
function filtering(){$('screen').style.imageRendering=$('filtering').value;saveSettings();}
$('filtering').onchange=filtering;filtering();$('volume-value').textContent=`${Math.round(Number($('volume').value)*100)}%`;
async function fullscreen(){if(document.fullscreenElement)await document.exitFullscreen();else await $('screen-stage').requestFullscreen();}
$('fullscreen').onclick=$('stage-fullscreen').onclick=$('exit-fullscreen').onclick=()=>fullscreen().catch(report);
window.addEventListener('keydown',e=>{if(e.altKey&&e.code==='Enter'){e.preventDefault();fullscreen().catch(report);}});
$('clear-log').onclick=()=>{$('logs').textContent='';};
$('browse-library').onclick=()=>{$('library-section').scrollIntoView({behavior:'smooth'});$('library-search').focus({preventScroll:true});};
$('keymap-toggle').onclick=()=>{const card=document.querySelector('[data-widget="keymap"]');window.XemuLayout.show('keymap');card.scrollIntoView({behavior:'smooth'});};
$('discs').onchange=()=>{for(const file of $('discs').files)discs.push({id:crypto.randomUUID(),name:file.name,size:file.size,added:Date.now(),file});$('discs').value='';renderLibrary();};
$('library-search').oninput=renderLibrary;$('library-sort').onchange=renderLibrary;
function discButton(text,fn){const b=document.createElement('button');b.className='btn btn-secondary library-action';b.textContent=text;b.onclick=action(fn);return b;}
function renderLibrary(){
  $('library').replaceChildren();const query=$('library-search').value.toLowerCase().trim();
  const filtered=discs.filter(d=>d.name.toLowerCase().includes(query)).sort((a,b)=>$('library-sort').value==='size'?b.size-a.size:$('library-sort').value==='recent'?b.added-a.added:a.name.localeCompare(b.name));
  $('library-count-badge').textContent=`${discs.length} game${discs.length===1?'':'s'}`;$('library-empty').hidden=filtered.length>0;
  $('library-empty').textContent=discs.length?'No matching games found.':'No games yet. Add a local Xbox disc image.';
  $('selected-disc').textContent=selected?`Selected: ${selected.name}`:'No disc selected — boot dashboard.';
  for(const disc of filtered){const tr=document.createElement('tr');tr.classList.toggle('selected',disc===selected);
    const title=document.createElement('td');title.textContent=disc.name;const size=document.createElement('td');size.textContent=`${(disc.size/1024**3).toFixed(2)} GB`;
    const actions=document.createElement('td');actions.append(discButton(disc===selected?'Selected':'Load & Run',async()=>{if(host)await host.loadDisc(disc.file||{opfs:disc.opfs},disc.name);selected=disc;renderLibrary();if(host)status('Disc inserted.');else await bootConsole();}));
    if(!disc.opfs)actions.append(discButton('Import',async()=>{const entry=await copyFile(disc.file,disc.name);Object.assign(disc,entry);delete disc.file;catalog.discs.push({id:disc.id,...entry});await writeCatalog(catalog);await updateStorage();renderLibrary();status('Disc saved in browser storage.');}));
    actions.append(discButton(disc.opfs?'Delete copy':'Remove',async()=>{if(host&&disc===selected)throw Error('Eject this disc before removing it.');if(disc.opfs){if(!confirm(`Delete the browser copy of ${disc.name}? Your original file is unchanged.`))return;await removeFile(disc);catalog.discs=catalog.discs.filter(d=>d.id!==disc.id);await writeCatalog(catalog);}discs=discs.filter(d=>d!==disc);if(selected===disc)selected=null;renderLibrary();}));
    title.append(document.createElement('br'));const badge=document.createElement('small');badge.className='mode-help';badge.textContent=disc.opfs?'Saved in browser':'Local file · this session';title.append(badge);
    tr.append(title,size,actions);$('library').append(tr);
  }
}
async function refreshStates(){
  const states=await host.listSnapshots();$('states').replaceChildren();
  if(!states.length){const p=document.createElement('p');p.className='mode-help';p.textContent='No saved states on this hard disk.';$('states').append(p);}
  for(const entry of states){const name=typeof entry==='string'?entry:entry.name;const row=document.createElement('div');row.className='save-entry';const label=document.createElement('span');label.textContent=name;row.append(label);
    for(const [text,fn]of [['Load',async()=>{await host.loadSnapshot(name);status(`Loaded ${name}`);}],['Delete',async()=>{if(confirm(`Delete saved state ${name}?`)){await host.deleteSnapshot(name);await refreshStates();}}]]){const b=document.createElement('button');b.className='btn btn-secondary';b.textContent=text;b.onclick=action(fn);row.append(b);}$('states').append(row);
  }
}
$('save').onclick=action(async()=>{const title=selected?.name||'Dashboard';const name=`${title.replace(/[^a-zA-Z0-9._-]/g,'_')}-slot-${$('state-slot').value}`;await host.saveSnapshot(name);await refreshStates();status(`Saved ${name}`);});
$('refresh').onclick=action(refreshStates);
const clearInput=installInput(()=>host,report);
let previousFrames=0;
setInterval(()=>{const s=host?.getStats();if(s){const fps=Math.max(0,s.framesConsumed-previousFrames);previousFrames=s.framesConsumed;$('stats').textContent=` · ${fps} FPS · ${s.width}×${s.height} · audio queue ${s.audioQueuedFrames} frames`;}else{previousFrames=0;$('stats').textContent=' · Console off';}},1000);
window.addEventListener('beforeunload',()=>host?.terminate());
busy=true;controls();
try{catalog=await readCatalog();discs=[...catalog.discs];for(const [kind,entry]of Object.entries(catalog.console))labelFile(kind,entry.name);await updateStorage();}catch(e){report(e);}
busy=false;controls();renderLibrary();
showLoading('Setting up browser threads…');
await window.xemuIsolationReady;
hideLoading();
if(!crossOriginIsolated)status('Browser threads need a reload after isolation setup. If this persists, allow the site service worker or use Chrome.');
