import { inflateRawSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
export const FORMAT_LIMITS = { inputBytes: 12 * 1024 * 1024, expandedBytes: 48 * 1024 * 1024, entryBytes: 12 * 1024 * 1024, entries: 2048, ratio: 250, cells: 100000, rows: 100000, columns: 16384, sheets: 64 };
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(b: Uint8Array) { let c = 0xffffffff; for (const n of b) c = crcTable[(c ^ n) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function fail(message: string): never { throw new Error(`OFFICE_FORMAT: ${message}`); }

export function readSafeZip(input: Uint8Array, kind: 'ooxml' | 'odf' = 'ooxml'): Record<string, Buffer> {
  const b = Buffer.from(input);
  if (b.length > FORMAT_LIMITS.inputBytes || b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) fail('Invalid ZIP or file too large');
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { end = i; break; }
  if (end < 0) fail('Missing ZIP directory');
  const count = b.readUInt16LE(end + 10), directorySize = b.readUInt32LE(end + 12), directoryOffset = b.readUInt32LE(end + 16);
  if (count > FORMAT_LIMITS.entries || count === 65535 || b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6) || count !== b.readUInt16LE(end + 8) || directoryOffset + directorySize !== end) fail('Unsupported ZIP directory');
  const result: Record<string, Buffer> = Object.create(null); const spans: [number, number][] = []; let total = 0, p = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || b.readUInt32LE(p) !== 0x02014b50) fail('Malformed ZIP entry');
    const flags = b.readUInt16LE(p + 8), method = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), packed = b.readUInt32LE(p + 20), size = b.readUInt32LE(p + 24);
    const nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), offset = b.readUInt32LE(p + 42);
    if (p + 46 + nl + el + cl > end || flags & (1 | 64 | 8192) || b.readUInt16LE(p + 34) !== 0 || ![0, 8].includes(method) || size > FORMAT_LIMITS.entryBytes || size > Math.max(1024, packed) * FORMAT_LIMITS.ratio || offset + 30 > directoryOffset) fail('Encrypted, oversized or unsupported ZIP entry');
    const name = b.subarray(p + 46, p + 46 + nl).toString('utf8');
    if (!name || /[\\\x00-\x1f]/.test(name) || name.startsWith('/') || name.includes(':') || name.split('/').includes('..') || Object.hasOwn(result, name)) fail('Unsafe or duplicate ZIP path');
    if (b.readUInt32LE(offset) !== 0x04034b50 || b.readUInt16LE(offset + 8) !== method || b.readUInt16LE(offset + 6) !== flags) fail('Inconsistent ZIP headers');
    const localName = b.readUInt16LE(offset + 26), localExtra = b.readUInt16LE(offset + 28), start = offset + 30 + localName + localExtra;
    if (!(flags & 8) && (b.readUInt32LE(offset + 14) !== crc || b.readUInt32LE(offset + 18) !== packed || b.readUInt32LE(offset + 22) !== size)) fail('Inconsistent ZIP local size or CRC');
    if (kind === 'odf' && name === 'mimetype' && (offset !== 0 || method !== 0 || localExtra !== 0)) fail('OpenDocument mimetype must be first, uncompressed and have no extra field');
    if (b.subarray(offset + 30, offset + 30 + localName).toString('utf8') !== name || start + packed > directoryOffset || spans.some(([a, z]) => offset < z && start + packed > a)) fail('Overlapping ZIP entries');
    spans.push([offset, start + packed]); total += size;
    if (total > FORMAT_LIMITS.expandedBytes) fail('ZIP expansion limit exceeded');
    const compressed = b.subarray(start, start + packed);
    const out = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: Math.max(1, Math.min(size + 1, FORMAT_LIMITS.entryBytes)) });
    if (out.length !== size || crc32(out) !== crc) fail('ZIP integrity failure');
    if (/vba|activex|embeddings\/|externallinks\//i.test(name)) fail('Macros, active objects and external workbooks are not accepted');
    result[name] = out; p += 46 + nl + el + cl;
  }
  if (p !== end) fail('Invalid ZIP directory length');
  if (kind === 'ooxml' && !result['[Content_Types].xml']) fail('Not an OOXML package');
  if (kind === 'odf') {
    const mime = result.mimetype?.toString('utf8');
    if (!['application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet'].includes(mime ?? '') || !result['content.xml'] || !result['META-INF/manifest.xml']) fail('Not an OpenDocument package');
    if (Object.keys(result).some(name => /^(?:(?:Basic|Scripts)(?:\/|$)|Object(?:Replacements)?(?:\s|\d|\/))/i.test(name))) fail('OpenDocument active objects are not accepted');
  }
  for (const [name, data] of Object.entries(result)) if (/\.(xml|rels)$/i.test(name) && /<!DOCTYPE|<!ENTITY|\bDDEAUTO\b|\bDDE\s|macroEnabled/i.test(data.toString('utf8'))) fail('Active XML content is not accepted');
  if (kind === 'odf') for (const [name, data] of Object.entries(result)) if (/\.xml$/i.test(name)) inspectOdfXml(data);
  return result;
}

