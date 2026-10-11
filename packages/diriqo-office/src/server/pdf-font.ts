import { createHash } from 'node:crypto';
import { PDF_FONT_BASE64, PDF_FONT_SHA256, PDF_FONT_LICENSE_BASE64 } from './pdf-font-data.ts';

/** Reads only our hash-pinned, unmodified OFL font. Never accepts uploaded fonts.
 * Original implementation from the OpenType head/hhea/hmtx/cmap specifications. */
export function loadPdfFont() {
  const bytes = Buffer.from(PDF_FONT_BASE64, 'base64');
  const license = Buffer.from(PDF_FONT_LICENSE_BASE64, 'base64');
  if (createHash('sha256').update(bytes).digest('hex') !== PDF_FONT_SHA256) throw Error('OFFICE_PDF: Font integrity mismatch');
  if (createHash('sha256').update(license).digest('hex') !== '1781d2806a07d91c4edf4740b88449fab7d0eadad53f7c351b94cd4d4eb8c00f') throw Error('OFFICE_PDF: Font license integrity mismatch');
  const tables: Record<string, number> = {};
  for (let i = 0; i < bytes.readUInt16BE(4); i++) { const p = 12 + 16 * i; tables[bytes.toString('ascii', p, p + 4)] = bytes.readUInt32BE(p + 8); }
  const units = bytes.readUInt16BE(tables.head + 18), scale = (n: number) => Math.round(n * 1000 / units);
  const metrics = bytes.readUInt16BE(tables.hhea + 34), glyphCount = bytes.readUInt16BE(tables.maxp + 4);
  const advances = Array.from({ length: glyphCount }, (_, i) => scale(bytes.readUInt16BE(tables.hmtx + Math.min(i, metrics - 1) * 4)));
  const cmap = tables.cmap; let format4 = 0, format12 = 0;
  for (let i = 0; i < bytes.readUInt16BE(cmap + 2); i++) {
    const p = cmap + 4 + i * 8, platform = bytes.readUInt16BE(p), encoding = bytes.readUInt16BE(p + 2), offset = cmap + bytes.readUInt32BE(p + 4);
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
    if (bytes.readUInt16BE(offset) === 4) format4 = offset;
    if (bytes.readUInt16BE(offset) === 12) format12 = offset;
  }
  function glyph(code: number): number {
    if (format12) {
      let lo = 0, hi = bytes.readUInt32BE(format12 + 12) - 1;
      while (lo <= hi) { const mid = (lo + hi) >>> 1, p = format12 + 16 + 12 * mid, start = bytes.readUInt32BE(p), end = bytes.readUInt32BE(p + 4); if (code < start) hi = mid - 1; else if (code > end) lo = mid + 1; else return bytes.readUInt32BE(p + 8) + code - start; }
    }
    if (!format4 || code > 65535) return 0;
    const n = bytes.readUInt16BE(format4 + 6) / 2, ends = format4 + 14, starts = ends + n * 2 + 2, deltas = starts + n * 2, ranges = deltas + n * 2;
    for (let i = 0; i < n; i++) {
      const end = bytes.readUInt16BE(ends + i * 2); if (code > end) continue;
      const start = bytes.readUInt16BE(starts + i * 2); if (code < start) return 0;
      const delta = bytes.readInt16BE(deltas + i * 2), range = bytes.readUInt16BE(ranges + i * 2);
      if (!range) return (code + delta) & 65535;
      const value = bytes.readUInt16BE(ranges + i * 2 + range + 2 * (code - start)); return value ? (value + delta) & 65535 : 0;
    }
    return 0;
  }
  return { bytes, license: license.toString('utf8'), glyph, width: (code: number) => advances[glyph(code)] ?? advances[0], bbox: [36, 38, 40, 42].map(p => scale(bytes.readInt16BE(tables.head + p))), ascent: scale(bytes.readInt16BE(tables.hhea + 4)), descent: scale(bytes.readInt16BE(tables.hhea + 6)) };
}
