const PREFIX = 'xemu-web';
async function directory() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(PREFIX, {create: true});
}
export async function readCatalog() {
  const dir = await directory();
  let file;
  try { file = await dir.getFileHandle('catalog.json'); }
  catch (error) { if (error.name === 'NotFoundError') return {console: {}, discs: []}; throw error; }
  return JSON.parse(await (await file.getFile()).text());
}
export async function writeCatalog(catalog) {
  const file = await (await directory()).getFileHandle('catalog.json', {create: true});
  const writer = await file.createWritable();
  await writer.write(JSON.stringify(catalog));
  await writer.close();
}
// New filenames keep an interrupted import from damaging the current disk/saves.
export async function importFile(file, onProgress = () => {}) {
  const dir = await directory();
  const name = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const writer = await (await dir.getFileHandle(name, {create: true})).createWritable();
  let copied = 0;
  try {
    const progress = new TransformStream({transform(chunk, controller) {
      copied += chunk.byteLength;
      onProgress(file.size ? copied / file.size : 1);
      controller.enqueue(chunk);
    }});
    await file.stream().pipeThrough(progress).pipeTo(writer);
  } catch (error) {
    await dir.removeEntry(name).catch(() => {});
    throw error;
  }
  return {name: file.name, size: file.size, opfs: `${PREFIX}/${name}`, added: Date.now()};
}
export async function removeFile(entry) {
  if (entry?.opfs?.startsWith(`${PREFIX}/`)) {
    await (await directory()).removeEntry(entry.opfs.slice(PREFIX.length + 1));
  }
}
export async function storageSummary() {
  const {usage = 0, quota = 0} = await navigator.storage.estimate();
  return `${(usage / 1024 ** 3).toFixed(2)} GB used / ${(quota / 1024 ** 3).toFixed(1)} GB available quota`;
}
