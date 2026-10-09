import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const manifest=JSON.parse(readFileSync('runtime/runtime.json'));
const parts=manifest.files.filter(f=>f.path.startsWith('source/')).sort((a,b)=>a.path.localeCompare(b.path));
const archive=Buffer.concat(parts.map(f=>readFileSync(join('runtime',f.path))));
assert.equal(createHash('sha256').update(archive).digest('hex'),manifest.sourceArchiveSha256);
const temp=mkdtempSync(join(tmpdir(),'xemu-published-source-'));
try{const tar=join(temp,'source.tar.gz');writeFileSync(tar,archive);execFileSync('tar',['-xzf',tar,'-C',temp]);execFileSync(process.execPath,['tools/setup.mjs','--source-only'],{cwd:temp,stdio:'inherit'});console.log('Published source archive reconstructs the locked engine offline');}finally{rmSync(temp,{recursive:true,force:true});}
