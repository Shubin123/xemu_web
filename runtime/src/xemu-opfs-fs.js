// A minimal Emscripten filesystem exposing single files from the Origin
// Private File System through FileSystemSyncAccessHandle.
//
// The Xbox hard disk image is large and written at random offsets. Keeping it
// in memory (MEMFS) would cost hundreds of megabytes and lose writes on a
// crash; WORKERFS is read-only. Sync access handles give in-place reads and
// writes straight into wasm memory. They only exist in dedicated workers,
// which is where Emscripten runs proxied file syscalls in this build.

const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;

async function openHandle(path, writable) {
  let dir = await navigator.storage.getDirectory();
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  for (const part of parts) dir = await dir.getDirectoryHandle(part, {create: writable});
  const file = await dir.getFileHandle(name, {create: writable});
  return file.createSyncAccessHandle();
}

function makeFs(FS, entries) {
  const ENOENT = 44, EPERM = 63, EINVAL = 28, EACCES = 2;
  const stat = node => ({
    dev: 1, ino: node.id, mode: node.mode, nlink: 1, uid: 0, gid: 0, rdev: 0,
    size: node.handle ? node.handle.getSize() : 4096,
    atime: new Date(node.atime), mtime: new Date(node.mtime), ctime: new Date(node.ctime),
    blksize: 4096, blocks: Math.ceil((node.handle ? node.handle.getSize() : 4096) / 4096),
  });
  const OPFSFS = {
    mount() {
      const root = OPFSFS.createNode(null, '/', S_IFDIR | 0o777);
      for (const entry of entries) {
        const node = OPFSFS.createNode(root, entry.name, S_IFREG | (entry.writable ? 0o666 : 0o444));
        node.handle = entry.handle;
        node.writable = entry.writable;
      }
      return root;
    },
    createNode(parent, name, mode) {
      const node = FS.createNode(parent, name, mode);
      node.node_ops = OPFSFS.node_ops;
      node.stream_ops = OPFSFS.stream_ops;
      node.atime = node.mtime = node.ctime = Date.now();
      node.contents = {};
      if (parent) parent.contents[name] = node;
      return node;
    },
    node_ops: {
      getattr: stat,
      setattr(node, attr) {
        if (attr.size != null) {
          if (!node.writable) throw new FS.ErrnoError(EACCES);
          node.handle.truncate(attr.size);
        }
        for (const key of ['mode', 'atime', 'mtime', 'ctime']) {
          if (attr[key] != null) node[key] = attr[key];
        }
      },
      lookup() { throw new FS.ErrnoError(ENOENT); },
      mknod() { throw new FS.ErrnoError(EPERM); },
      rename() { throw new FS.ErrnoError(EPERM); },
      unlink() { throw new FS.ErrnoError(EPERM); },
      rmdir() { throw new FS.ErrnoError(EPERM); },
      readdir(node) { return ['.', '..', ...Object.keys(node.contents)]; },
      symlink() { throw new FS.ErrnoError(EPERM); },
    },
    stream_ops: {
      read(stream, buffer, offset, length, position) {
        return stream.node.handle.read(buffer.subarray(offset, offset + length), {at: position});
      },
      write(stream, buffer, offset, length, position) {
        if (!stream.node.writable) throw new FS.ErrnoError(EACCES);
        const n = stream.node.handle.write(buffer.subarray(offset, offset + length), {at: position});
        stream.node.mtime = Date.now();
        return n;
      },
      llseek(stream, offset, whence) {
        let position = offset;
        if (whence === 1) position += stream.position;
        else if (whence === 2) position += stream.node.handle.getSize();
        if (position < 0) throw new FS.ErrnoError(EINVAL);
        return position;
      },
      fsync(stream) {
        stream.node.handle.flush();
        return 0;
      },
    },
  };
  return OPFSFS;
}

const handles = new Set();

/**
 * Mounts OPFS file `opfsPath` at `${dir}/${name}` in the Emscripten FS.
 * Each mount gets its own directory node, so several files can be mounted.
 */
export async function mountOpfsFile(Module, FS, opfsPath, dir, name, {writable = false} = {}) {
  const handle = await openHandle(opfsPath, writable);
  handles.add(handle);
  const mountDir = `${dir}/.opfs-${name}`;
  try { FS.mkdir(mountDir); } catch (e) { /* exists */ }
  FS.mount(makeFs(FS, [{name, handle, writable}]), {}, mountDir);
  try { FS.unlink(`${dir}/${name}`); } catch (e) { /* absent */ }
  FS.symlink(`${mountDir}/${name}`, `${dir}/${name}`);
  return handle;
}

/** Flushes every mounted OPFS file (e.g. before the page unloads). */
export function flushOpfsFiles() {
  for (const handle of handles) {
    try { handle.flush(); } catch (e) { /* closed */ }
  }
}
