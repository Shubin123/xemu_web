import {cpSync,mkdirSync,existsSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
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
writeFileSync('web/.nojekyll','');
console.log(`Built self-contained web/ · ${manifest.coreId}`);
