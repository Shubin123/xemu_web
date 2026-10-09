import {cpSync,mkdirSync,existsSync,readFileSync,rmSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('runtime');
if(!existsSync('runtime/runtime.json'))throw Error('Run npm run import:runtime with the built sibling backend');
const manifest=JSON.parse(readFileSync('runtime/runtime.json'));
for(const file of manifest.files){const path=resolve(root,file.path);if(!path.startsWith(root+'/'))throw Error('Invalid runtime path');const bytes=readFileSync(path);if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error(`Runtime checksum mismatch: ${file.path}`);}
const wasm=readFileSync('runtime/cores/xemu/xemu-core.wasm');
if(!WebAssembly.validate(wasm)||manifest.coreId!==`sha256:${createHash('sha256').update(wasm).digest('hex')}`)throw Error('Invalid WebAssembly core');
rmSync('web',{recursive:true,force:true});mkdirSync('web',{recursive:true});
cpSync('app','web',{recursive:true});cpSync('runtime/src','web/src',{recursive:true});cpSync('runtime/cores','web/cores',{recursive:true});cpSync('runtime/source','web/source',{recursive:true});cpSync('runtime/runtime.json','web/runtime.json');
// A release key covers the complete UI and imported runtime, including modules
// loaded from workers. The service worker applies it to same-scope requests.
const releaseHash=createHash('sha256').update(JSON.stringify(manifest));
function hashApp(dir){for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=`${dir}/${entry.name}`;if(entry.isDirectory())hashApp(path);else releaseHash.update(path).update(readFileSync(path));}}
hashApp('app');
const release=releaseHash.digest('hex').slice(0,16);
const worker='web/coi-serviceworker.js';
writeFileSync(worker,readFileSync(worker,'utf8').replace('__XEMU_RELEASE__',release));
writeFileSync('web/release.json',JSON.stringify({release,coreId:manifest.coreId})+'\n');
// Content versions prevent an old stylesheet or entry script from surviving a deploy.
for(const file of readdirSync('web').filter(name=>name.endsWith('.html'))){
  const path=`web/${file}`;
  const html=readFileSync(path,'utf8').replace(/(href|src)="([^"?#]+)(?:\?[^"#]*)?"/g,(match,attribute,url)=>{
    if(/^(?:https?:|data:|\/)/.test(url)||!(/\.(?:css|js|svg)$/.test(url)))return match;
    const asset=resolve('web',url);
    if(!existsSync(asset))return match;
    const version=createHash('sha256').update(readFileSync(asset)).digest('hex').slice(0,12);
    return `${attribute}="${url}?v=${version}"`;
  });
  writeFileSync(path,html);
}
writeFileSync('web/.nojekyll','');
console.log(`Built self-contained web/ · ${manifest.coreId}`);
