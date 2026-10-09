// Keep a bounded boot trace without logging every rendered frame.
export function createDebugTrace({log, canvas, getStats}) {
  let entries = [];
  function record(stage, detail = {}) {
    const entry = {time: new Date().toISOString(), stage, detail};
    entries.push(entry);
    entries = entries.slice(-500);
    log.textContent = `${log.textContent}[${entry.time}] ${stage} ${JSON.stringify(detail)}\n`.slice(-20000);
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return {
    record,
    clear() { entries = []; log.textContent = ''; },
    export() {
      download(new Blob([JSON.stringify({entries, stats: getStats(), log: log.textContent}, null, 2)],
        {type: 'application/json'}), 'xemu-debug.json');
    },
    async capture() {
      const frame = new OffscreenCanvas(canvas.width, canvas.height);
      const context = frame.getContext('2d');
      context.drawImage(canvas, 0, 0);
      const pixels = context.getImageData(0, 0, frame.width, frame.height).data;
      let nonblackPixels = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) nonblackPixels++;
      const stats = getStats();
      record('framebuffer', {width: frame.width, height: frame.height, nonblackPixels,
        receivedFrames: stats?.framesConsumed || 0});
      download(await frame.convertToBlob({type: 'image/png'}), 'xemu-framebuffer.png');
    },
  };
}
