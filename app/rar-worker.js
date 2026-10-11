import {createExtractorFromData} from './vendor/unrar/index.js';
import {writeXiso,planXiso} from './xiso.js';
self.onmessage=async({data:{file,output}})=>{
  let writer,dir;
  try {
    self.postMessage({progress:0,label:'Opening RAR archive…'});
    const response=await fetch(new URL('./vendor/unrar/js/unrar.wasm',import.meta.url));if(!response.ok)throw Error('RAR decoder unavailable');
    const extractor=await createExtractorFromData({wasmBinary:await response.arrayBuffer(),data:await file.arrayBuffer()});
    const listing=extractor.getFileList();
    if(listing.arcHeader.flags.volume)throw Error('Multipart RAR archives are not supported. Choose a complete single archive.');
    const headers=[...listing.fileHeaders];
    if(headers.some(h=>h.flags.encrypted))throw Error('Password-protected archives are not supported');
    let iterator;
    const entries=headers.map(header=>({name:header.name.replaceAll('\\','/'),size:header.unpSize,isDirectory:header.flags.directory,bytes:async()=>{
      const next=iterator.next();if(next.done||next.value.fileHeader.name!==header.name)throw Error('Unexpected archive member order');
      const bytes=next.value.extraction;
      // Release each decoded member after writing it, rather than retaining the whole game.
      const key=extractor.getExtractedFileName(header.name);delete extractor.dataFiles[key];
      for(const [fd,name] of Object.entries(extractor.dataFileMap))if(name===key)delete extractor.dataFileMap[fd];
      return bytes;
    }}));
    const images=entries.filter(e=>!e.isDirectory&&/\.(iso|xiso)$/i.test(e.name));
    const expected=images.length===1?images[0].size:planXiso(entries).size;
    const {usage=0,quota=0}=await navigator.storage.estimate();if(quota&&expected>quota-usage)throw Error(`Not enough browser storage: this disc needs ${(expected/1024**3).toFixed(2)} GB free. Remove cached games or free disk space.`);
    dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('xemu-web',{create:true});
    writer=await(await dir.getFileHandle(output,{create:true})).createWritable();
    const selected=images.length?images:planXiso(entries).files.map(f=>f.entry);const names=new Set(selected.map(e=>e.name));
    iterator=extractor.extract({files:h=>names.has(h.name.replaceAll('\\','/'))}).files;
    let size;
    if(images.length){if(images.length!==1)throw Error('Select an archive containing a single disc');const bytes=await images[0].bytes();size=bytes.length;await writer.write(bytes);}
    else size=await writeXiso(entries,writer,(progress,label)=>self.postMessage({progress,label}));
    if(!iterator.next().done)throw Error('Unexpected extra archive member');
    await writer.close();writer=null;
    const saved=await(await dir.getFileHandle(output)).getFile();
    if(await saved.slice(0x10000,0x10000+20).text()!=='MICROSOFT*XBOX*MEDIA')throw Error('Archive disc is not an Xbox xiso image');
    self.postMessage({result:{name:file.name.replace(/\.rar$/i,'.xiso'),size,opfs:`xemu-web/${output}`,added:Date.now()}});
  } catch(error){await writer?.abort().catch(()=>{});await dir?.removeEntry(output).catch(()=>{});self.postMessage({error:error.message||String(error)});}

};
