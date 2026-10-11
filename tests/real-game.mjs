// Opt-in local-media test. Files enter an isolated browser profile through file inputs;
// they are never served by HTTP, copied into the repository, or published.
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {chromePath} from './chrome.mjs';
const local=existsSync('tests/artifacts/game-inputs.json')?JSON.parse(readFileSync('tests/artifacts/game-inputs.json')).paths:{};
const paths={discs:process.env.XEMU_DISC_PATH||local.disc,mcpx:process.env.XEMU_MCPX_PATH||local.mcpx,
  flash:process.env.XEMU_FLASH_PATH||local.flash,hdd:process.env.XEMU_HDD_PATH||local.hdd,eeprom:process.env.XEMU_EEPROM_PATH||local.eeprom};
const missing=['discs','mcpx','flash','hdd'].filter(key=>!paths[key]||!existsSync(paths[key]));
if(missing.length)throw Error(`Missing local inputs: ${missing.join(', ')}. Run npm run prepare:game with your ROM and BIOS paths.`);
const duration=Number(process.env.XEMU_GAME_SECONDS||180);
if(!Number.isFinite(duration)||duration<40)throw Error('XEMU_GAME_SECONDS must be at least 40');
const child=spawn(process.execPath,['tools/serve.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try {
  const url=await new Promise((resolve,reject)=>{child.stdout.once('data',data=>resolve(data.toString().trim()));child.once('error',reject);child.once('exit',()=>reject(Error('Local server exited')));});
  const gpu=process.env.XEMU_GAME_GPU||'swiftshader';
  if(!['metal','swiftshader'].includes(gpu))throw Error('XEMU_GAME_GPU must be metal or swiftshader');
  browser=await chromium.launch({executablePath:chromePath(),headless:true,args:[gpu==='metal'?'--use-angle=metal':'--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  // Shader warmup and GPU readback can exceed the UI's ordinary timeout.
  page.setDefaultTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.TARGET_URL||url);await page.waitForFunction(()=>!document.getElementById('boot').disabled);
  for(const [id,path]of Object.entries(paths))if(path)await page.locator(`#${id}`).setInputFiles(path);
  await page.waitForFunction(()=>!document.getElementById('boot').disabled&&document.getElementById('loading-panel').hidden&&!document.getElementById('selected-disc').textContent.includes('No disc selected'),null,{timeout:300000});
  await page.locator('#boot').click();
  await page.waitForFunction(()=>!document.getElementById('audio').disabled,{},{timeout:90000});
  await page.locator('#audio').click();
  mkdirSync('tests/artifacts',{recursive:true});
  await page.waitForFunction(()=>document.getElementById('status').textContent==='Console running'||(!document.getElementById('boot').disabled&&document.getElementById('loading-panel').hidden),null,{timeout:90000}).catch(()=>{});
  const frames=[];
  const started=Date.now();
  for(let i=0;Date.now()-started<duration*1000;i++) {
    await page.waitForTimeout(5000);
    if(i===2||i===4){await page.keyboard.down('Enter');await page.waitForTimeout(1500);await page.keyboard.up('Enter');await page.keyboard.down('z');await page.waitForTimeout(1500);await page.keyboard.up('z');}
    await page.screenshot({path:`tests/artifacts/game-${i}.png`,fullPage:false});
    const png=await page.locator('#screen').evaluate(canvas=>canvas.toDataURL('image/png'));
    const pngBytes=Buffer.from(png.split(',')[1],'base64');
    writeFileSync(`tests/artifacts/game-framebuffer-${i}.png`,pngBytes);
    frames.push(await page.locator('#screen').evaluate(canvas=>{
      const copy=new OffscreenCanvas(canvas.width,canvas.height),ctx=copy.getContext('2d');
      ctx.drawImage(canvas,0,0);const pixels=ctx.getImageData(0,0,copy.width,copy.height).data;
      const colors=new Set();
      let nonblackPixels=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]||pixels[i+1]||pixels[i+2])nonblackPixels++;
      for(let i=0;i<pixels.length;i+=4)colors.add((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]);
      return {width:copy.width,height:copy.height,nonblackPixels,distinctColors:colors.size};
    }));
    frames.at(-1).sha256=createHash('sha256').update(pngBytes).digest('hex');
    console.log(await page.locator('#status').textContent(),await page.locator('#stats').textContent());
    if(await page.locator('#boot').isEnabled())break;
  }
  const report=await page.evaluate(()=>({status:document.getElementById('status').textContent,stats:document.getElementById('stats').textContent,log:document.getElementById('logs').textContent}));
  const rendered=frames.filter(frame=>frame.distinctColors>16);
  const passed=report.status==='Console running'&&!errors.length&&new Set(rendered.map(frame=>frame.sha256)).size>=2;
  writeFileSync('tests/artifacts/game-report.json',JSON.stringify({...report,gpu,duration,passed,frames,errors},null,2));
  if(!passed)process.exitCode=1;
  if(process.exitCode)console.error('Game verification failed: expected varied, advancing game frames; solid-color or frozen output is a failure.');
  console.log('Local run captured in ignored tests/artifacts/; inspect screenshots to confirm actual game rendering.');
} finally {await browser?.close();child.kill();}
