import assert from 'node:assert/strict';
import {RetryingRangeReader} from '../app/range-reader.js';

const originalFetch=globalThis.fetch,source=Uint8Array.from({length:128},(_,i)=>i),requests=[];
try {
  let interrupted=false;
  globalThis.fetch=async(_url,{headers})=>{
    const range=headers.Range;requests.push(range);
    const [,start,end]=/bytes=(\d+)-(\d+)/.exec(range).map(Number);
    const data=source.slice(start,end+1);
    const body=!interrupted?(interrupted=true,new ReadableStream({start(controller){controller.enqueue(data.slice(0,2));},pull(controller){controller.error(new TypeError('network error'));}})):data;
    return new Response(body,{status:206,headers:{'Content-Range':`bytes ${start}-${end}/128`,ETag:'"same-file"'}});
  };
  const reader=new RetryingRangeReader('https://example.test/bundle.zip',128,{chunkSize:64});
  const actual=new Uint8Array(await new Response(reader.createReadable({size:128})).arrayBuffer());
  assert.deepEqual(actual,source,'Retry must not duplicate partially received bytes');
  assert.deepEqual(requests,['bytes=0-63','bytes=0-63','bytes=64-127']);

  const controller=new AbortController();let calls=0;
  globalThis.fetch=async()=>{calls++;controller.abort();throw new TypeError('network error');};
  await assert.rejects(new RetryingRangeReader('https://example.test/bundle.zip',128,{signal:controller.signal}).readUint8Array(0,64),{name:'AbortError'});
  assert.equal(calls,1,'Cancellation must stop retries');

  calls=0;globalThis.fetch=async()=>{calls++;return new Response(source.slice(0,64),{status:206,headers:{'Content-Range':'bytes 64-127/128'}});};
  await assert.rejects(new RetryingRangeReader('https://example.test/bundle.zip',128,{attempts:2}).readUint8Array(0,64),/Console download interrupted/);
  assert.equal(calls,2,'Invalid responses must not retry forever');
  console.log('Mid-body network failure resumes without duplicated bytes, cancellation and bounded failure passed');
} finally {globalThis.fetch=originalFetch;}
