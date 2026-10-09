import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright-core';
import {chromePath} from './chrome.mjs';
import {buildFlash,expectedChecksum} from './fixtures/test-flash.js';
import assert from 'node:assert/strict';
import {createQcow2} from './fixtures/qcow2.js';
// Match Pages: project subpath, HTTPS-capable localhost, no COOP/COEP headers.
const root=resolve('web'), prefix='/xemu_web/';
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json'};
const server=createServer(async(req,res)=>{
  try{const path=new URL(req.url,'http://localhost').pathname;if(!path.startsWith(prefix)){res.writeHead(404).end();return;}const file=resolve(root,path.slice(prefix.length)||'index.html');if(!file.startsWith(root+'/'))throw Error('path');const bytes=await readFile(file);res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(bytes);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=process.env.TARGET_URL||`http://127.0.0.1:${server.address().port}${prefix}`;
const browser=await chromium.launch({executablePath:chromePath(),headless:true,args:['--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(()=>crossOriginIsolated,{},{timeout:30000});
  await page.waitForFunction(()=>!document.getElementById('boot').disabled);
  assert.equal(await page.evaluate(()=>typeof SharedArrayBuffer),'function');
  for(const selector of ['.btn-primary','.btn-secondary','.btn-success','.widget-tool','.menu-toggle'])
    assert.equal(await page.locator(selector).first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(8, 75, 22)',`${selector} must be dark green`);
  await page.locator('#boot').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('MCPX'));
  assert.match(await page.locator('#logs').textContent(), /console-files.*mcpx.*flash.*hdd/);
  const traceDownload=page.waitForEvent('download');
  await page.locator('#export-debug').click();
  assert.equal((await traceDownload).suggestedFilename(),'xemu-debug.json');
  const frameDownload=page.waitForEvent('download');
  await page.locator('#capture-frame').click();
  assert.equal((await frameDownload).suggestedFilename(),'xemu-framebuffer.png');
  assert.match(await page.locator('#logs').textContent(), /framebuffer.*"nonblackPixels":0.*"receivedFrames":0/);
  await page.locator('#clear-log').click();assert.equal(await page.locator('#logs').textContent(),'');
  await page.locator('#btn-layout-menu').click();await page.locator('#layout-widget-width').fill('300');await page.locator('#layout-widget-width').dispatchEvent('input');
  await page.locator('#btn-layout-menu-close').click();
  await page.locator('[data-widget="audio"] .widget-tool-collapse').click();assert.equal(await page.locator('[data-widget="audio"]').evaluate(e=>e.classList.contains('is-collapsed')),true);
  await page.reload();await page.waitForFunction(()=>!document.getElementById('boot').disabled);
  assert.equal(await page.evaluate(()=>window.XemuLayout.getState().widgetWidth),300);
  assert.equal(await page.evaluate(()=>window.XemuLayout.getState().widgets.audio.collapsed),true);
  await page.locator('#discs').setInputFiles([{name:'Homebrew Test.xiso',mimeType:'application/octet-stream',buffer:Buffer.alloc(1024)}]);
  await page.locator('#library button').filter({hasText:'Import'}).click();
  await page.waitForFunction(()=>document.getElementById('library').textContent.includes('Saved in browser'));
  await page.reload();await page.waitForFunction(()=>document.getElementById('library-count-badge').textContent==='1 game');
  await page.locator('#library-search').fill('missing');assert.equal(await page.locator('#library tr').count(),0);
  await page.locator('#library-search').fill('homebrew');assert.equal(await page.locator('#library tr').count(),1);
  await page.locator('#touch-mode').selectOption('on');await page.waitForFunction(()=>!document.getElementById('touch-controls').hidden);
  await page.screenshot({path:'tests/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow');
  await page.screenshot({path:'tests/mobile.png',fullPage:true});
  const fixture={flash:buildFlash(2000000),checksumHex:expectedChecksum(2000000).toString(16).toUpperCase().padStart(8,'0')};
  const result=await page.evaluate(async({bytes,disk,expected})=>{
    const {downloadEngine,hideLoading}=await import('./loading.js');
    const wasmBinary=await downloadEngine();
    const progress=document.getElementById('progress').value;
    const {XemuHost}=await import('./src/xemu-host.js');const host=new XemuHost({canvas:document.getElementById('screen')});
    const {importFile}=await import('./storage.js');
    const flash=await importFile(new File([new Uint8Array(bytes)],'test-flash.bin'));
    const hdd=await importFile(new File([new Uint8Array(disk)],'test-hdd.qcow2'));
    let rejectRun;
    let log='';const done=new Promise((resolve,reject)=>{rejectRun=reject;host.addEventListener('log',e=>{log+=e.detail.lines.map(l=>l.text).join('\n');if(log.includes('XEMUWEB:DONE'))resolve(log);});host.addEventListener('error',e=>reject(Error(e.detail.message)));host.addEventListener('abort',e=>reject(Error(e.detail.message)));});
    const timer=setTimeout(()=>{rejectRun(Error('Engine timed out'));host.terminate();},60000);
    try{await host.boot({wasmBinary,files:{flash:{opfs:flash.opfs},hdd:{opfs:hdd.opfs,writable:true}},settings:{renderer:'OPENGL'},args:['-debugcon','stdio']});await done;
      // Large files take the lazy WORKERFS path; reinsert the same apostrophe
      // filename to exercise unique mounts rather than colliding with the old one.
      const disc=new File([new Uint8Array(17*1024*1024)], "Tony Hawk's test.iso");
      await host.loadDisc(disc,disc.name);await host.ejectDisc();
      await host.loadDisc(disc,disc.name);await host.ejectDisc();
      await host.saveSnapshot('pages-test');const snapshots=await host.listSnapshots();await host.loadSnapshot('pages-test');await host.deleteSnapshot('pages-test');return {log,expected,snapshots,progress,stats:host.getStats()};}finally{clearTimeout(timer);hideLoading();host.terminate();}
  },{bytes:[...fixture.flash],disk:[...createQcow2()],expected:fixture.checksumHex});
  assert.equal(result.progress,100,'Engine download must complete the loading bar');
  assert.ok(result.log.includes(`XEMUWEB:DONE ${result.expected}`),result.log);
  assert.ok(result.snapshots.some(s=>s.name==='pages-test'),'OPFS snapshot missing');
  assert.ok(result.stats.framesConsumed>0,'No frame delivered');
  assert.deepEqual(errors,[]);
  const failureContext=await browser.newContext({serviceWorkers:'block'});
  try {
    const failurePage=await failureContext.newPage();
    await failurePage.route('**/*',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp'}});});
    await failurePage.goto(url);
    await failurePage.waitForFunction(()=>crossOriginIsolated&&!document.getElementById('boot').disabled);
    let downloadArrived,releaseDownload;
    const arrived=new Promise(resolve=>downloadArrived=resolve);
    const gate=new Promise(resolve=>releaseDownload=resolve);
    await failurePage.route('**/cores/xemu/xemu-core.wasm',async route=>{downloadArrived();await gate;await route.fulfill({status:503,body:'Unavailable'});});
    await failurePage.locator('#mcpx').setInputFiles({name:'generated-test-only.bin',mimeType:'application/octet-stream',buffer:Buffer.alloc(512)});
    await failurePage.locator('#flash').setInputFiles({name:'generated-test-flash.bin',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.flash)});
    await failurePage.locator('#hdd').setInputFiles({name:'generated-test-disk.qcow2',mimeType:'application/octet-stream',buffer:Buffer.from(createQcow2())});
    await failurePage.locator('#boot').click();
    let arrivalTimer;
    try{await Promise.race([arrived,new Promise((_,reject)=>{arrivalTimer=setTimeout(()=>reject(Error('Download did not start')),20000);})]);}finally{clearTimeout(arrivalTimer);}
    assert.ok(await failurePage.locator('#loading-panel').isVisible(),'Loading bar must stay visible while downloading');
    assert.equal(await failurePage.locator('#loading-label').textContent(),'Downloading engine…');
    assert.ok(await failurePage.locator('#loading-panel').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;}),'Loading bar must stay inside the visible viewport');
    await failurePage.screenshot({path:'tests/loading.png',fullPage:false});
    releaseDownload();
    await failurePage.waitForFunction(()=>document.getElementById('status').textContent.includes('HTTP 503'));
    assert.ok(!await failurePage.locator('#loading-panel').isVisible(),'Failure must clear the loading bar');
    assert.ok(await failurePage.locator('#boot').isEnabled(),'Failure must allow retry');
  } finally {await failureContext.close();}

  console.log('Browser checks passed: Pages subpath isolation, persisted layout/library, search, touch UI, mobile layout, loading progress/error recovery, WebGL2 engine checksum and OPFS snapshot save/load/delete');
}finally{await browser.close();await new Promise(r=>server.close(r));}
