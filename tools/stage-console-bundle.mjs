// Stage user-requested console data only in ignored deployment output, never Git.
import {createReadStream,createWriteStream} from 'node:fs';
import {readFile,mkdir,rename,unlink,link,copyFile,stat} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile('app/console-bundle.json','utf8'));
await mkdir('web',{recursive:true});
const target='web/console-files.zip',temporary=target+'.partial';
await unlink(temporary).catch(()=>{});
try{
 const source=process.argv.find(arg=>arg.startsWith('--from='))?.slice(7);
 if(source){try{await link(source,temporary);}catch{await copyFile(source,temporary);}}
 else{const response=await fetch(manifest.source);if(!response.ok)throw Error(`Console bundle HTTP ${response.status}`);await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary));}
 const hash=createHash('sha256');for await(const chunk of createReadStream(temporary))hash.update(chunk);
 if((await stat(temporary)).size!==manifest.size||hash.digest('hex')!==manifest.sha256)throw Error('Console bundle checksum/size mismatch');
 await rename(temporary,target);console.log(`Staged verified console ZIP (${manifest.size} bytes) in ignored web/`);
}catch(error){await unlink(temporary).catch(()=>{});throw error;}
