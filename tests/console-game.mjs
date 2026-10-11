// Opt-in real console/game verification. Media stays in browser storage or Downloads.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {chromePath} from './chrome.mjs';
const disc=process.env.XEMU_RAR_PATH;if(!disc)throw Error('Set XEMU_RAR_PATH to a local game RAR');
const server=spawn(process.execPath,['tools/serve.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','inherit']});let browser;
try{
 const local=await new Promise(r=>server.stdout.once('data',d=>r(d.toString().trim()))),url=process.env.TARGET_URL||local;
 browser=await chromium.launch({executablePath:chromePath(),headless:true,args:['--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Page error:',e.message);});
 await page.goto(url);await page.waitForFunction(()=>!document.getElementById('boot').disabled);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Storage.overrideQuotaForOrigin',{origin:new URL(url).origin,quotaSize:4*1024**3});
 await page.locator('#get-console').click();
 await page.waitForFunction(()=>!document.getElementById('boot').disabled,null,{timeout:300000});
 if(!(await page.locator('#console-setup-status').textContent()).includes('Console files ready'))throw Error(await page.locator('#status').textContent());
 console.log('Real console ZIP imported');
 await page.locator('#discs').setInputFiles(disc);await page.waitForFunction(()=>!document.getElementById('boot').disabled,null,{timeout:300000});
 console.log(await page.locator('#selected-disc').textContent());
 await page.locator('#boot').click();
 await page.waitForFunction(()=>document.getElementById('status').textContent==='Console running'||(!document.getElementById('boot').disabled&&document.getElementById('loading-panel').hidden),null,{timeout:300000});
 console.log(await page.locator('#status').textContent());mkdirSync('tests/artifacts',{recursive:true});
 const frames=[];
 for(let i=0;i<4;i++){
  await page.waitForTimeout(15000);if(i===2){await page.keyboard.down('Enter');await page.waitForTimeout(500);await page.keyboard.up('Enter');await page.keyboard.down('z');await page.waitForTimeout(500);await page.keyboard.up('z');}
  const pixels=await page.locator('#screen').evaluate(canvas=>{const copy=new OffscreenCanvas(canvas.width,canvas.height),ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);const data=ctx.getImageData(0,0,copy.width,copy.height).data;let nonblack=0;for(let i=0;i<data.length;i+=4)if(data[i]||data[i+1]||data[i+2])nonblack++;return {width:copy.width,height:copy.height,nonblack};});frames.push(pixels);
  pixels.distinctColors=await page.locator('#screen').evaluate(canvas=>{const copy=new OffscreenCanvas(canvas.width,canvas.height),ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);const data=ctx.getImageData(0,0,copy.width,copy.height).data,colors=new Set();for(let i=0;i<data.length;i+=4)colors.add((data[i]<<16)|(data[i+1]<<8)|data[i+2]);return colors.size;});
  const png=await page.locator('#screen').evaluate(c=>c.toDataURL('image/png')),bytes=Buffer.from(png.split(',')[1],'base64');pixels.sha256=createHash('sha256').update(bytes).digest('hex');writeFileSync(`tests/artifacts/f1-console-${i}.png`,bytes);console.log(await page.locator('#stats').textContent(),pixels);
  if(await page.locator('#boot').isEnabled())break;
 }
 const report={frames,errors,status:await page.locator('#status').textContent(),log:await page.locator('#logs').textContent()};writeFileSync('tests/artifacts/f1-console-report.json',JSON.stringify(report,null,2));
 if(errors.length||report.status!=='Console running'||new Set(frames.filter(f=>f.distinctColors>16).map(f=>f.sha256)).size<2){console.error('Game verification failed: expected varied, advancing game frames.');process.exitCode=1;}
}finally{await browser?.close();server.kill();}
