// Creates an empty qcow2 (version 3) disk image in memory.
//
// Layout with 64 KiB clusters: cluster 0 header, 1 refcount table,
// 2 refcount block (16-bit refcounts), 3 L1 table. Every L1 entry is zero,
// so the whole virtual disk reads as zeros until written.

export function createQcow2(virtualSize = 8 * 1024 ** 3) {
  const clusterBits = 16;
  const cluster = 1 << clusterBits;
  const l2Entries = cluster / 8;
  const l1Size = Math.ceil(virtualSize / (cluster * l2Entries));
  if (l1Size * 8 > cluster) throw new Error('Virtual size too large for a one-cluster L1 table');

  const image = new Uint8Array(cluster * 4);
  const view = new DataView(image.buffer);
  const u32 = (at, v) => view.setUint32(at, v);
  const u64 = (at, v) => view.setBigUint64(at, BigInt(v));

  u32(0, 0x514649fb);              // magic "QFI\xfb"
  u32(4, 3);                       // version
  u64(8, 0);                       // backing file offset
  u32(16, 0);                      // backing file size
  u32(20, clusterBits);
  u64(24, virtualSize);
  u32(32, 0);                      // no encryption
  u32(36, l1Size);
  u64(40, cluster * 3);            // L1 table offset
  u64(48, cluster * 1);            // refcount table offset
  u32(56, 1);                      // refcount table clusters
  u32(60, 0);                      // snapshots
  u64(64, 0);                      // snapshots offset
  u64(72, 0);                      // incompatible features
  u64(80, 0);                      // compatible features
  u64(88, 0);                      // autoclear features
  u32(96, 4);                      // refcount order: 16-bit
  u32(100, 104);                   // header length
  // Header extension list terminator (type 0, length 0) at 104.

  u64(cluster, cluster * 2);       // refcount table[0] -> refcount block
  for (let i = 0; i < 4; i++) view.setUint16(cluster * 2 + i * 2, 1); // clusters 0-3 in use
  return image;
}
