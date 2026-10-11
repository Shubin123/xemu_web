// Assemble a session disc as Blob parts, without a second contiguous image buffer.
export function blobImageWriter() {
  let size=0,position=0;const writes=[];
  const zeros=new Uint8Array(65536);
  function padding(length){const parts=[];while(length>0){const count=Math.min(length,zeros.length);parts.push(zeros.subarray(0,count));length-=count;}return new Blob(parts);}
  return {
    async truncate(length){size=length;},
    async write(value){const at=value.type==='write'?value.position:position;const data=value.type==='write'?value.data:value;const blob=new Blob([data]);writes.push({at,blob});position=at+blob.size;size=Math.max(size,position);},
    async close(){},async abort(){writes.length=0;},
    file(name){let offset=0;const parts=[];for(const {at,blob} of writes.sort((a,b)=>a.at-b.at)){if(at<offset)throw Error('Overlapping image writes');if(at>offset)parts.push(padding(at-offset));parts.push(blob);offset=at+blob.size;}if(offset<size)parts.push(padding(size-offset));return new File(parts,name);},
  };
}
