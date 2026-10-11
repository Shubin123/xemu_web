// Generated RAR 4 stored member. Contains only synthetic test data.
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function checksum(header){header.writeUInt16LE(crc32(header.subarray(2))&0xffff,0);return header;}
export function generatedRar(){
 const name=Buffer.from('Generated/default.xbe'),payload=Buffer.from('XBEHsynthetic-test-only');
 const main=Buffer.alloc(13);main[2]=0x73;main.writeUInt16LE(main.length,5);
 const file=Buffer.alloc(32+name.length);file[2]=0x74;file.writeUInt16LE(0x8000,3);file.writeUInt16LE(file.length,5);file.writeUInt32LE(payload.length,7);file.writeUInt32LE(payload.length,11);file[15]=3;file.writeUInt32LE(crc32(payload),16);file[24]=20;file[25]=0x30;file.writeUInt16LE(name.length,26);file.writeUInt32LE(0x20,28);name.copy(file,32);
 const end=Buffer.alloc(7);end[2]=0x7b;end.writeUInt16LE(7,5);
 return Buffer.concat([Buffer.from([0x52,0x61,0x72,0x21,0x1a,0x07,0]),checksum(main),checksum(file),payload,checksum(end)]);
}
