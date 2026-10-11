// Opt-in real dashboard/input check. Firmware and writable media remain local.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {chromePath} from './chrome.mjs';
const local=existsSync('tests/artifacts/game-inputs.json')?JSON.parse(readFileSync('tests/artifacts/game-inputs.json')).paths:{};
const inputs={mcpx:process.env.XEMU_MCPX_PATH||local.mcpx,flash:process.env.XEMU_FLASH_PATH||local.flash,hdd:process.env.XEMU_HDD_PATH||local.hdd};
for(const [key,path] of Object.entries(inputs))assert.ok(path&&existsSync(path),`Missing local ${key}`);
const server=spawn(process.execPath,['tools/serve.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','inherit']});
let browser;
try {
 const url=await new Promise((resolve,reject)=>{server.stdout.once('data',d=>resolve(d.toString().trim()));server.once('error',reject);server.once('exit',()=>reject(Error('Server exited')));});
 const gpu=process.env.XEMU_GAME_GPU||'swiftshader';
 assert.ok(['metal','swiftshader'].includes(gpu),'XEMU_GAME_GPU must be metal or swiftshader');
 browser=await chromium.launch({executablePath:chromePath(),headless:true,args:[gpu==='metal'?'--use-angle=metal':'--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TARGET_URL||url);await page.waitForFunction(()=>!document.getElementById('boot').disabled);
 for(const [key,path]of Object.entries(inputs))await page.locator(`#${key}`).setInputFiles(path);
 await page.locator('#boot').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Console running',null,{timeout:90000});
 await page.waitForTimeout(15000);
 mkdirSync('tests/artifacts/dashboard',{recursive:true});
 async function capture(name){
  const png=await page.locator('#screen').evaluate(c=>c.toDataURL('image/png'));
  writeFileSync(`tests/artifacts/dashboard/${name}.png`,Buffer.from(png.split(',')[1],'base64'));
  // Exclude the clock/tray status and mask bright white menu text below.
  // This ignores the animated background and pulsing green selection.
  const pixels=await page.locator('#screen').evaluate(c=>{const copy=new OffscreenCanvas(350,180),ctx=copy.getContext('2d');ctx.drawImage(c,0,75,350,180,0,0,350,180);return Array.from(ctx.getImageData(0,0,350,180).data);});
  const colors=new Set(),selection=[];for(let i=0;i<pixels.length;i+=4){colors.add((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]);selection.push(pixels[i]>=200&&pixels[i+1]>=200&&pixels[i+2]>=200?1:0);}
  return {sha256:createHash('sha256').update(Buffer.from(selection)).digest('hex'),distinctColors:colors.size,menuTextPixels:selection.reduce((a,b)=>a+b,0)};
 }
 async function press(key){await page.keyboard.down(key);await page.waitForTimeout(100);await page.keyboard.up(key);await page.waitForTimeout(800);}
 const before=await capture('before');await page.waitForTimeout(500);const stable=await capture('stable');
 assert.ok(before.menuTextPixels>50,'Expected rendered menu text');
 assert.ok(before.distinctColors>16,'Expected rendered dashboard menu');assert.equal(before.sha256,stable.sha256,'Menu must be stable before input');
 await press('ArrowDown');const down=await capture('down');assert.notEqual(down.sha256,before.sha256,'Guest menu must respond to D-pad down');
 await press('ArrowUp');const up=await capture('up');assert.equal(up.sha256,before.sha256,'D-pad up must restore the guest selection');
 await press('z');const selected=await capture('selected');assert.notEqual(selected.sha256,before.sha256,'A must open the guest menu');
 await press('x');const returned=await capture('returned');assert.equal(returned.sha256,before.sha256,'B must return to the guest menu');
 assert.deepEqual(errors,[]);
 const report={passed:true,gpu,before,down,up,selected,returned,status:await page.locator('#status').textContent(),stats:await page.locator('#stats').textContent()};
 writeFileSync('tests/artifacts/dashboard/report.json',JSON.stringify(report,null,2));
 console.log('Real Xbox dashboard rendered; D-pad down/up and A/B changed and restored the guest menu');
} finally {await browser?.close();server.kill();}
