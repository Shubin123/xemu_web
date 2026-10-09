import {cpSync, mkdirSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
const backend = resolve(process.argv[2] || '../xemu_emscripten');
if (!existsSync(`${backend}/cores/xemu/xemu-core.wasm`)) throw new Error('Build the backend core first');
mkdirSync('web', {recursive:true});
cpSync('app', 'web', {recursive:true});
cpSync(`${backend}/src`, 'web/src', {recursive:true});
cpSync(`${backend}/cores/xemu`, 'web/cores/xemu', {recursive:true});
console.log('Built web/ with local backend runtime');
