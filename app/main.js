import {installConsoleBundle} from './console-setup.js';
import {extractRar,discSource} from './game-import.js';
import {XemuHost} from './src/xemu-host.js';
import {readCatalog,writeCatalog,importFile,removeFile,storageSummary} from './storage.js';
import {installInput} from './input.js';
import {showLoading,hideLoading,downloadEngine} from './loading.js';
import {createDebugTrace} from './debug.js';
const $=id=>document.getElementById(id);
let host, selected, paused=false, busy=false, sound=false;
let catalog={console:{},discs:[]}, discs=[], remoteGames=[];
let importController, pendingArchive, setupController;
$('cancel-setup').onclick=()=>setupController?.abort();
$('cancel-import').onclick=()=>importController?.abort();
const debug=createDebugTrace({log:$('logs'),canvas:$('screen'),getStats:()=>host?.getStats()||null});
$('export-debug').onclick=()=>debug.export();
$('capture-frame').onclick=()=>debug.capture().catch(report);
const status=text=>{$('status').textContent=text;};
const report=error=>{$('library-status').textContent=error.message||String(error);hideLoading();debug.record('error',{message:error.message||String(error),stack:error.stack||null});status(error.message||String(error));};
function controls() {
  for(const id of ['pause','stop','reset','audio','save','refresh','eject'])$(id).disabled=!host?.memory||busy;
  $('boot').disabled=!!host||busy;
  $('discs').disabled=busy;
  for(const id of ['mcpx','flash','hdd','eeprom','renderer','memory','get-console','console-zip'])$(id).disabled=!!host||busy;
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
async function setupConsole(file){
 setupController=new AbortController();$('cancel-setup').hidden=false;
 let entries;
 try{
  const existing=['mcpx','flash','hdd'].filter(kind=>catalog.console[kind]||$(kind).files[0]);
  entries=await installConsoleBundle({file,existing,signal:setupController.signal,onProgress:(text,ratio)=>{status(text);$('console-setup-status').textContent=text;showLoading(text,ratio);}});
  const next={...catalog,console:{...catalog.console,...entries}};
  try{await writeCatalog(next);}catch(error){for(const entry of Object.values(entries))await removeFile(entry).catch(()=>{});throw error;}
  catalog=next;for(const [kind,entry]of Object.entries(entries))labelFile(kind,entry.name);
  await updateStorage();$('console-setup-status').textContent='Console files ready. These files are reused for every game.';status('Console files ready. Choose Load & Run to start the selected game.');
 }catch(error){$('console-setup-status').textContent=error.message||String(error);throw error;}
 finally{setupController=null;$('cancel-setup').hidden=true;hideLoading();}
}
$('get-console').onclick=action(()=>setupConsole());
$('console-zip').onchange=action(async()=>{const file=$('console-zip').files[0];$('console-zip').value='';if(file)await setupConsole(file);});
async function prepareConsole() {
  const missing=['mcpx','flash','hdd'].filter(kind=>!catalog.console[kind]&&!$(kind).files[0]);
  debug.record('console-files',{missing,present:['mcpx','flash','hdd','eeprom'].filter(kind=>catalog.console[kind]||$(kind).files[0])});
  if(missing.length)throw Error(`Missing console files: ${missing.map(kind=>({mcpx:'MCPX boot ROM',flash:'flash BIOS',hdd:'qcow2 hard disk image'})[kind]).join(', ')}. Use Download & configure console files, or select them individually in Console Files.`);
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
  debug.record('boot-request',{disc:selected?.name||null,cached:!!selected?.opfs,isolated:crossOriginIsolated,renderer:$('renderer').value});
  showLoading('Preparing console…');
  await window.xemuIsolationReady;
  if(!crossOriginIsolated)throw Error('Browser threads are unavailable. Reload the page or use a browser that allows the isolation service worker.');
  const files=await prepareConsole();if(selected)files.disc=await discSource(selected);
  status('Downloading engine…');
  const wasmBinary=await downloadEngine();
  showLoading('Initializing engine…');
  status('Starting console…');host=new XemuHost({canvas:$('screen')});
  const current=host;
  for(const type of ['ready','started','diag','notification','exited','resize'])current.addEventListener(type,e=>{
    if(current!==host)return;
    const detail=type==='ready'?{loadMs:e.detail.loadMs}:e.detail;
    debug.record(type,detail);
  });
  let firstFrame=false;
  current.addEventListener('present',e=>{if(!firstFrame&&current===host){firstFrame=true;debug.record('first-frame',e.detail);}});
  setTimeout(()=>{if(current===host&&!firstFrame)debug.record('no-frame',{elapsedSeconds:15,stats:current.getStats()});},15000);
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
$('clear-log').onclick=()=>debug.clear();
$('browse-library').onclick=()=>{$('library-source').value='all';$('library-search').value='';renderLibrary();$('library-section').scrollIntoView({behavior:'smooth'});$('library-search').focus({preventScroll:true});};
$('keymap-toggle').onclick=()=>{const card=document.querySelector('[data-widget="keymap"]');window.XemuLayout.show('keymap');card.scrollIntoView({behavior:'smooth'});};
$('discs').onchange=action(async()=>{const files=[...$('discs').files];const requested=pendingArchive;pendingArchive=null;$('discs').value='';for(const file of files){
  const archive=requested||remoteGames.find(game=>game.name.toLowerCase()===file.name.toLowerCase());
  if(/\.rar$/i.test(file.name)){const entry=await prepareGame({file,name:file.name,...(archive?{url:archive.url,id:archive.id}:{})});discs.push(entry);selected=entry;}
  else if(/\.(iso|xiso)$/i.test(file.name)){const entry={id:crypto.randomUUID(),name:file.name,size:file.size,added:Date.now(),file};discs.push(entry);selected=entry;}
  else throw Error('Choose an Xbox ISO, XISO or RAR archive');
}$('library-status').textContent='';$('library-source').value='local';$('library-search').value='';renderLibrary();status(selected?.opfs?'Game added and selected. Choose Load & Run.':'Game added and selected for this session. Choose Load & Run.');});
async function fetchGame(disc,signal){
 const urls=[disc.url.replace('/cors/','/download/'),disc.url];let lastResponse,lastError;
 for(const url of urls){try{const response=await fetch(url,{signal});if(response.ok)return response;lastResponse=response;}catch(error){if(signal.aborted)throw error;lastError=error;}}
 if(lastResponse)return lastResponse;
 throw Error(`Cannot download ${disc.name} from Internet Archive. Open archive to check sign-in/access, or choose a local copy. ${lastError?.message||''}`);
}
async function prepareGame(disc){
 if(disc.opfs)return disc;
 importController=new AbortController();$('cancel-import').hidden=false;
 let temporary;
 try{
  let file=disc.file;
  if(!file){
   showLoading(`Downloading ${disc.name}…`,0);const response=await fetchGame(disc,importController.signal);
   if(!response.ok)throw Error(`Internet Archive returned HTTP ${response.status}. Use Open archive to check download access, or choose a local copy to play and cache this game.`);
   const length=Number(response.headers.get('content-length'))||disc.size;
   try{
    temporary=await importFile({name:disc.name,size:length,stream:()=>response.body},ratio=>showLoading(`Downloading ${disc.name}…`,ratio),importController.signal);
    const root=await navigator.storage.getDirectory();const dir=await root.getDirectoryHandle('xemu-web');file=await(await dir.getFileHandle(temporary.opfs.split('/').at(-1))).getFile();
    file=new File([file],disc.name);
   }catch(error){
    if(importController.signal.aborted)throw error;
    if(!['QuotaExceededError','SecurityError','NotAllowedError','InvalidStateError'].includes(error.name))throw error;
    showLoading('Browser cache unavailable — downloading for this session…');
    const retry=await fetchGame(disc,importController.signal);if(!retry.ok)throw Error(`Archive download HTTP ${retry.status}`);
    file=new File([await retry.blob()],disc.name);
   }
  }
  let entry;
  if(/\.rar$/i.test(disc.name))entry=await extractRar(file,(ratio,label)=>showLoading(label,ratio),importController.signal);
  else entry=temporary||await copyFile(file,disc.name);
  if(entry===temporary)temporary=null;
  const saved={id:disc.id||crypto.randomUUID(),...entry,...(disc.url?{sourceUrl:disc.url}:{})};
  try{if(saved.opfs){catalog.discs.push(saved);await writeCatalog(catalog);}}catch(error){catalog.discs=catalog.discs.filter(d=>d!==saved);await removeFile(saved);throw error;}
  await updateStorage();return saved;
 }finally{if(temporary)await removeFile(temporary);importController=null;$('cancel-import').hidden=true;hideLoading();}
}
$('library-source').onchange=renderLibrary;
$('library-search').oninput=renderLibrary;$('library-sort').onchange=renderLibrary;
function discButton(text,fn){const b=document.createElement('button');b.className='btn btn-secondary library-action';b.textContent=text;b.onclick=action(fn);return b;}
function renderLibrary(){
  $('library').replaceChildren();const query=$('library-search').value.toLowerCase().trim();
  const source=$('library-source').value;const items=source==='archive'?remoteGames:source==='local'?discs:[...discs,...remoteGames.filter(game=>!discs.some(d=>d.sourceUrl===game.url))];
  const filtered=items.filter(d=>d.name.toLowerCase().includes(query)).sort((a,b)=>$('library-sort').value==='size'?b.size-a.size:$('library-sort').value==='recent'?b.added-a.added:a.name.localeCompare(b.name));
  $('library-count-badge').textContent=`${items.length} game${items.length===1?'':'s'}`;$('library-empty').hidden=filtered.length>0;
  $('library-empty').textContent=items.length?'No matching games found.':'No games yet. Add a local Xbox disc image.';
  $('selected-disc').textContent=selected?`Selected: ${selected.name}`:'No disc selected — boot dashboard.';
  for(let disc of filtered){const tr=document.createElement('tr');tr.classList.toggle('selected',disc===selected);
    const title=document.createElement('td');title.textContent=disc.name;const size=document.createElement('td');size.textContent=`${(disc.size/1024**3).toFixed(2)} GB`;
    const cached=disc.remote?discs.find(d=>d.sourceUrl===disc.url):disc;
    const actions=document.createElement('td');actions.append(discButton(disc===selected?'Selected':disc.remote?(cached?'Play cached':'Play'):'Load & Run',async()=>{$('library-status').textContent='';if(disc.remote){const saved=cached||await prepareGame(disc);if(!cached)discs.push(saved);disc=saved;}if(host)await host.loadDisc(await discSource(disc),disc.name);selected=disc;renderLibrary();if(host)status('Disc inserted.');else await bootConsole();}));
    if(disc.remote&&!cached)actions.append(discButton('Cache',async()=>{$('library-status').textContent='';const saved=await prepareGame(disc);discs.push(saved);renderLibrary();status(saved.opfs?'Game cached. Choose Play cached to run it.':'Browser cache unavailable; game is ready for this session.');}));
    if(!disc.remote&&!disc.opfs)actions.append(discButton('Cache',async()=>{const entry=await copyFile(disc.file,disc.name);Object.assign(disc,entry);delete disc.file;catalog.discs.push({id:disc.id,...entry,...(disc.sourceUrl?{sourceUrl:disc.sourceUrl}:{})});await writeCatalog(catalog);await updateStorage();renderLibrary();status('Disc saved in browser storage.');}));
    if(!disc.remote)actions.append(discButton(disc.opfs?'Delete copy':'Remove',async()=>{if(host&&disc===selected)throw Error('Eject this disc before removing it.');if(disc.opfs){if(!confirm(`Delete the browser copy of ${disc.name}? Your original file is unchanged.`))return;await removeFile(disc);catalog.discs=catalog.discs.filter(d=>d.id!==disc.id);await writeCatalog(catalog);}discs=discs.filter(d=>d!==disc);if(selected===disc)selected=null;renderLibrary();}));
    title.append(document.createElement('br'));const badge=document.createElement('small');badge.className='mode-help';badge.textContent=disc.remote?(cached?(cached.opfs?'Cached · ready to play':'Ready this session'):disc.restricted?'Internet Archive · may require sign-in':'Internet Archive · download and cache'):disc.opfs?'Saved in browser':'Local file · this session';title.append(badge);
    if(disc.remote){const choose=document.createElement('button');choose.className='btn btn-secondary library-action';choose.textContent='Choose local copy';choose.onclick=()=>{if(busy)return;pendingArchive=disc;$('discs').click();};actions.append(choose);const link=document.createElement('a');link.href=disc.url.replace('/cors/','/download/');link.target='_blank';link.rel='noopener';link.textContent='Open archive';actions.append(link);}
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
try{const response=await fetch('./games-library.json');if(!response.ok)throw Error('Catalog unavailable');remoteGames=(await response.json()).games;}catch(e){report(e);}
busy=false;controls();renderLibrary();
showLoading('Setting up browser threads…');
await window.xemuIsolationReady;
hideLoading();
if(!crossOriginIsolated)status('Browser threads need a reload after isolation setup. If this persists, allow the site service worker or use Chrome.');
