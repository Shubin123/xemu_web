import {writeFile} from 'node:fs/promises';
export function catalogFromMetadata(metadata){
 const collection='mxogcx-xbox-ztm';
 const games=metadata.files.filter(f=>/\.(rar|iso|xiso)$/i.test(f.name)).map(f=>({id:`archive:${f.name}`,name:f.name,size:Number(f.size),added:0,remote:true,restricted:f.private===true||f.private==='true',url:`https://archive.org/cors/${collection}/${f.name.split('/').map(encodeURIComponent).join('/')}`}));
 return {collection,source:`https://archive.org/download/${collection}`,games};
}
if(process.argv[1]?.endsWith('generate-library.mjs')){
 const response=await fetch('https://archive.org/metadata/mxogcx-xbox-ztm');if(!response.ok)throw Error(`Catalog HTTP ${response.status}`);
 const catalog=catalogFromMetadata(await response.json());await writeFile('app/games-library.json',JSON.stringify(catalog,null,2)+'\n');console.log(`${catalog.games.length} Xbox games`);
}
