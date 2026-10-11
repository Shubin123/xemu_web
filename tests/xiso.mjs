import assert from 'node:assert/strict';
import {blobImageWriter} from '../app/blob-image.js';
import {planXiso,writeXiso} from '../app/xiso.js';
const entries=['Game/default.xbe','Game/a.txt',...Array.from({length:140},(_,i)=>`Game/Sub/File${i.toString().padStart(3,'0')}.dat`)].map(name=>({name,size:4,bytes:async()=>new TextEncoder().encode('XBEH')}));
const plan=planXiso(entries);let output;
await writeXiso(entries,{truncate:async size=>{output=new Uint8Array(size);},write:async({position,data})=>{output.set(data,position);}});
assert.equal(new TextDecoder().decode(output.subarray(0x10000,0x10014)),'MICROSOFT*XBOX*MEDIA');
for(const table of plan.tables){const v=new DataView(output.buffer,table.position,table.bytes.length),seen=new Set();
 function visit(o){assert.ok(!seen.has(o));seen.add(o);const len=v.getUint8(o+13);assert.ok(o%2048+14+len<=2048);const left=v.getUint16(o,true),right=v.getUint16(o+2,true);if(left)visit(left*4);if(right)visit(right*4);}
 visit(0);assert.ok(seen.size>0);
}
for(const file of plan.files)assert.equal(new TextDecoder().decode(output.subarray(file.sector*2048,file.sector*2048+4)),'XBEH');
assert.throws(()=>planXiso([...entries,{name:'../bad',size:1}]),/Unsafe/);
assert.throws(()=>planXiso([...entries,{name:'Game/A.TXT',size:1}]),/Duplicate/);
assert.throws(()=>planXiso([]),/default.xbe/);
assert.throws(()=>planXiso([...entries,{name:'Other/default.xbe',size:4}]),/one game/);
console.log('XDVDFS directory trees, sector boundaries, file payloads and unsafe archives passed');

const blobWriter=blobImageWriter();await writeXiso(entries,blobWriter);const blob=blobWriter.file('generated-test.xiso');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),output);console.log('Session Blob disc matches cached image byte for byte');
