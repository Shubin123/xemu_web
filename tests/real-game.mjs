// Opt-in local-media test. Files enter an isolated browser profile through file inputs;
// they are never served by HTTP, copied into the repository, or published.
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {chromePath} from './chrome.mjs';
const local=existsSync('tests/artifacts/game-inputs.json')?JSON.parse(readFileSync('tests/artifacts/game-inputs.json')).paths:{};
const paths={discs:process.env.XEMU_DISC_PATH||local.disc,mcpx:process.env.XEMU_MCPX_PATH||local.mcpx,
  flash:process.env.XEMU_FLASH_PATH||local.flash,hdd:process.env.XEMU_HDD_PATH||local.hdd,eeprom:process.env.XEMU_EEPROM_PATH||local.eeprom};
const missing=['discs','mcpx','flash','hdd'].filter(key=>!paths[key]||!existsSync(paths[key]));
if(missing.length)throw Error(`Missing local inputs: ${missing.join(', ')}. Run npm run prepare:game with your ROM and BIOS paths.`);
const child=spawn(process.execPath,['tools/serve.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try {
  const url=await new Promise((resolve,reject)=>{child.stdout.once('data',data=>resolve(data.toString().trim()));child.once('error',reject);child.once('exit',()=>reject(Error('Local server exited')));});
  browser=await chromium.launch({executablePath:chromePath(),headless:true,args:['--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.waitForFunction(()=>!document.getElementById('boot').disabled);
  for(const [id,path]of Object.entries(paths))if(path)await page.locator(`#${id}`).setInputFiles(path);
  await page.locator('#library button').filter({hasText:'Load & Run'}).click();
  mkdirSync('tests/artifacts',{recursive:true});
  await page.waitForFunction(()=>document.getElementById('status').textContent==='Console running'||(!document.getElementById('boot').disabled&&document.getElementById('loading-panel').hidden),null,{timeout:600000}).catch(()=>{});
  const frames=[];
  for(let i=0;i<3;i++) {
    await page.waitForTimeout(10000);
    await page.screenshot({path:`tests/artifacts/game-${i}.png`,fullPage:false});
    const png=await page.locator('#screen').evaluate(canvas=>canvas.toDataURL('image/png'));
    writeFileSync(`tests/artifacts/game-framebuffer-${i}.png`,Buffer.from(png.split(',')[1],'base64'));
    frames.push(await page.locator('#screen').evaluate(canvas=>{
      const copy=new OffscreenCanvas(canvas.width,canvas.height),ctx=copy.getContext('2d');
      ctx.drawImage(canvas,0,0);const pixels=ctx.getImageData(0,0,copy.width,copy.height).data;
      let nonblackPixels=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]||pixels[i+1]||pixels[i+2])nonblackPixels++;
      return {width:copy.width,height:copy.height,nonblackPixels};
    }));
    console.log(await page.locator('#status').textContent(),await page.locator('#stats').textContent());
    if(await page.locator('#boot').isEnabled())break;
  }
  const report=await page.evaluate(()=>({status:document.getElementById('status').textContent,stats:document.getElementById('stats').textContent,log:document.getElementById('logs').textContent}));
  writeFileSync('tests/artifacts/game-report.json',JSON.stringify({...report,frames,errors},null,2));
  if(report.status!=='Console running'||errors.length||!frames.some(frame=>frame.nonblackPixels>0))process.exitCode=1;
  console.log('Local run captured in ignored tests/artifacts/; inspect screenshots to confirm actual game rendering.');
} finally {await browser?.close();child.kill();}