/** Validate syntax and bound parser recursion before any ODF codec sees the XML. */
export function inspectOdfXml(data: Uint8Array): string {
  if (data.byteLength > FORMAT_LIMITS.entryBytes) fail('OpenDocument XML size limit exceeded');
  let value: string;
  try { value = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { fail('OpenDocument XML must use UTF-8'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) || /<!DOCTYPE|<!ENTITY/i.test(value)) fail('Active or encrypted OpenDocument content is not accepted');
  // Bound recursion before parsing and honor quotes: a '>' inside an attribute
  // is not an XML tag boundary and cannot conceal depth or reject a valid file.
  let depth = 0, count = 0, p = 0;
  while ((p = value.indexOf('<', p)) >= 0) {
    let end = -1;
    if (value.startsWith('<!--', p)) { end = value.indexOf('-->', p + 4); if (end < 0) fail('Malformed OpenDocument XML'); p = end + 3; continue; }
    if (value.startsWith('<![CDATA[', p)) { end = value.indexOf(']]>', p + 9); if (end < 0) fail('Malformed OpenDocument XML'); p = end + 3; continue; }
    if (value.startsWith('<?', p)) { end = value.indexOf('?>', p + 2); if (end < 0) fail('Malformed OpenDocument XML'); if (!/^<\?xml\s/i.test(value.slice(p, end))) fail('OpenDocument processing instructions are disabled'); p = end + 2; continue; }
    let quote = '';
    for (let i = p + 1; i < value.length; i++) { const ch = value[i]; if (quote) { if (ch === quote) quote = ''; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') { end = i; break; } }
    if (end < 0) fail('Malformed OpenDocument XML');
    const tag = value.slice(p, end + 1);
    if (++count > 600000) fail('OpenDocument XML element limit exceeded');
    if (tag.startsWith('</')) depth--; else if (!/\/\s*>$/.test(tag)) depth++;
    if (depth < 0 || depth > 96) fail('OpenDocument XML nesting limit exceeded');
    p = end + 1;
  }
  if (depth !== 0 || XMLValidator.validate(value) !== true) fail('Malformed OpenDocument XML');
  // In this pinned parser, numeric XML references require htmlEntities:true.
  const parsed = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, parseAttributeValue: false, processEntities: true, htmlEntities: true }).parse(value);
  const pending: any[] = [...parsed];
  const active = new Set(['script', 'event-listener', 'event-listeners', 'form', 'forms', 'dde-link', 'dde-source', 'dde-connection', 'table-source', 'source-service', 'object', 'object-ole', 'applet', 'plugin', 'encryption-data', 'include']);
  while (pending.length) {
    const item = pending.pop();
    for (const [name, children] of Object.entries(item)) {
      if (name === ':@' || name.startsWith('#') || name.startsWith('?')) continue;
      const local = name.split(':').at(-1)!.toLowerCase();
      if (active.has(local) || local === 'scripts' && Array.isArray(children) && children.some(child => Object.keys(child).some(key => key !== '#text' || String(child[key]).trim()))) fail('Active or encrypted OpenDocument content is not accepted');
      for (const [attribute, raw] of Object.entries(item[':@'] ?? {})) {
        const attr = attribute.split(':').at(-1)!.toLowerCase(), data = String(raw);
        if (['macro-name', 'event-name', 'language'].includes(attr) && attribute.startsWith('script:')) fail('OpenDocument script attributes are disabled');
        if (attr === 'href' && local !== 'a' && (/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(data) || data.split('/').includes('..'))) fail('OpenDocument external resources are disabled');
      }
      if (Array.isArray(children)) for (const child of children) pending.push(child);
    }
  }
  return value;
}

