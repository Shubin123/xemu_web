import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {chromePath} from './chrome.mjs';
import {buildFlash} from './fixtures/test-flash.js';
import {createQcow2} from './fixtures/qcow2.js';
import {ZipWriter,Uint8ArrayWriter,Uint8ArrayReader} from '../app/vendor/zip/zip-core-external.min.js';
import assert from 'node:assert/strict';
const bytes={mcpx:new Uint8Array(512),flash:buildFlash(10),hdd:createQcow2()};
const files=Object.fromEntries(Object.entries(bytes).map(([kind,data])=>[kind,{path:`${kind}/${kind==='hdd'?'xbox_hdd.qcow2':kind+'.bin'}`,name:kind==='hdd'?'xbox_hdd.qcow2':kind+'.bin',size:data.length,sha256:createHash('sha256').update(data).digest('hex')}])) ;
const zip=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false});for(const [kind,data]of Object.entries(bytes))await zip.add(files[kind].path,new Uint8ArrayReader(data),{level:0});const packed=Buffer.from(await zip.close());
const server=spawn(process.execPath,['tools/serve.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','inherit']});let browser;
try{
 const url=await new Promise(r=>server.stdout.once('data',d=>r(d.toString().trim())));
 browser=await chromium.launch({executablePath:chromePath(),headless:true});const page=await browser.newPage({serviceWorkers:'block'});page.setDefaultTimeout(30000);let downloads=0;
 await page.route('**/console-bundle.json*',route=>route.fulfill({json:{url:'./console-files.zip',files}}));
 await page.route('**/console-files.zip*',route=>{downloads++;const range=route.request().headers().range;let start=0,end=packed.length-1;if(range){const m=/bytes=(\d*)-(\d*)/.exec(range);if(m[1]){start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}else start=Math.max(0,packed.length-Number(m[2]));}
  return route.fulfill({status:range?206:200,headers:{'content-type':'application/zip','content-length':String(end-start+1),'accept-ranges':'bytes',...(range?{'content-range':`bytes ${start}-${end}/${packed.length}`}:{})},body:route.request().method()==='HEAD'?'':packed.subarray(start,end+1)});
 });
 await page.goto(url);await page.waitForFunction(()=>!document.getElementById('boot').disabled);
 await page.locator('#get-console').click();await page.waitForFunction(()=>!document.getElementById('boot').disabled);assert.match(await page.locator('#console-setup-status').textContent(),/Console files ready/);
 const installed=await page.evaluate(async()=>{const {readCatalog}=await import('./storage.js');return (await readCatalog()).console;});assert.deepEqual(Object.keys(installed).sort(),['flash','hdd','mcpx']);assert.ok(downloads>0);
 await page.reload();await page.waitForFunction(()=>!document.getElementById('boot').disabled);assert.equal(await page.locator('label[for=hdd]').textContent(),'xbox_hdd.qcow2');
 const previous=downloads;await page.locator('#get-console').click();await page.waitForFunction(()=>!document.getElementById('boot').disabled);assert.match(await page.locator('#console-setup-status').textContent(),/Console files ready/);assert.equal(downloads,previous,'Existing HDD must not be downloaded/replaced');
 assert.equal(await page.evaluate(async()=>{const {readCatalog}=await import('./storage.js');return (await readCatalog()).console.hdd.opfs;}),installed.hdd.opfs);
 const other=await browser.newPage({serviceWorkers:'block'});other.setDefaultTimeout(30000);await other.route('**/console-bundle.json*',route=>route.fulfill({json:{url:'./console-files.zip',files}}));await other.goto(url);await other.waitForFunction(()=>!document.getElementById('boot').disabled);
 // Each page gets a different context so this checks independent client setup.
 await other.locator('#console-zip').setInputFiles({name:'generated-console.zip',mimeType:'application/zip',buffer:packed});await other.waitForFunction(()=>!document.getElementById('boot').disabled);assert.match(await other.locator('#console-setup-status').textContent(),/Console files ready/);
 const broken=await browser.newPage({serviceWorkers:'block'});
 broken.setDefaultTimeout(30000);
 await broken.route('**/console-bundle.json*',route=>route.fulfill({json:{url:'./console-files.zip',files:{...files,flash:{...files.flash,sha256:'0'.repeat(64)}}}}));
 await broken.goto(url);await broken.waitForFunction(()=>!document.getElementById('boot').disabled);
 await broken.locator('#console-zip').setInputFiles({name:'generated-console.zip',mimeType:'application/zip',buffer:packed});await broken.waitForFunction(()=>!document.getElementById('boot').disabled);
 assert.match(await broken.locator('#console-setup-status').textContent(),/flash checksum mismatch/);
 const remaining=await broken.evaluate(async()=>{const {readCatalog}=await import('./storage.js');const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('xemu-web');return {catalog:await readCatalog(),files:await Array.fromAsync(dir.keys())};});
 assert.deepEqual(remaining.catalog.console,{});assert.deepEqual(remaining.files,[],'Failed setup must remove partial imports');
 console.log('Console ZIP download/local import, validation rollback, reuse across reloads and HDD preservation passed');
}finally{await browser?.close();server.kill();}
