// Opt-in local-media test. Files enter an isolated browser profile through file inputs;
// they are never served by HTTP, copied into the repository, or published.
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {chromePath} from './chrome.mjs';
const paths={discs:process.env.XEMU_DISC_PATH,mcpx:process.env.XEMU_MCPX_PATH,
  flash:process.env.XEMU_FLASH_PATH,hdd:process.env.XEMU_HDD_PATH,eeprom:process.env.XEMU_EEPROM_PATH};
for(const key of ['discs','mcpx','flash','hdd'])if(!paths[key]||!existsSync(paths[key]))throw Error(`Supply a local ${key} file via XEMU_${key==='discs'?'DISC':key.toUpperCase()}_PATH`);
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
  for(let i=0;i<3;i++) {
    await page.waitForTimeout(10000);
    await page.screenshot({path:`tests/artifacts/game-${i}.png`,fullPage:false});
    console.log(await page.locator('#status').textContent(),await page.locator('#stats').textContent());
    if(await page.locator('#boot').isEnabled())break;
  }
  const report=await page.evaluate(()=>({status:document.getElementById('status').textContent,stats:document.getElementById('stats').textContent,log:document.getElementById('logs').textContent}));
  writeFileSync('tests/artifacts/game-report.json',JSON.stringify({...report,errors},null,2));
  console.log('Local run captured in ignored tests/artifacts/; inspect screenshots to confirm actual game rendering.');
} finally {await browser?.close();child.kill();}
