import type { DocumentContent } from '../core/types.ts';
import { readCompoundFile } from './compound-file.ts';

/** Original, deliberately partial MS-DOC 2.4.1 / 2.5 / 2.8 / 2.9 implementation. */
function fail(message: string): never { throw new Error(`OFFICE_FORMAT: ${message}`); }
function slice(b: Buffer, offset: number, length: number): Buffer {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > b.length) fail('DOC structure outside stream');
  return b.subarray(offset, offset + length);
}
const compressedCharacters: Record<number, number> = { 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9f: 0x0178 };

// Conservative detection over property-bearing blocks. False positives are rejected,
// never silently imported: this subset does not resolve tracked changes or hidden text.
function rejectSensitiveProperties(bytes: Buffer): void {
  for (let p = 0; p + 2 < bytes.length; p++) {
    const sprm = bytes.readUInt16LE(p);
    if ([0x0800, 0x0801, 0x0802, 0x0811, 0x083c, 0x2a90].includes(sprm) && bytes[p + 2] !== 0) fail('DOC with tracked changes or hidden text is not supported; save a reviewed DOCX copy first');
    if ([0x0806, 0x080a, 0x0856].includes(sprm) && bytes[p + 2] !== 0) fail('DOC active or embedded objects are not accepted');
  }
}

function cachedFieldText(text: string): { text: string; fields: boolean } {
  const fields: Array<{ result: boolean; instruction: string }> = []; const output: string[] = []; let hasFields = false;
  const validate = (instruction: string) => {
    if (/^\s*(?:DDE(?:AUTO)?|LINK|INCLUDE(?:TEXT|PICTURE)|DATABASE|EMBED|CONTROL|MACROBUTTON)\b/i.test(instruction)) fail('DOC active or external fields are not accepted');
  };
  for (const char of text) {
    if (char === '\x13') { if (fields.length >= 32) fail('DOC field nesting limit exceeded'); fields.push({ result: false, instruction: '' }); hasFields = true; continue; }
    if (char === '\x14') { const field = fields.at(-1); if (!field || field.result) fail('Malformed DOC field'); validate(field.instruction); field.result = true; continue; }
    if (char === '\x15') { const field = fields.pop(); if (!field) fail('Malformed DOC field'); validate(field.instruction); continue; }
    const current = fields.at(-1);
    // A nested field owns its instruction even while its parent's instruction is
    // unfinished. Its cached result may subsequently become parent instruction text.
    const pending = current && !current.result ? current : fields.find(field => !field.result);
    if (pending) { if (pending.instruction.length >= 4096) fail('DOC field instruction limit exceeded'); pending.instruction += char; }
    else output.push(char);
  }
  if (fields.length) fail('Unterminated DOC field');
  return { text: output.join(''), fields: hasFields };
}

