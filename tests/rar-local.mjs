// Opt-in validation using local media; no game bytes enter the repository.
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {chromePath} from './chrome.mjs';
import assert from 'node:assert/strict';
import {readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {buildFlash,expectedChecksum} from './fixtures/test-flash.js';
import {createQcow2} from './fixtures/qcow2.js';
const file=process.env.XEMU_RAR_PATH;if(!file)throw Error('Set XEMU_RAR_PATH');
const server=spawn(process.execPath,['tools/serve.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','inherit']});let browser,progressTimer;
try{
 const url=await new Promise(r=>server.stdout.once('data',d=>r(d.toString().trim())));
 browser=await chromium.launch({executablePath:chromePath(),headless:true,args:['--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});const page=await browser.newPage();
 page.on('console',m=>console.log(m.text()));
 await page.addInitScript(()=>{const OriginalWorker=Worker;window.Worker=class extends OriginalWorker{constructor(...args){super(...args);if(String(args[0]).includes('rar-worker.js'))this.addEventListener('message',e=>{if(e.data.result)window.testImportedDisc=e.data.result;});}};});
 await page.goto(url);await page.waitForFunction(()=>!document.getElementById('boot').disabled);
 if(process.env.XEMU_CACHE_TEST==='1'){const cdp=await page.context().newCDPSession(page);await cdp.send('Storage.overrideQuotaForOrigin',{origin:new URL(url).origin,quotaSize:4*1024**3});}
 assert.equal(await page.locator('#library tr').count(),714);
 const chooserPromise=page.waitForEvent('filechooser');await page.locator('label[for=discs]').first().click();await(await chooserPromise).setFiles(file);
 progressTimer=setInterval(async()=>{try{console.log(await page.locator('#loading-label').textContent(),await page.locator('#progress').inputValue());}catch{}},20000);
 await page.waitForFunction(()=>!document.getElementById('boot').disabled,null,{timeout:600000});
 clearInterval(progressTimer);
 const result=await page.evaluate(async()=>{
  const entry=window.testImportedDisc;if(!entry)throw Error(document.getElementById('status').textContent);
  const {discSource}=await import('./game-import.js');const file=await discSource(entry);
  const header=new DataView(await file.slice(0x10000,0x10800).arrayBuffer());const listing=[];
  async function walk(sector,size,prefix){const bytes=await file.slice(sector*2048,sector*2048+size).arrayBuffer(),v=new DataView(bytes);
   async function visit(offset){const left=v.getUint16(offset,true),right=v.getUint16(offset+2,true),sector=v.getUint32(offset+4,true),size=v.getUint32(offset+8,true),directory=v.getUint8(offset+12)&16;
    const name=new TextDecoder().decode(new Uint8Array(bytes,offset+14,v.getUint8(offset+13)));if(left)await visit(left*4);
    if(directory)await walk(sector,size,prefix+name+'/');else{listing.push({name:prefix+name,size});if(name.toLowerCase()==='default.xbe'){const magic=await file.slice(sector*2048,sector*2048+4).text();if(magic!=='XBEH')throw Error('Invalid XBE');}}
    if(right)await visit(right*4);
   }await visit(0);
  }await walk(header.getUint32(20,true),header.getUint32(24,true),'');
  return {name:entry.name,size:file.size,listing,cached:!!entry.opfs};
 });assert.ok(result.listing.some(e=>e.name.toLowerCase()==='default.xbe'));assert.ok(result.listing.length>100);
 const tree=process.env.XEMU_EXTRACTED_PATH;if(tree){const expected=[];function walk(dir,prefix=''){for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isDirectory())walk(join(dir,entry.name),prefix+entry.name+'/');else expected.push({name:prefix+entry.name,size:statSync(join(dir,entry.name)).size});}}walk(tree);const sort=items=>items.sort((a,b)=>a.name.localeCompare(b.name));assert.deepEqual(sort(result.listing),sort(expected));}
 console.log(JSON.stringify({name:result.name,size:result.size,files:result.listing.length,executable:result.listing.find(e=>e.name.toLowerCase()==='default.xbe')}));
 const native=await page.evaluate(async({flash,hdd,expected})=>{
  const {importFile}=await import('./storage.js');const disc=window.testImportedDisc;
  const {discSource}=await import('./game-import.js');const discFile=await discSource(disc);
  const {downloadEngine,hideLoading}=await import('./loading.js');const wasmBinary=await downloadEngine();
  const {XemuHost}=await import('./src/xemu-host.js');const host=new XemuHost({canvas:document.getElementById('screen')});
  let log='';let resolveDone,rejectDone;const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
  host.addEventListener('log',e=>{log+=e.detail.lines.map(l=>l.text).join('\n');if(log.includes('XEMUWEB:DONE'))resolveDone();});
  for(const type of ['error','abort'])host.addEventListener(type,e=>rejectDone(Error(e.detail.message)));
  const timer=setTimeout(()=>rejectDone(Error('Native disc mount timed out')),60000);
  try{
   const firmware=await importFile(new File([new Uint8Array(flash)],'generated-test-flash.bin'));
   const disk=await importFile(new File([new Uint8Array(hdd)],'generated-test-hdd.qcow2'));
   await host.boot({wasmBinary,files:{flash:{opfs:firmware.opfs},hdd:{opfs:disk.opfs,writable:true},disc:discFile},settings:{renderer:'OPENGL'},args:['-debugcon','stdio']});
   await done;if(!log.includes(`XEMUWEB:DONE ${expected}`))throw Error(log);
   await host.ejectDisc();await host.loadDisc(discFile,disc.name);await host.ejectDisc();
   return {frames:host.getStats().framesConsumed,mounted:true};
  }finally{clearTimeout(timer);hideLoading();host.terminate();}
 },{flash:[...buildFlash(2000000)],hdd:[...createQcow2()],expected:expectedChecksum(2000000).toString(16).toUpperCase().padStart(8,'0')});
 assert.ok(native.mounted);console.log('Native engine booted with converted F1 disc; eject/reinsert passed (generated test firmware, not gameplay)');
 assert.ok((await page.locator('#selected-disc').textContent()).includes('F1.2001'));
 await page.locator('#library-source').selectOption('archive');await page.locator('#library-search').fill('F1.2001');assert.equal(await page.locator('#library button').filter({hasText:'Play cached'}).count(),1);
 await page.reload();await page.waitForFunction(()=>!document.getElementById('boot').disabled);if(result.cached)await page.waitForFunction(()=>document.getElementById('library').textContent.includes('Saved in browser'));
 assert.equal(await page.locator('#library tr').count(),714);
 await page.locator('#library-source').selectOption('archive');await page.locator('#library-search').fill('F1.2001');assert.equal(await page.locator('#library tr').count(),1);
 console.log(`Real F1 picker/import, selected disc, native mount and all-game library passed; persistent cache: ${result.cached}`);if(process.env.XEMU_CACHE_TEST==='1')assert.ok(result.cached);
}finally{clearInterval(progressTimer);await browser?.close();server.kill();}
