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
    const info=await stat(file);res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');
    res.setHeader('Accept-Ranges','bytes');
    let start=0,end=info.size-1;
    if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416).end();return;}
      if(match[1]){start=Number(match[1]);if(match[2])end=Number(match[2]);}
      else start=Math.max(0,info.size-Number(match[2]));
      end=Math.min(end,info.size-1);if(start>end||start>=info.size){res.setHeader('Content-Range',`bytes */${info.size}`);res.writeHead(416).end();return;}
      res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);
    }
    res.setHeader('Content-Length',end-start+1);
    if(req.method==='HEAD'){res.end();return;}
    createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
  }catch{res.writeHead(404).end('Not found');}
});
server.listen(Number(process.env.PORT||8080),'127.0.0.1',()=>console.log(`http://localhost:${server.address().port}`));
