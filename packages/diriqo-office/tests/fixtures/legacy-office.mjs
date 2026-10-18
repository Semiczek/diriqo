// Original synthetic MS-CFB/MS-DOC fixtures, no third-party document content.
const FREE = 0xffffffff, END = 0xfffffffe;
export function compoundFixture(streams, sectorBytes = 512) {
  const entries = Object.entries(streams), mini = [], miniFat = [], regular = [], descriptors = [];
  for (const [name, source] of entries) {
    const data = Buffer.from(source);
    if (data.length > 0 && data.length < 4096) {
      const start = mini.length, count = Math.ceil(data.length / 64);
      for (let i = 0; i < count; i++) { const block = Buffer.alloc(64); data.copy(block, 0, i * 64, (i + 1) * 64); mini.push(block); miniFat.push(i === count - 1 ? END : start + i + 1); }
      descriptors.push({ name, data, start, small: true });
    } else descriptors.push({ name, data, start: END, small: false });
  }
  const miniBuffer = Buffer.concat(mini), directorySectors = Math.ceil((entries.length + 1) * 128 / sectorBytes);
  const miniFatSectors = Math.ceil(miniFat.length * 4 / sectorBytes), miniSectors = Math.ceil(miniBuffer.length / sectorBytes);
  const dataSectors = descriptors.filter(d => !d.small).reduce((n, d) => n + Math.ceil(d.data.length / sectorBytes), 0);
  let fatSectors = 1, difatSectors = 0;
  for (;;) {
    const total = directorySectors + miniFatSectors + miniSectors + dataSectors + fatSectors + difatSectors;
    const nextFat = Math.ceil(total * 4 / sectorBytes), nextDifat = Math.max(0, Math.ceil((nextFat - 109) / (sectorBytes / 4 - 1)));
    if (nextFat === fatSectors && nextDifat === difatSectors) break;
    fatSectors = nextFat; difatSectors = nextDifat;
  }
  const sectorCount = directorySectors + miniFatSectors + miniSectors + dataSectors + fatSectors + difatSectors;
  const out = Buffer.alloc((sectorCount + 1) * sectorBytes), fat = Array(sectorCount).fill(FREE);
  const sec = id => out.subarray((id + 1) * sectorBytes, (id + 2) * sectorBytes);
  out.set(Buffer.from('d0cf11e0a1b11ae1', 'hex')); out.writeUInt16LE(0x3e, 24); out.writeUInt16LE(sectorBytes === 512 ? 3 : 4, 26);
  out.writeUInt16LE(0xfffe, 28); out.writeUInt16LE(sectorBytes === 512 ? 9 : 12, 30); out.writeUInt16LE(6, 32);
  out.writeUInt32LE(sectorBytes === 512 ? 0 : directorySectors, 40); out.writeUInt32LE(fatSectors, 44); out.writeUInt32LE(0, 48); out.writeUInt32LE(4096, 56);
  out.writeUInt32LE(miniFatSectors ? directorySectors : END, 60); out.writeUInt32LE(miniFatSectors, 64);
  const firstFat = sectorCount - fatSectors - difatSectors, firstDifat = sectorCount - difatSectors;
  out.writeUInt32LE(difatSectors ? firstDifat : END, 68); out.writeUInt32LE(difatSectors, 72);
  for (let i = 0; i < 109; i++) out.writeUInt32LE(i < fatSectors ? firstFat + i : FREE, 76 + i * 4);
  const assign = (start, count, data) => {
    for (let i = 0; i < count; i++) { fat[start + i] = i === count - 1 ? END : start + i + 1; if (data) data.copy(sec(start + i), 0, i * sectorBytes, (i + 1) * sectorBytes); }
  };
  assign(0, directorySectors);
  const miniFatBuffer = Buffer.alloc(miniFatSectors * sectorBytes, 0xff); miniFat.forEach((n, i) => miniFatBuffer.writeUInt32LE(n, i * 4));
  assign(directorySectors, miniFatSectors, miniFatBuffer); assign(directorySectors + miniFatSectors, miniSectors, miniBuffer);
  let freeSector = directorySectors + miniFatSectors + miniSectors;
  for (const d of descriptors) if (!d.small && d.data.length) { d.start = freeSector; const count = Math.ceil(d.data.length / sectorBytes); assign(freeSector, count, d.data); freeSector += count; }
  const entry = (id, name, type, start, size, right = FREE, child = FREE) => {
    const at = sectorBytes + id * 128, text = Buffer.from(name + '\0', 'utf16le'); text.copy(out, at); out.writeUInt16LE(text.length, at + 64); out[at + 66] = type; out[at + 67] = 1;
    out.writeUInt32LE(FREE, at + 68); out.writeUInt32LE(right, at + 72); out.writeUInt32LE(child, at + 76); out.writeUInt32LE(start, at + 116); out.writeUInt32LE(size, at + 120);
  };
  entry(0, 'Root Entry', 5, miniSectors ? directorySectors + miniFatSectors : END, miniBuffer.length, FREE, entries.length ? 1 : FREE);
  descriptors.forEach((d, i) => entry(i + 1, d.name, 2, d.start, d.data.length, i + 1 === descriptors.length ? FREE : i + 2));
  for (let i = 0; i < fatSectors; i++) fat[firstFat + i] = 0xfffffffd;
  for (let i = 0; i < difatSectors; i++) { fat[firstDifat + i] = 0xfffffffc; const data = sec(firstDifat + i); data.fill(0xff); for (let j = 0; j < sectorBytes / 4 - 1; j++) { const k = 109 + i * (sectorBytes / 4 - 1) + j; if (k < fatSectors) data.writeUInt32LE(firstFat + k, j * 4); } data.writeUInt32LE(i + 1 === difatSectors ? END : firstDifat + i + 1, sectorBytes - 4); }
  const fullFat = Buffer.alloc(fatSectors * sectorBytes, 0xff); fat.forEach((n, i) => fullFat.writeUInt32LE(n, i * 4));
  for (let i = 0; i < fatSectors; i++) fullFat.copy(sec(firstFat + i), 0, i * sectorBytes, (i + 1) * sectorBytes);
  return out;
}

