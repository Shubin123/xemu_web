import {ZipReader,BlobReader} from './vendor/zip/zip-core-external.min.js';
import {RetryingRangeReader} from './range-reader.js';
import {removeFile} from './storage.js';
export async function bundleManifest(){const response=await fetch(new URL('./console-bundle.json',import.meta.url));if(!response.ok)throw Error('Console bundle manifest unavailable');return response.json();}
export async function installConsoleBundle({file,existing=[],onProgress=()=>{},signal}={}){
 if(['mcpx','flash','hdd'].every(kind=>existing.includes(kind)))return {};
 const manifest=await bundleManifest(),needed=Object.keys(manifest.files).filter(kind=>!existing.includes(kind));
 if(!needed.length)return {};
 const reader=new ZipReader(file?new BlobReader(file):new RetryingRangeReader(new URL(manifest.url,import.meta.url).href,manifest.size,{signal}),{checkSignature:true});
 const installed={},created=[];let writer;
 try{
  onProgress('Opening console bundle…',null);
  const entries=await reader.getEntries({signal});
  const planned=needed.map(kind=>{const expected=manifest.files[kind],entry=entries.find(e=>e.filename===expected.path);if(!entry||entry.uncompressedSize!==expected.size)throw Error(`Console bundle missing or invalid ${kind} file`);return {kind,entry,expected};});
  const total=planned.reduce((sum,p)=>sum+p.expected.size,0);let completed=0;
  const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('xemu-web',{create:true});
  for(const {kind,entry,expected} of planned){
   if(signal?.aborted)throw new DOMException('Setup cancelled','AbortError');
   const name=`${crypto.randomUUID()}-${expected.name}`,record={name:expected.name,size:expected.size,opfs:`xemu-web/${name}`,added:Date.now()};created.push(record);
   const destination=await dir.getFileHandle(name,{create:true});writer=await destination.createWritable();let received=0;
   const output=new WritableStream({async write(chunk){received+=chunk.byteLength;await writer.write(chunk);onProgress(`Setting up ${kind==='hdd'?'Xbox hard disk':kind==='mcpx'?'MCPX boot ROM':'flash BIOS'}…`,(completed+received)/total);},async close(){await writer.close();writer=null;},async abort(reason){await writer?.abort(reason);writer=null;}});
   await entry.getData(output,{signal,checkSignature:true});
   const saved=await destination.getFile();if(saved.size!==expected.size)throw Error(`Incomplete ${kind} file`);
   const header=new Uint8Array(await saved.slice(0,4).arrayBuffer());
   if(kind==='hdd'&&header.join(',')!=='81,70,73,251')throw Error('Console bundle HDD is not qcow2');
   if(kind!=='hdd'){
    const digest=await crypto.subtle.digest('SHA-256',await saved.arrayBuffer());
    const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');if(hash!==expected.sha256)throw Error(`${kind} checksum mismatch`);
   }
   installed[kind]=record;completed+=received;
  }
  onProgress('Console files ready',1);return installed;
 }catch(error){await writer?.abort().catch(()=>{});for(const record of created)await removeFile(record).catch(()=>{});if(error.name==='QuotaExceededError')throw Error('Browser storage refused the console files. Free at least 1 GB and use a regular browser window, then retry.');throw error;}
 finally{await reader.close();}
}
