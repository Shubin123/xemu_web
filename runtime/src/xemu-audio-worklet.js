// AudioWorklet that plays the core's audio ring (ui/web/xemu-web.h) directly
// from shared wasm memory: 48 kHz stereo s16 with free-running frame counters.
// The core paces its APU against the ring's fill level, so this processor only
// consumes; it resamples linearly when the context rate is not 48 kHz.

const WRITE = 0, READ = 1, UNDERRUNS = 6;

class XemuAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.header = new Uint32Array(o.buffer, o.ring, 8);
    this.samples = new Int16Array(o.buffer, o.samples, o.frames * 2);
    this.capacity = o.frames;
    this.step = 48000 / sampleRate;
    this.phase = 0;
    this.prevL = 0;
    this.prevR = 0;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0], right = out[1] || out[0];
    const n = left.length;
    let read = Atomics.load(this.header, READ);
    const write = Atomics.load(this.header, WRITE);
    let available = (write - read) >>> 0;
    const scale = 1 / 32768;

    if (this.step === 1) {
      const take = Math.min(n, available);
      for (let i = 0; i < take; i++) {
        const at = ((read + i) % this.capacity) * 2;
        left[i] = this.samples[at] * scale;
        right[i] = this.samples[at + 1] * scale;
      }
      if (take > 0) {
        this.prevL = left[take - 1];
        this.prevR = right[take - 1];
      }
      for (let i = take; i < n; i++) {
        left[i] = this.prevL *= 0.995;
        right[i] = this.prevR *= 0.995;
      }
      if (take < n) Atomics.add(this.header, UNDERRUNS, 1);
      Atomics.store(this.header, READ, (read + take) >>> 0);
      return true;
    }

    // Linear interpolation between consecutive source frames.
    let starved = false;
    for (let i = 0; i < n; i++) {
      let curL = this.prevL, curR = this.prevR;
      if (available > 0) {
        const at = (read % this.capacity) * 2;
        curL = this.samples[at] * scale;
        curR = this.samples[at + 1] * scale;
      } else {
        starved = true;
      }
      left[i] = this.prevL + (curL - this.prevL) * this.phase;
      right[i] = this.prevR + (curR - this.prevR) * this.phase;
      this.phase += this.step;
      while (this.phase >= 1) {
        this.phase -= 1;
        this.prevL = curL;
        this.prevR = curR;
        if (available > 0) {
          read = (read + 1) >>> 0;
          available--;
          if (available > 0) {
            const at = (read % this.capacity) * 2;
            curL = this.samples[at] * scale;
            curR = this.samples[at + 1] * scale;
          }
        }
      }
    }
    if (starved) Atomics.add(this.header, UNDERRUNS, 1);
    Atomics.store(this.header, READ, read);
    return true;
  }
}

registerProcessor('xemu-audio', XemuAudioProcessor);
