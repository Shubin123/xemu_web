import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve('web');
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  try {
    const path=resolve(root, '.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403).end();return;}
    const file=(await stat(path)).isDirectory()?resolve(path,'index.html'):path;
    await stat(file);res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');
    createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  }catch{res.writeHead(404).end('Not found');}
});
server.listen(Number(process.env.PORT||8080),'127.0.0.1',()=>console.log(`http://localhost:${server.address().port}`));
