import {Reader} from './vendor/zip/zip-core-external.min.js';

// Finish each small response before passing bytes to the ZIP decoder. A failed
// body can then be retried without replaying bytes into the decompressor.
export class RetryingRangeReader extends Reader {
  constructor(url, size, {signal, chunkSize = 4 * 1024 ** 2, attempts = 4} = {}) {
    super();
    Object.assign(this, {url, size, signal, chunkSize, attempts});
  }

  createReadable(options = {}) {
    return super.createReadable({...options, chunkSize: this.chunkSize});
  }

  async readUint8Array(offset, length) {
    length = Math.min(length, this.size - offset);
    if (length <= 0) return new Uint8Array();
    const end = offset + length - 1;
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      this.signal?.throwIfAborted();
      if (attempt) await retryDelay(250 * 2 ** (attempt - 1), this.signal);
      const controller = new AbortController();
      const cancel = () => controller.abort(this.signal.reason);
      this.signal?.addEventListener('abort', cancel, {once: true});
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(this.url, {
          headers: {Range: `bytes=${offset}-${end}`},
          cache: 'no-store', signal: controller.signal
        });
        const range = response.headers.get('content-range');
        const etag = response.headers.get('etag');
        if (response.status !== 206 || range !== `bytes ${offset}-${end}/${this.size}`) {
          await response.body?.cancel();
          throw Error(`Console download returned an invalid byte range (HTTP ${response.status})`);
        }
        if (this.etag && etag && this.etag !== etag) {
          await response.body.cancel();
          throw Error('Console download changed during setup; retry setup');
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== length) throw Error('Incomplete console download chunk');
        if (etag) this.etag = etag;
        return bytes;
      } catch (error) {
        this.signal?.throwIfAborted();
        if (attempt + 1 === this.attempts) {
          throw new Error('Console download interrupted. Retry setup, or download the setup ZIP and import it locally.', {cause: error});
        }
      } finally {
        clearTimeout(timeout);
        this.signal?.removeEventListener('abort', cancel);
      }
    }
  }
}

function retryDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => {signal?.removeEventListener('abort', cancel);resolve();};
    const timer = setTimeout(finish, ms);
    const cancel = () => {clearTimeout(timer);signal.removeEventListener('abort', cancel);reject(signal.reason);};
    signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) cancel();
  });
}
