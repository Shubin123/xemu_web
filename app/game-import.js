export function extractRar(file,onProgress=()=>{},signal) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./rar-worker.js',import.meta.url),{type:'module'});
    const output=`${crypto.randomUUID()}.xiso`;
    const finish=(error,result)=>{worker.terminate();signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
    const abort=async()=>{worker.terminate();try{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('xemu-web');await dir.removeEntry(output);}catch{}finish(new DOMException('Import cancelled','AbortError'));};
    if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=e=>finish(Error(e.message));
    worker.onmessage=({data})=>{if(data.error)finish(Error(data.error));else if(data.result)finish(null,data.result);else onProgress(data.progress,data.label);};
    worker.postMessage({file,output});
  });
}

// Read-only cached discs can use WORKERFS Blobs. This also allows reinserting
// the same game while the engine still retains its previous disc mount.
export async function discSource(disc) {
  if(disc.file)return disc.file;
  const parts=disc.opfs.split('/');const name=parts.pop();let dir=await navigator.storage.getDirectory();
  for(const part of parts)dir=await dir.getDirectoryHandle(part);
  return (await dir.getFileHandle(name)).getFile();
}