export function docStreams(pieces = [{ text: 'Diriqo Office\r', compressed: false }], options = {}) {
  const version = options.version ?? 0xc1, pairCount = { 0xc1: 93, 0xd9: 108, 0x101: 136, 0x10c: 164, 0x112: 183 }[version];
  const word = Buffer.alloc(4096), table = Buffer.alloc(4096), textAt = 2048;
  word.writeUInt16LE(0xa5ec, 0); word.writeUInt16LE(options.baseVersion ?? version, 2); word.writeUInt16LE(options.flags ?? 0x1200, 10);
  word.writeUInt16LE(14, 32); word.writeUInt16LE(22, 62); word.writeUInt32LE(word.length, 64); word.writeUInt16LE(pairCount, 152);
  if (version !== 0xc1) { const at = 154 + pairCount * 8; word.writeUInt16LE(version === 0x112 ? 5 : 2, at); word.writeUInt16LE(version, at + 2); }
  let cp = 0, at = textAt; const plc = Buffer.alloc(4 + pieces.length * 12);
  pieces.forEach((piece, i) => {
    plc.writeUInt32LE(cp, i * 4); const data = piece.bytes ?? Buffer.from(piece.text, piece.compressed ? 'latin1' : 'utf16le'); const chars = data.length / (piece.compressed ? 1 : 2);
    const pcd = (pieces.length + 1) * 4 + i * 8; plc.writeUInt32LE(piece.compressed ? ((at * 2) | 0x40000000) >>> 0 : at, pcd + 2); plc.writeUInt16LE(piece.prm ?? 0, pcd + 6); data.copy(word, at); at += data.length; cp += chars;
  });
  plc.writeUInt32LE(cp, pieces.length * 4); word.writeUInt32LE(options.mainLength ?? cp, 76);
  table[0] = 2; table.writeUInt32LE(plc.length, 1); plc.copy(table, 5); word.writeUInt32LE(0, 154 + 33 * 8); word.writeUInt32LE(plc.length + 5, 154 + 33 * 8 + 4);
  if (options.characterProperties) {
    word.writeUInt32LE(128, 154 + 12 * 8); word.writeUInt32LE(12, 154 + 12 * 8 + 4);
    table.writeUInt32LE(textAt, 128); table.writeUInt32LE(at, 132); table.writeUInt32LE(6, 136);
    word.writeUInt32LE(textAt, 3072); word.writeUInt32LE(at, 3076); word[3080] = 10;
    word[3092] = options.characterProperties.length; Buffer.from(options.characterProperties).copy(word, 3093); word[3583] = 1;
  }
  return { WordDocument: word, [(word.readUInt16LE(10) & 0x200) ? '1Table' : '0Table']: table };
}
export const docFixture = (pieces, options) => compoundFixture(docStreams(pieces, options));
