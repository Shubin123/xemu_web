// Prepare local media paths only. Firmware and discs stay outside this repository.
import {existsSync,mkdirSync,readFileSync,writeFileSync,openSync,readSync,closeSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');if(i<0)throw Error('Use --disc=/path, --mcpx=/path, --flash=/path or --hdd=/path');return [arg.slice(2,i),arg.slice(i+1)];}));
const downloads=join(homedir(),'Downloads');
const manifestPath='tests/artifacts/game-inputs.json';
const previous=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath)).paths:{};
const paths={};
for(const kind of ['disc','mcpx','flash','hdd','eeprom']) {
 const defaults={disc:join(downloads,'NBA Live 2002 (USA).iso'),mcpx:join(downloads,'mcpx_1.0.bin'),flash:join(downloads,'Complex_4627.bin'),hdd:join(downloads,'xemu-test-hdd.qcow2')};
 const path=options[kind]||process.env[`XEMU_${kind.toUpperCase()}_PATH`]||previous[kind]||defaults[kind];
 if(path)paths[kind]=resolve(path);
}
const hddSource={url:'https://github.com/xemu-project/xemu-dashboard/releases/download/v20260516-0955/xbox_hdd.qcow2',sha256:'00d7df7a2bc235f8801764f00b7f40e194d1e392f7a9619d6b2396c89770f6dd'};
if(!existsSync(paths.hdd)&&!options.hdd&&!process.env.XEMU_HDD_PATH) {
 const response=await fetch(hddSource.url);if(!response.ok)throw Error(`HDD download failed: ${response.status}`);
 const data=Buffer.from(await response.arrayBuffer());
 if(createHash('sha256').update(data).digest('hex')!==hddSource.sha256)throw Error('Official HDD checksum mismatch');
 writeFileSync(paths.hdd,data,{flag:'wx'});
}
function header(path,offset,length){const fd=openSync(path,'r');try{const bytes=Buffer.alloc(length);const count=readSync(fd,bytes,0,length,offset);return bytes.subarray(0,count);}finally{closeSync(fd);}}
const missing=[],invalid=[],checks={};
for(const kind of ['disc','mcpx','flash','hdd']) {
 const path=paths[kind];if(!path||!existsSync(path)){missing.push(kind);continue;}
 const size=statSync(path).size;checks[kind]={path,size};
 if(kind==='disc'&&header(path,0x10000,20).toString()!=='MICROSOFT*XBOX*MEDIA')invalid.push('disc: expected an Xbox xiso image');
 if(kind==='mcpx') {
  if(size!==512)invalid.push('mcpx: expected a 512-byte MCPX boot ROM');
  else if(createHash('md5').update(readFileSync(path)).digest('hex')!=='d49c52a4102f6df7bcf8d0617ac475ed')invalid.push('mcpx: checksum does not match the documented MCPX 1.0 dump');
 }
 if(kind==='flash'&&(size<65536||size>1048576||size%65536))invalid.push('flash: unsupported BIOS image size');
 if(kind==='hdd'&&header(path,0,4).toString('hex')!=='514649fb')invalid.push('hdd: expected a qcow2 image');
}
const report={paths,checks,missing,invalid,ready:!missing.length&&!invalid.length,hddSource};
mkdirSync('tests/artifacts',{recursive:true});writeFileSync(manifestPath,JSON.stringify(report,null,2)+'\n');
for(const [kind,check]of Object.entries(checks))console.log(`${kind}: ${check.path} (${check.size} bytes)`);
for(const error of invalid)console.log(`Invalid: ${error}`);
console.log(report.ready?'Ready: npm run test:game':`Not boot-ready. Missing: ${missing.join(', ')||'none'}.`);
console.log('Add your ROM/BIOS: npm run prepare:game -- --mcpx=/path/mcpx_1.0.bin --flash=/path/bios.bin');
console.log('Local input manifest: '+manifestPath);
