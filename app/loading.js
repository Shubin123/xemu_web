const panel=document.getElementById('loading-panel');
const bar=document.getElementById('progress');
const label=document.getElementById('loading-label');
const detail=document.getElementById('loading-detail');
export function showLoading(text, fraction=null, note='') {
  panel.hidden=false;label.textContent=text;detail.textContent=note;
  if(fraction===null)bar.removeAttribute('value');
  else bar.value=Math.max(0,Math.min(1,fraction))*100;
  panel.setAttribute('aria-busy','true');
}
export function hideLoading() {panel.hidden=true;panel.setAttribute('aria-busy','false');}
const mb=bytes=>(bytes/1024**2).toFixed(1);
export async function downloadEngine() {
  showLoading('Downloading engine…');
  const inventory=await fetch(new URL('./runtime.json',import.meta.url));
  if(!inventory.ok)throw Error(`Unable to load engine inventory (HTTP ${inventory.status})`);
  const manifest=await inventory.json();
  const size=manifest.files.find(f=>f.path==='cores/xemu/xemu-core.wasm')?.size;
  const response=await fetch(new URL('./cores/xemu/xemu-core.wasm',import.meta.url));
  if(!response.ok)throw Error(`Unable to download engine (HTTP ${response.status}). Try Load & Run again.`);
  if(!response.body)return response.arrayBuffer();
  const reader=response.body.getReader();
  const chunks=[];let received=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.byteLength;
      showLoading('Downloading engine…',size?received/size:null,
        size?`${Math.min(100,Math.round(received/size*100))}% · ${mb(received)} / ${mb(size)} MB`:`${mb(received)} MB received`);
    }
  }finally{reader.releaseLock();}
  const binary=new Uint8Array(received);let offset=0;
  for(const chunk of chunks){binary.set(chunk,offset);offset+=chunk.byteLength;}
  showLoading('Engine downloaded',1,`${mb(received)} MB`);
  return binary.buffer;
}
