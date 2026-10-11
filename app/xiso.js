// XDVDFS: 2048-byte sectors, balanced directory trees with DWORD child offsets.
const sectorSize=2048, align=(n,a)=>Math.ceil(n/a)*a;
export function planXiso(entries) {
  const executables=entries.filter(e=>/(^|\/)default\.xbe$/i.test(e.name));
  if(executables.length!==1)throw Error('Archive must contain one game with default.xbe');
  const prefix=executables[0].name.slice(0,-11);
  const root={children:new Map()}, files=[], directories=[];
  for(const entry of entries){
    const path=entry.name.replaceAll('\\','/');
    if(path.startsWith('/')||path.split('/').includes('..')||/^[a-z]:/i.test(path))throw Error('Unsafe archive path');
    if(!path.startsWith(prefix)||entry.isDirectory)continue;
    const parts=path.slice(prefix.length).split('/');let dir=root;
    for(let i=0;i<parts.length;i++){
      const name=parts[i];if(!name||/[^\x20-\x7e]/.test(name)||name.length>255)throw Error('Unsupported Xbox filename');
      let child=dir.children.get(name.toUpperCase());const directory=i<parts.length-1;
      if(child){if(!directory||!child.children)throw Error('Duplicate archive path');}
      else {child={name,...(directory?{children:new Map()}:{entry,size:entry.size})};dir.children.set(name.toUpperCase(),child);if(!directory){if(!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>0xffffffff)throw Error('File exceeds Xbox size limit');files.push(child);}}
      dir=child;
    }
  }
  function layout(dir){
    directories.push(dir);let offset=0;dir.nodes=[];
    const sorted=[...dir.children.values()].sort((a,b)=>a.name.toUpperCase()<b.name.toUpperCase()?-1:1);
    function tree(list){if(!list.length)return null;const middle=list.length>>1,node=list[middle],length=align(14+node.name.length,4);
      if(offset%sectorSize+length>sectorSize)offset=align(offset,sectorSize);
      node.offset=offset;offset+=length;if(node.offset/4>65535)throw Error('Xbox directory is too large');dir.nodes.push(node);
      node.left=tree(list.slice(0,middle));node.right=tree(list.slice(middle+1));return node;}
    tree(sorted);dir.size=align(Math.max(offset,1),sectorSize);
    for(const node of sorted)if(node.children)layout(node);
  }
  layout(root);let sector=0x108;
  for(const node of [...directories,...files]){node.sector=sector;sector+=Math.ceil(node.size/sectorSize);}
  const size=align(sector*sectorSize,0x10000);if(size/sectorSize>0xffffffff)throw Error('Disc is too large');
  const header=new Uint8Array(sectorSize),magic=new TextEncoder().encode('MICROSOFT*XBOX*MEDIA');header.set(magic);header.set(magic,sectorSize-20);
  const view=new DataView(header.buffer);view.setUint32(20,root.sector,true);view.setUint32(24,root.size,true);
  const tables=directories.map(dir=>{const bytes=new Uint8Array(dir.size).fill(0xff),v=new DataView(bytes.buffer);
    for(const node of dir.nodes){const o=node.offset;v.setUint16(o,node.left?node.left.offset/4:0,true);v.setUint16(o+2,node.right?node.right.offset/4:0,true);v.setUint32(o+4,node.sector,true);v.setUint32(o+8,node.size,true);bytes[o+12]=node.children?0x10:0x20;bytes[o+13]=node.name.length;bytes.set(new TextEncoder().encode(node.name),o+14);}
    return {position:dir.sector*sectorSize,bytes};});
  return {size,header,tables,files};
}
export async function writeXiso(entries, writer, progress=()=>{}) {
  const plan=planXiso(entries);await writer.truncate(plan.size);
  await writer.write({type:'write',position:0x10000,data:plan.header});
  for(const table of plan.tables)await writer.write({type:'write',position:table.position,data:table.bytes});
  let count=0;
  for(const file of plan.files){progress(count/plan.files.length,`Extracting ${file.entry.name}`);const bytes=await file.entry.bytes();if(bytes.length!==file.size)throw Error('Truncated archive member');await writer.write({type:'write',position:file.sector*sectorSize,data:bytes});count++;}
  progress(1,'Xbox disc ready');return plan.size;
}