/** Import main-story text from genuine Word 97–2007 binary DOC. There is no DOC writer. */
export function importDoc(input: Uint8Array): { content: DocumentContent; warnings: string[] } {
  const streams = readCompoundFile(input), source = streams.WordDocument;
  if (!source || source.length < 156 || source.readUInt16LE(0) !== 0xa5ec) fail('Not a supported binary Word DOC');
  const baseVersion = source.readUInt16LE(2), flags = source.readUInt16LE(10);
  if (![0xc1, 0xd9, 0x101, 0x10c, 0x112].includes(baseVersion)) fail('Only Word 97–2007 binary DOC is supported; convert older DOC to DOCX');
  if (flags & 0x8100 || source.readUInt32LE(14) !== 0) fail('Encrypted or obfuscated DOC is not accepted');
  if (flags & 3 || source.readUInt16LE(8)) fail('DOC templates and AutoText containers are not supported');
  if (source.readUInt16LE(32) !== 14 || source.readUInt16LE(62) !== 22) fail('Malformed DOC FIB');
  const pairCount = source.readUInt16LE(152), newOffset = 154 + pairCount * 8;
  if (pairCount < 93 || pairCount > 183 || newOffset + 2 > source.length) fail('Unsupported DOC FIB size');
  const newCount = source.readUInt16LE(newOffset);
  if (![0, 2, 5].includes(newCount)) fail('Unsupported DOC FIB extension');
  slice(source, newOffset + 2, newCount * 2);
  const version = newCount ? source.readUInt16LE(newOffset + 2) : baseVersion;
  if (({ 0xc1: 93, 0xd9: 108, 0x101: 136, 0x10c: 164, 0x112: 183 } as Record<number, number>)[version] !== pairCount) fail('Inconsistent DOC version');
  const fibEnd = newOffset + 2 + newCount * 2, cbMac = source.readUInt32LE(64), mainLength = source.readUInt32LE(76);
  if (cbMac < fibEnd || cbMac > source.length || mainLength > 500000) fail('DOC text or stream size limit exceeded');
  const word = source.subarray(0, cbMac), table = streams[(flags & 0x0200) ? '1Table' : '0Table'];
  if (!table) fail('Missing DOC table stream');
  const part = (index: number) => { const at = 154 + index * 8, length = word.readUInt32LE(at + 4); return length ? slice(table, word.readUInt32LE(at), length) : Buffer.alloc(0); };
  // Style and piece/character properties can carry hidden or deleted text. Do not
  // claim an accepted/rejected revision view when the source requires one.
  rejectSensitiveProperties(part(1));
  const chpx = part(12);
  if (chpx.length) {
    if (chpx.length < 4 || (chpx.length - 4) % 8) fail('Malformed DOC character properties');
    const pages = (chpx.length - 4) / 8;
    if (pages > 10000) fail('DOC character property limit exceeded');
    const seen = new Set<number>();
    for (let i = 0; i < pages; i++) {
      if (chpx.readUInt32LE(i * 4) >= chpx.readUInt32LE(i * 4 + 4)) fail('Unsorted DOC character property ranges');
      const pageAt = (chpx.readUInt32LE((pages + 1) * 4 + i * 4) & 0x3fffff) * 512;
      if (pageAt < fibEnd || seen.has(pageAt)) fail('Invalid DOC character property page');
      seen.add(pageAt); const page = slice(word, pageAt, 512), runs = page[511], propertiesStart = (runs + 1) * 4 + runs;
      if (!runs || runs > 101) fail('Malformed DOC character property page');
      for (let r = 0; r < runs; r++) {
        if (page.readUInt32LE(r * 4) >= page.readUInt32LE(r * 4 + 4)) fail('Unsorted DOC character property page');
        const at = page[(runs + 1) * 4 + r] * 2;
        if (!at) continue;
        if (at < propertiesStart || at + 1 + page[at] > 511) fail('DOC character properties outside page');
        rejectSensitiveProperties(page.subarray(at + 1, at + 1 + page[at]));
      }
    }
  }
  const clx = part(33); let p = 0, propertyGroups = 0;
  while (p < clx.length && clx[p] === 1) {
    if (p + 3 > clx.length || ++propertyGroups > 10000) fail('Malformed DOC piece properties');
    const size = clx.readUInt16LE(p + 1); rejectSensitiveProperties(slice(clx, p + 3, size)); p += 3 + size;
  }
  if (p + 5 > clx.length || clx[p] !== 2) fail('Missing DOC text piece table');
  const pieceBytes = clx.readUInt32LE(p + 1); p += 5;
  if (pieceBytes < 4 || (pieceBytes - 4) % 12 || p + pieceBytes !== clx.length) fail('Malformed DOC text piece table');
  const pieces = (pieceBytes - 4) / 12, pieceTable = slice(clx, p, pieceBytes);
  if (pieces > 100000 || pieceTable.readUInt32LE(0) !== 0 || pieceTable.readUInt32LE(pieces * 4) < mainLength) fail('Invalid DOC text piece ranges');
  const texts: string[] = []; let count = 0;
  for (let i = 0; i < pieces; i++) {
    const from = pieceTable.readUInt32LE(i * 4), to = pieceTable.readUInt32LE((i + 1) * 4), pieceAt = (pieces + 1) * 4 + i * 8;
    if (to <= from || to > 0x7fffffff) fail('Unsorted DOC text piece table');
    const fc = pieceTable.readUInt32LE(pieceAt + 2), compressed = !!(fc & 0x40000000), rawOffset = fc & 0x3fffffff;
    if (compressed && rawOffset % 2) fail('Misaligned DOC compressed text');
    const offset = compressed ? rawOffset / 2 : rawOffset, byteCount = (to - from) * (compressed ? 1 : 2);
    if (offset < fibEnd) fail('DOC text overlaps its header');
    slice(word, offset, byteCount);
    const prm = pieceTable.readUInt16LE(pieceAt + 6);
    if (prm & 1) { if ((prm >>> 1) >= propertyGroups) fail('Invalid DOC piece property reference'); }
    else if ([0x41, 0x42, 0x43, 0x50, 0x5c, 0x7b].includes((prm >>> 1) & 0x7f) && prm >>> 8) fail('DOC with tracked changes or hidden text is not supported; save a reviewed DOCX copy first');
    else if ([0x47, 0x4b, 0x76].includes((prm >>> 1) & 0x7f) && prm >>> 8) fail('DOC active or embedded objects are not accepted');
    const chars = Math.max(0, Math.min(to, mainLength) - from);
    if (!chars) continue;
    const data = slice(word, offset, chars * (compressed ? 1 : 2));
    texts.push(compressed ? Array.from(data, value => String.fromCharCode(compressedCharacters[value] ?? value)).join('') : data.toString('utf16le')); count += chars;
  }
  if (count !== mainLength) fail('Incomplete DOC main text');
  const raw = texts.join('');
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(raw)) fail('Invalid DOC Unicode text');
  const field = cachedFieldText(raw);
  const text = field.text.replace(/\r\x07/g, '\t').replace(/\x07/g, '\t').replace(/[\r\v\f]/g, '\n').replace(/[\x00-\x08\x0e-\x1f\x7f-\x9f]/g, '').replace(/\n$/, '');
  const warnings = ['DOC text-only import: main document text and paragraph breaks only. Styles, headings, lists, table structure, images, headers, footers, comments and pagination are not preserved. Review the converted text; the original is retained.'];
  if (field.fields) warnings.push('DOC fields are imported only as their stored text results; instructions and live links are removed.');
  const content: DocumentContent = { schemaVersion: 1, kind: 'document', page: { marginMm: 20, header: '', footer: '' }, doc: { type: 'doc', content: text.split('\n').map(value => ({ type: 'paragraph', ...(value ? { content: [{ type: 'text', text: value }] } : {}) })) } };
  return { content, warnings };
}
