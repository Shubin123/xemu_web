import {cpSync,mkdirSync,readFileSync,readdirSync,writeFileSync,rmSync,mkdtempSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
const backend=resolve(process.argv[2]||'../xemu_emscripten');
const record=JSON.parse(readFileSync(join(backend,'cores/xemu/xemu-core.build.json')));
if(record.vendorDirty)throw Error('Refusing runtime built from an uncommitted vendor tree');
for(const file of record.files){const data=readFileSync(join(backend,'cores/xemu',file.path));if(createHash('sha256').update(data).digest('hex')!==file.sha256)throw Error(`Invalid backend artifact: ${file.path}`);}
rmSync('runtime',{recursive:true,force:true});mkdirSync('runtime/cores',{recursive:true});
cpSync(join(backend,'src'),'runtime/src',{recursive:true});cpSync(join(backend,'cores/xemu'),'runtime/cores/xemu',{recursive:true});
const backendCommit=execFileSync('git',['-C',backend,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const temp=mkdtempSync(join(tmpdir(),'xemu-source-'));
let archiveSha256;
try {
  const archive=join(temp,'xemu-source.tar.gz');
  execFileSync('git',['-C',backend,'archive','--format=tar.gz',`--output=${archive}`,'HEAD',
    'AGENTS.md','README.md','LICENSE','.gitignore','docs','tools','package.json','package-lock.json',
    'patches','provenance','src','tests','vendor/source']);
  const bytes=readFileSync(archive);archiveSha256=createHash('sha256').update(bytes).digest('hex');
  mkdirSync('runtime/source',{recursive:true});
  const partSize=32*1024*1024;
  for(let offset=0,index=0;offset<bytes.length;offset+=partSize,index++)
    writeFileSync(`runtime/source/xemu-source.tar.gz.part${String(index).padStart(2,'0')}`,bytes.subarray(offset,offset+partSize));
} finally {rmSync(temp,{recursive:true,force:true});}
const inventory=[];
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else{const bytes=readFileSync(path);inventory.push({path:relative('runtime',path).split('\\').join('/'),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}}
walk('runtime');
writeFileSync('runtime/runtime.json',JSON.stringify({schemaVersion:1,backend:'Shubin123/xemu_emscripten',backendCommit,sourceArchiveSha256:archiveSha256,coreId:record.coreId,files:inventory},null,2)+'\n');
console.log(`Imported ${record.coreId}`);
