import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { readCompoundFile } from '../src/server/compound-file.ts';
import { importDoc } from '../src/server/legacy-doc.ts';
import { compoundFixture, docFixture, docStreams } from './fixtures/legacy-office.mjs';

const plain = result => result.content.doc.content.map(p => (p.content ?? []).map(n => n.text).join('')).join('\n');
const dir = (b, entry = 0) => (b.readUInt32LE(48) + 1) * 2 ** b.readUInt16LE(30) + entry * 128;
const fatAt = (b, sector) => (b.readUInt32LE(76) + 1) * 2 ** b.readUInt16LE(30) + sector * 4;
const rejects = (b, pattern = /OFFICE_FORMAT:/) => assert.throws(() => readCompoundFile(b), pattern);

test('CFB reads ordinary, mini and empty streams, including version4', () => {
  for (const size of [512, 4096]) {
    const streams = { Large: Buffer.alloc(5000, 42), Small: Buffer.from('malý soubor'), Empty: Buffer.alloc(0) };
    const result = readCompoundFile(compoundFixture(streams, size));
    for (const [name, expected] of Object.entries(streams)) assert.deepEqual(result[name], expected);
    assert.equal(Object.getPrototypeOf(result), null);
  }
});
test('CFB reads actual SheetJS BIFF8 output and nonstandard root display name', () => {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Žluťoučký', 12], ['Diriqo', 34]]), 'List');
  const data = XLSX.write(book, { bookType: 'biff8', type: 'buffer' });
  assert.ok(readCompoundFile(data).Workbook.length > 0);
});
test('CFB reads a valid DIFAT extension and rejects its loop/overlap', () => {
  const source = Buffer.alloc(8 * 1024 * 1024, 7), b = compoundFixture({ Large: source });
  assert.ok(b.readUInt32LE(72) > 0); assert.deepEqual(readCompoundFile(b).Large, source);
  const mutated = Buffer.from(b), offset = (mutated.readUInt32LE(68) + 1) * 512;
  mutated.writeUInt32LE(mutated.readUInt32LE(68), offset + 508); rejects(mutated, /DIFAT/);
  const overlap = Buffer.from(b); overlap.writeUInt32LE(overlap.readUInt32LE(76), 68); rejects(overlap, /overlapping|cyclic/);
});
test('CFB rejects regular and mini sector cycles, overlap and truncated chains', () => {
  const base = compoundFixture({ First: Buffer.alloc(4096, 1), Second: Buffer.alloc(4096, 2) });
  const first = base.readUInt32LE(dir(base, 1) + 116);
  const cycle = Buffer.from(base); cycle.writeUInt32LE(first, fatAt(cycle, first)); rejects(cycle, /overlapping|cyclic/);
  const overlap = Buffer.from(base); overlap.writeUInt32LE(first, dir(overlap, 2) + 116); rejects(overlap, /overlapping|cyclic/);
  const trunc = Buffer.from(base); trunc.writeUInt32LE(0xfffffffe, fatAt(trunc, first)); rejects(trunc, /Truncated/);
  const mini = compoundFixture({ First: Buffer.alloc(100, 1), Second: Buffer.alloc(80, 2) });
  const miniLoop = Buffer.from(mini), miniFat = (miniLoop.readUInt32LE(60) + 1) * 512;
  miniLoop.writeUInt32LE(0, miniFat); rejects(miniLoop, /mini stream/);
  const miniOverlap = Buffer.from(mini); miniOverlap.writeUInt32LE(0, dir(miniOverlap, 2) + 116); rejects(miniOverlap, /mini stream/);
});
test('CFB rejects directories with duplicate paths, loops, orphan entries and invalid bounds', () => {
  rejects(compoundFixture({ WordDocument: Buffer.alloc(0), worddocument: Buffer.alloc(0) }), /Duplicate/);
  const base = compoundFixture({ A: Buffer.alloc(0), B: Buffer.alloc(0) });
  const cycle = Buffer.from(base); cycle.writeUInt32LE(1, dir(cycle, 1) + 72); rejects(cycle, /cyclic/);
  const orphan = Buffer.from(base); orphan.writeUInt32LE(0xffffffff, dir(orphan, 1) + 72); rejects(orphan, /Unreachable/);
  const outside = Buffer.from(base); outside.writeUInt32LE(10000, dir(outside) + 76); rejects(outside, /directory/);
  const size = Buffer.from(base); size.writeUInt32LE(0x7fffffff, dir(size, 1) + 120); rejects(size, /size/);
  const reserved = Buffer.from(base); reserved[34] = 1; rejects(reserved, /header/);
  rejects(base.subarray(0, base.length - 1), /header|compound file/);
  rejects(Buffer.from('<html>not a binary DOC</html>'), /compound file/);
});
test('CFB rejects macros, active objects and encryption in any allocated entry', () => {
  for (const name of ['VBA', 'Macros', '_VBA_PROJECT', 'PROJECTwm', 'ObjectPool', 'ActiveX', '\x01Ole10Native', 'EncryptionInfo', 'EncryptedPackage', '\x06DataSpaces']) rejects(compoundFixture({ [name]: Buffer.from('x') }), /not accepted/);
  const hidden = compoundFixture({ Good: Buffer.alloc(0), VBA: Buffer.alloc(0) }); hidden.writeUInt32LE(0xffffffff, dir(hidden, 1) + 72); rejects(hidden, /not accepted/);
});
test('DOC imports unicode, mixed compressed pieces, paragraphs and main story only', () => {
  const result = importDoc(docFixture([{ text: 'Žluťoučký kůň\r' }, { bytes: Buffer.from([0x93, 0x43, 0x65, 0x6e, 0x61, 0x94, 0x0d]), compressed: true }, { text: 'Footer ignored\r' }], { mainLength: 21 }));
  assert.equal(plain(result), 'Žluťoučký kůň\n“Cena”');
  assert.match(result.warnings[0], /text-only/); assert.match(result.warnings[0], /original is retained/);
});
test('DOC supports versioned FIB and either 0Table or 1Table', () => {
  for (const version of [0xc1, 0xd9, 0x101, 0x10c, 0x112]) for (const flags of [0x1000, 0x1200]) {
    assert.equal(plain(importDoc(docFixture([{ text: 'Zkouška\r' }], { version, flags, baseVersion: 0xc1 }))), 'Zkouška');
  }
});
test('DOC text-only cells and fields become text, never live instructions', () => {
  const text = 'A\r\x07B\r\x07\rStrana \x13 PAGE \x142\x15\r';
  const result = importDoc(docFixture([{ text }])); assert.equal(plain(result), 'A\tB\t\nStrana 2'); assert.equal(result.warnings.length, 2);
  for (const keyword of ['DDE', 'DDEAUTO', 'LINK', 'INCLUDETEXT', 'INCLUDEPICTURE', 'EMBED', 'DATABASE', 'MACROBUTTON']) assert.throws(() => importDoc(docFixture([{ text: `\x13 ${keyword} secret \x14cached\x15\r` }])), /active or external fields/);
  assert.throws(() => importDoc(docFixture([{ text: '\x13 PAGE\r' }])), /Unterminated/);
  const nested = '\x13 IF \x13 DDE app data item \x14cached\x15 = cached yes no \x14PUBLIC\x15\r';
  assert.throws(() => importDoc(docFixture([{ text: nested }])), /active or external fields/);
  assert.equal(plain(importDoc(docFixture([{ text: '\x13 IF \x13 PAGE \x142\x15 > 1 yes no \x14yes\x15\r' }]))), 'yes');
});
test('DOC rejects encrypted/template/old/malformed documents', () => {
  for (const flags of [0x1300, 0x9200, 0x1201, 0x1202]) assert.throws(() => importDoc(docFixture(undefined, { flags })), /not accepted|not supported/);
  for (const mutate of [
    w => w.writeUInt16LE(0xbf, 2), w => w.writeUInt16LE(13, 32), w => w.writeUInt32LE(0xfffffffe, 76), w => w.writeUInt32LE(0xffffffff, 418), w => w.writeUInt32LE(20, 64), w => w.writeUInt16LE(250, 152),
  ]) { const streams = docStreams(); mutate(streams.WordDocument); assert.throws(() => importDoc(compoundFixture(streams)), /OFFICE_FORMAT:/); }
  assert.throws(() => importDoc(compoundFixture({ Workbook: Buffer.alloc(100) })), /binary Word/);
});
test('DOC bounds and monotonicity protect its text piece table', () => {
  const source = [{ text: 'First\r' }, { text: 'Second\r' }];
  for (const mutate of [
    t => t.writeUInt32LE(10000000, 1), t => t.writeUInt32LE(0, 9), t => t.writeUInt32LE(1, 5), t => t.writeUInt32LE(0x7ffffff0, 5 + 12 + 2), t => t.writeUInt32LE(0, 5 + 12 + 2),
  ]) { const streams = docStreams(source); mutate(streams['1Table']); assert.throws(() => importDoc(compoundFixture(streams)), /OFFICE_FORMAT:/); }
});
test('DOC rejects tracked/hidden/embedded character properties but not character spacing', () => {
  for (const opcode of [0x0800, 0x0801, 0x0802, 0x0811, 0x083c, 0x080a]) {
    const properties = Buffer.alloc(3); properties.writeUInt16LE(opcode); properties[2] = 1;
    assert.throws(() => importDoc(docFixture(undefined, { characterProperties: properties })), /tracked changes|embedded/);
  }
  // Regression of word-extractor issue70: SPRM0x8840 is spacing, not deletion0x0800.
  const spacing = Buffer.from([0x40, 0x88, 0x20, 0x00]);
  assert.equal(plain(importDoc(docFixture(undefined, { characterProperties: spacing }))), 'Diriqo Office');
  assert.throws(() => importDoc(docFixture([{ text: 'Hidden\r', prm: (1 << 8) | (0x5c << 1) }])), /hidden/);
  for (const isprm of [0x47, 0x4b, 0x76]) assert.throws(() => importDoc(docFixture([{ text: 'Object\r', prm: (1 << 8) | (isprm << 1) }])), /embedded/);
});
