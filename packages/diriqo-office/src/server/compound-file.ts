import { FORMAT_LIMITS } from './container-safety.ts';

/** Independently implemented from MS-CFB sections 2.2–2.6. No embedded code is executed. */
const FREE = 0xffffffff, END = 0xfffffffe, FAT = 0xfffffffd, DIFAT = 0xfffffffc;
function fail(message: string): never { throw new Error(`OFFICE_FORMAT: ${message}`); }
type Entry = { name: string; type: number; left: number; right: number; child: number; start: number; size: number };

/** Root-relative, case-preserving stream paths. Rejects ambiguous or active containers. */
export function readCompoundFile(input: Uint8Array): Record<string, Buffer> {
  if (input.byteLength > FORMAT_LIMITS.inputBytes || input.byteLength < 1536) fail('Invalid compound file or file too large');
  const b = Buffer.from(input);
  if (!b.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) fail('Not a binary Office compound file');
  const major = b.readUInt16LE(26), shift = b.readUInt16LE(30);
  if (!((major === 3 && shift === 9) || (major === 4 && shift === 12)) || b.readUInt16LE(28) !== 0xfffe || b.readUInt16LE(32) !== 6 || b.readUInt32LE(56) !== 4096) fail('Unsupported compound file header');
  const sectorBytes = 2 ** shift, sectorCount = b.length / sectorBytes - 1;
  if (!Number.isInteger(sectorCount) || sectorCount < 2 || !b.subarray(8, 24).every(v => v === 0) || !b.subarray(34, 40).every(v => v === 0)) fail('Malformed compound file header');
  if (major === 4 && !b.subarray(512, sectorBytes).every(v => v === 0)) fail('Malformed compound file header padding');
  const directoryCount = b.readUInt32LE(40), fatCount = b.readUInt32LE(44), miniFatCount = b.readUInt32LE(64), difatCount = b.readUInt32LE(72);
  if ((major === 3 && directoryCount !== 0) || !fatCount || fatCount > sectorCount || miniFatCount > sectorCount || difatCount > sectorCount || directoryCount > sectorCount) fail('Invalid compound file sector counts');
  const claimed = new Set<number>();
  function sector(id: number) {
    if (!Number.isInteger(id) || id < 0 || id >= sectorCount) fail('Compound file sector outside input');
    return b.subarray((id + 1) * sectorBytes, (id + 2) * sectorBytes);
  }
  function claim(id: number) {
    const bytes = sector(id);
    if (claimed.has(id)) fail('Compound file overlapping or cyclic sector chains');
    claimed.add(id); return bytes;
  }
  const fatIds: number[] = [], difatIds: number[] = [];
  function addFat(id: number) {
    if (id === FREE) return;
    if (fatIds.length >= fatCount) fail('Too many compound file FAT sectors');
    claim(id); fatIds.push(id);
  }
  for (let p = 76; p < 512; p += 4) addFat(b.readUInt32LE(p));
  let next = b.readUInt32LE(68);
  for (let i = 0; i < difatCount; i++) {
    const data = claim(next); difatIds.push(next);
    for (let p = 0; p < sectorBytes - 4; p += 4) addFat(data.readUInt32LE(p));
    next = data.readUInt32LE(sectorBytes - 4);
  }
  if ((difatCount ? next !== END : next !== END && next !== FREE) || fatIds.length !== fatCount) fail('Invalid compound file DIFAT chain');
  const fat: number[] = [];
  for (const id of fatIds) { const data = sector(id); for (let p = 0; p < sectorBytes; p += 4) fat.push(data.readUInt32LE(p)); }
  if (fat.length < sectorCount || fatIds.some(id => fat[id] !== FAT) || difatIds.some(id => fat[id] !== DIFAT)) fail('Invalid compound file FAT markers');
  function chain(start: number, exactSectors: number | undefined, limit: number): Buffer {
    if (exactSectors === 0) {
      if (start !== END && start !== FREE && start !== 0) fail('Unexpected empty compound file chain');
      return Buffer.alloc(0);
    }
    const chunks: Buffer[] = []; let id = start;
    while (id !== END) {
      if (chunks.length >= limit || (exactSectors !== undefined && chunks.length >= exactSectors)) fail('Compound file chain exceeds declared size');
      chunks.push(claim(id)); id = fat[id];
    }
    if (exactSectors !== undefined && chunks.length !== exactSectors) fail('Truncated compound file chain');
    return Buffer.concat(chunks);
  }
  const directory = chain(b.readUInt32LE(48), major === 4 ? directoryCount : undefined, Math.ceil(FORMAT_LIMITS.entries * 128 / sectorBytes));
  if (directory.length < 128 || directory.length / 128 > FORMAT_LIMITS.entries) fail('Compound file directory limit exceeded');
  const entries: Array<Entry | null> = [];
  for (let p = 0; p < directory.length; p += 128) {
    const type = directory[p + 66];
    if (type === 0) { entries.push(null); continue; }
    const length = directory.readUInt16LE(p + 64);
    if (![1, 2, 5].includes(type) || length < 2 || length > 64 || length % 2 || directory.readUInt16LE(p + length - 2) !== 0 || directory[p + 67] > 1) fail('Malformed compound file directory entry');
    const name = directory.subarray(p, p + length - 2).toString('utf16le');
    if (!name || /[\0/\\:!]/.test(name) || name === '.' || name === '..' || name.includes('\ufffd')) fail('Unsafe compound file path');
    // Check all allocated entries, including malicious unreachable entries.
    const key = name.replace(/^[\x01-\x1f]+/, '').toLowerCase();
    // Word routinely writes an empty ObjectPool storage even in blank documents.
    const emptyObjectPool = key === 'objectpool' && type === 1 && directory.readUInt32LE(p + 76) === FREE;
    if (!emptyObjectPool && /^(?:vba|_vba_project(?:_cur)?|project(?:wm)?|macros|objectpool|activex|ocxname|ole10native|encryptedpackage|encryptioninfo|dataspaces|mbd[0-9a-f]+)$/.test(key)) fail('Macros, embedded objects and encrypted files are not accepted');
    if (type === 1 && !directory.subarray(p + 80, p + 96).every(value => value === 0)) fail('Embedded compound file object storage is not accepted');
    const low = directory.readUInt32LE(p + 120), high = directory.readUInt32LE(p + 124);
    // MS-CFB permits uninitialized upper DWORDs in version 3 streams.
    const size = major === 3 ? low : high * 4294967296 + low;
    if (!Number.isSafeInteger(size) || size > FORMAT_LIMITS.entryBytes || size > b.length) fail('Compound file stream size limit exceeded');
    const entry = { name, type, left: directory.readUInt32LE(p + 68), right: directory.readUInt32LE(p + 72), child: directory.readUInt32LE(p + 76), start: directory.readUInt32LE(p + 116), size };
    if (type === 2 && entry.child !== FREE) fail('Compound file stream has child entries');
    if (type === 1 && (entry.start !== 0 || size !== 0)) fail('Invalid compound file storage');
    if (type === 5 && entries.length !== 0) fail('Duplicate compound file root');
    entries.push(entry);
  }
  const root = entries[0];
  // Some deployed writers (including SheetJS CE) call the root "R". Identity is
  // directory slot 0/type 5, not its display name; root names never enter paths.
  if (!root || root.type !== 5 || root.left !== FREE || root.right !== FREE) fail('Missing compound file root');
  const miniFatBuffer = chain(b.readUInt32LE(60), miniFatCount, sectorCount);
  const miniFat: number[] = [];
  for (let p = 0; p < miniFatBuffer.length; p += 4) miniFat.push(miniFatBuffer.readUInt32LE(p));
  const miniStream = chain(root.start, Math.ceil(root.size / sectorBytes), sectorCount).subarray(0, root.size);
  const miniClaimed = new Set<number>();
  function readStream(entry: Entry): Buffer {
    if (!entry.size) return Buffer.alloc(0);
    if (entry.size >= 4096) return chain(entry.start, Math.ceil(entry.size / sectorBytes), sectorCount).subarray(0, entry.size);
    const chunks: Buffer[] = []; const expected = Math.ceil(entry.size / 64); let id = entry.start;
    while (id !== END) {
      if (id >= miniFat.length || id * 64 + 64 > miniStream.length || miniClaimed.has(id) || chunks.length >= expected) fail('Invalid, cyclic or overlapping compound file mini stream');
      miniClaimed.add(id); chunks.push(miniStream.subarray(id * 64, id * 64 + 64)); id = miniFat[id];
    }
    if (chunks.length !== expected) fail('Truncated compound file mini stream');
    return Buffer.concat(chunks).subarray(0, entry.size);
  }
  const streams: Record<string, Buffer> = Object.create(null), paths = new Set<string>(), visited = new Set<number>([0]);
  const pending = [{ id: root.child, parent: '', depth: 0 }]; let total = 0;
  while (pending.length) {
    const { id, parent, depth } = pending.pop()!;
    if (id === FREE) continue;
    const entry = entries[id];
    if (!entry || visited.has(id) || depth > 32) fail('Invalid or cyclic compound file directory tree');
    visited.add(id);
    const path = parent + entry.name, normalized = path.toUpperCase();
    if (paths.has(normalized)) fail('Duplicate compound file path');
    paths.add(normalized);
    pending.push({ id: entry.left, parent, depth }, { id: entry.right, parent, depth });
    if (entry.type === 1) pending.push({ id: entry.child, parent: path + '/', depth: depth + 1 });
    else if (entry.type === 2) { total += entry.size; if (total > FORMAT_LIMITS.expandedBytes) fail('Compound file stream total limit exceeded'); streams[path] = readStream(entry); }
  }
  if (entries.some((entry, id) => entry && !visited.has(id))) fail('Unreachable compound file directory entry');
  return streams;
}
