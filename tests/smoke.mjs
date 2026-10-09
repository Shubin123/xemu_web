import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const page=readFileSync('web/index.html','utf8');
for(const match of page.matchAll(/(?:src|href)="([^"#]+)"/g)){if(/^(https?:|data:)/.test(match[1]))continue;assert.ok(readFileSync(join('web',match[1])).length,match[1]);}
const record=JSON.parse(readFileSync('web/runtime.json'));
for(const f of record.files){const bytes=readFileSync(join('web',f.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256,f.path);}
assert.ok(WebAssembly.validate(readFileSync('web/cores/xemu/xemu-core.wasm')));
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory())walk(path);else assert.ok(!/\.(?:qcow2|iso|xiso|bin|rom|state)$/i.test(e.name),`User media must not be published: ${path}`);}}
walk('web');console.log('Pages artifact checks passed');
