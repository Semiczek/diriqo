import type { DocumentContent } from '../core/types.ts';
import { loadPdfFont } from './pdf-font.ts';

// Original bounded serializer using ISO 32000-1 sections 7, 9.7 and 9.10.
// No user-controlled object syntax, font files, URLs, actions or JavaScript.
export const PDF_LIMITS = Object.freeze({ characters: 100000, nodes: 20000, depth: 32, pages: 200, tableCells: 5000, tableColumns: 16 });
const W = 595.28, H = 841.89, mm = 72 / 25.4;
const bad = (message: string): never => { throw Error(`OFFICE_PDF: ${message}`); };
const num = (n: number) => { if (!Number.isFinite(n)) bad('Non-finite layout coordinate'); return String(Math.round(n * 1000) / 1000); };
type Style = { size: number; bold: boolean; italic: boolean; underline: boolean; strike: boolean; color: string; leading: number };
type Glyph = { ch: string; style: Style; width: number };
type Line = Glyph[];
type TextOp = { kind: 'text'; x: number; y: number; glyphs: Glyph[] };
type BoxOp = { kind: 'box'; x: number; y: number; w: number; h: number; shade: boolean };
type Op = TextOp | BoxOp;
const base: Style = { size: 11, bold: false, italic: false, underline: false, strike: false, color: '0 0 0', leading: 1.35 };
let cachedFont: ReturnType<typeof loadPdfFont> | undefined;

export function exportPdf(content: DocumentContent): { bytes: Buffer; warnings: string[] } {
  const font = cachedFont ??= loadPdfFont(), warnings = new Set<string>(['PDF exports a bounded A4 layout with embedded Geist: paragraphs, headings, basic text styles, lists and simple tables. It does not reproduce Word pagination or arbitrary font families.']);
  let nodes = 0, characters = 0, cells = 0;
  function check(n: any, depth = 0): void {
    if (!n || typeof n !== 'object' || Array.isArray(n) || ++nodes > PDF_LIMITS.nodes || depth > PDF_LIMITS.depth) bad('Document structure limit exceeded');
    if (n.text !== undefined) { if (typeof n.text !== 'string') bad('Invalid text'); characters += n.text.length; }
    if (characters > PDF_LIMITS.characters) bad('Text exceeds 100000 characters');
    if (n.content !== undefined) { if (!Array.isArray(n.content)) bad('Invalid node content'); for (const child of n.content) check(child, depth + 1); }
  }
  check(content.doc);
  if (content.doc.type !== 'doc' || !content.page || !Number.isFinite(content.page.marginMm) || content.page.marginMm < 5 || content.page.marginMm > 50) bad('Invalid A4 page margins');
  if (typeof content.page.header !== 'string' || typeof content.page.footer !== 'string' || content.page.header.length + content.page.footer.length > 2000) bad('Header/footer exceeds export limit');
  const margin = content.page.marginMm * mm, width = W - 2 * margin;
  function glyphs(text: string, style: Style): Glyph[] {
    const result: Glyph[] = [];
    for (const ch of text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')) {
      const code = ch.codePointAt(0)!;
      if (ch === '\n') { result.push({ ch, style, width: 0 }); continue; }
      const safe = font.glyph(code) && code >= 32 && code !== 127 ? ch : `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]`;
      if (safe !== ch) warnings.add('Characters not supported by the embedded font/control characters are shown as explicit [U+XXXX] placeholders.');
      if (code >= 0x590 && code <= 0x8ff) warnings.add('Complex-script shaping and bidirectional layout are not supported by this PDF subset.');
      for (const c of safe) result.push({ ch: c, style, width: font.width(c.codePointAt(0)!) * style.size / 1000 });
    }
    return result;
  }
  function styleFor(node: any, initial: Style): Style {
    const s = { ...initial };
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') { s.bold = true; warnings.add('Bold and italic use synthetic emphasis of the embedded regular font.'); }
      else if (mark.type === 'italic') { s.italic = true; warnings.add('Bold and italic use synthetic emphasis of the embedded regular font.'); }
      else if (mark.type === 'underline') s.underline = true;
      else if (mark.type === 'strike') s.strike = true;
      else if (mark.type === 'textStyle') {
        const a = mark.attrs ?? {};
        if (a.fontFamily) warnings.add('Font family selections are replaced by the embedded Geist font.');
        if (a.lineHeight != null) { const leading = Number(a.lineHeight); if (!Number.isFinite(leading) || leading < 1 || leading > 3) bad('Invalid inline line spacing'); s.leading = Math.max(1.35, leading); if (leading < 1.35) warnings.add('Tight line spacing is expanded to prevent glyph overlap with the embedded font.'); }
        if (a.fontSize != null) { const match = String(a.fontSize).match(/^(\d+(?:\.\d+)?)(pt|px)?$/); if (!match) throw Error('OFFICE_PDF: Invalid font size'); const size = Number(match[1]) * (match[2] === 'px' ? .75 : 1); if (!Number.isFinite(size) || size < 6 || size > 48) bad('Supported PDF font sizes are 6–48 pt'); s.size = size; }
        if (a.color) { const value = String(a.color); if (/^#[0-9a-f]{6}$/i.test(value)) s.color = [1, 3, 5].map(i => num(parseInt(value.slice(i, i + 2), 16) / 255)).join(' '); else warnings.add('Unsupported text colors use black in PDF.'); }
      } else if (mark.type === 'link') warnings.add('Hyperlinks are exported as visible text only; PDF has no active links or external resources.');
      else warnings.add('Some inline formatting (highlight/code/subscript/superscript) is simplified in PDF.');
    }
    return s;
  }
  function inline(node: any, style: Style): Glyph[] {
    if (node.type === 'text') return glyphs(node.text ?? '', styleFor(node, style));
    if (node.type === 'hardBreak') return glyphs('\n', style);
    if (node.type === 'image') { warnings.add('Images are replaced by visible alt-text placeholders in this PDF subset.'); return glyphs(`[Image: ${String(node.attrs?.alt || 'image').slice(0, 200)}]`, style); }
    return (node.content ?? []).flatMap((child: any) => inline(child, style));
  }
  function wrap(items: Glyph[], available: number): Line[] {
    if (available < 24) bad('Text area too narrow');
    const lines: Line[] = []; let line: Line = [], used = 0;
    const finish = () => { lines.push(line); line = []; used = 0; };
    for (const item of items) {
      if (item.ch === '\n') { finish(); continue; }
      if (item.width > available) bad('Glyph exceeds available line width');
      if (used + item.width > available && line.length) {
        const space = line.map(g => g.ch).lastIndexOf(' ');
        if (space > 0) { const carry = line.splice(space + 1); line.pop(); finish(); line = carry; used = carry.reduce((sum, g) => sum + g.width, 0); }
        else finish();
        if (used + item.width > available && line.length) finish();
      }
      line.push(item); used += item.width;
    }
    if (line.length || !lines.length) finish();
    return lines;
  }
  const header = wrap(glyphs(content.page.header, { ...base, size: 9 }), width), footer = wrap(glyphs(content.page.footer, { ...base, size: 9 }), width);
  if (header.length > 3 || footer.length > 3) bad('Header/footer requires more than three lines');
  const top = margin + (content.page.header ? header.length * 12 + 10 : 0), bottom = H - margin - (content.page.footer ? footer.length * 12 + 8 : 0) - 18;
  const pages: Op[][] = []; let page: Op[], y: number;
  function newPage() { if (pages.length >= PDF_LIMITS.pages) bad('PDF exceeds 200 pages'); pages.push(page = []); y = top; }
  newPage();
  function lineHeight(line: Line) { return Math.max(11 * 1.35, ...line.map(g => g.style.size * g.style.leading)); }
  function drawLine(line: Line, x: number, baseline: number) { if (line.length) page.push({ kind: 'text', x, y: H - baseline, glyphs: line }); }
  function paragraph(node: any, indent = 0, prefix = '') {
    const level = Number(node.attrs?.level || 1), style = { ...base, size: node.type === 'heading' ? Math.max(12, 26 - Math.min(6, level) * 2) : 11, bold: node.type === 'heading' };
    if (style.bold) warnings.add('Bold and italic use synthetic emphasis of the embedded regular font.');
    const extra = Number(node.attrs?.indent ?? 0); if (!Number.isFinite(extra) || extra < 0 || extra > 8) bad('Invalid paragraph indent');
    const left = margin + indent + extra * 9, available = W - margin - left - 8;
    const lines = wrap([...glyphs(prefix, style), ...inline(node, style)], available);
    const spacing = Number(node.attrs?.lineHeight ?? 1.35); if (!Number.isFinite(spacing) || spacing < 1 || spacing > 3) bad('Invalid line spacing');
    for (const line of lines) {
      const h = Math.max(lineHeight(line), Math.max(style.size, ...line.map(g => g.style.size)) * spacing);
      if (y + h > bottom) newPage();
      const used = line.reduce((n, g) => n + g.width, 0), align = node.attrs?.textAlign;
      if (align === 'justify') warnings.add('Justified paragraphs use left alignment in PDF.');
      const x = left + (align === 'center' ? (available - used) / 2 : align === 'right' ? available - used : 0);
      drawLine(line, x, y + h * .8); y += h;
    }
    y += node.type === 'heading' ? 8 : 5;
  }
  function table(node: any, indent: number) {
    const rows = node.content ?? []; if (!rows.length) return;
    const columns = Math.max(...rows.map((r: any) => (r.content ?? []).reduce((n: number, c: any) => n + Number(c.attrs?.colspan ?? 1), 0)));
    if (!Number.isInteger(columns) || columns < 1 || columns > PDF_LIMITS.tableColumns) bad('PDF table supports at most 16 columns');
    const colWidth = (width - indent) / columns;
    for (const row of rows) {
      const parts = (row.content ?? []).map((cell: any) => {
        if (++cells > PDF_LIMITS.tableCells) bad('PDF table cell limit exceeded');
        const span = Number(cell.attrs?.colspan ?? 1); if (!Number.isInteger(span) || span < 1 || span > columns) bad('Invalid table colspan');
        if (Number(cell.attrs?.rowspan ?? 1) !== 1) bad('PDF does not support merged table rows; use DOCX export');
        if (cell.attrs?.colwidth) warnings.add('PDF tables use equal base column widths; saved column widths are simplified.');
        const contentItems: Glyph[] = [];
        for (const [i, child] of (cell.content ?? []).entries()) { if (i) contentItems.push(...glyphs('\n', base)); if (!['paragraph', 'heading'].includes(child.type)) warnings.add('Nested structures in table cells are simplified to visible text.'); contentItems.push(...inline(child, base)); }
        return { lines: wrap(contentItems, colWidth * span - 12), span, shade: cell.type === 'tableHeader' };
      });
      const count = Math.max(1, ...parts.map((p: any) => p.lines.length));
      let offset = 0;
      while (offset < count) {
        if (bottom - y < 28) newPage();
        let heights: number[] = [], total = 8;
        for (let i = offset; i < count; i++) { const h = Math.max(15, ...parts.map((p: any) => lineHeight(p.lines[i] ?? []))); if (total + h > bottom - y) break; heights.push(h); total += h; }
        if (!heights.length) { newPage(); continue; }
        let x = margin + indent;
        for (const part of parts) {
          const cellWidth = colWidth * part.span; page.push({ kind: 'box', x, y: H - y - total, w: cellWidth, h: total, shade: part.shade });
          let baseline = y + 4; heights.forEach((h, i) => { drawLine(part.lines[offset + i] ?? [], x + 6, baseline + h * .8); baseline += h; }); x += cellWidth;
        }
        y += total; offset += heights.length;
        if (offset < count) { warnings.add('Long table rows continue across pages; column headers are not automatically repeated.'); newPage(); }
      }
    }
    y += 8;
  }
  function block(node: any, indent = 0) {
    if (node.type === 'paragraph' || node.type === 'heading') paragraph(node, indent);
    else if (node.type === 'pageBreak') newPage();
    else if (node.type === 'table') table(node, indent);
    else if (node.type === 'bulletList' || node.type === 'orderedList') {
      const start = Number(node.attrs?.start ?? 1); if (!Number.isSafeInteger(start) || start < 0 || start > 100000) bad('Invalid list start');
      (node.content ?? []).forEach((item: any, i: number) => {
        const children = item.content ?? []; let marked = false;
        for (const child of children) { if (!marked && ['paragraph', 'heading'].includes(child.type)) { paragraph(child, indent + 12, node.type === 'orderedList' ? `${start + i}. ` : '• '); marked = true; } else block(child, indent + 12); }
      });
    } else if (node.type === 'blockquote' || node.type === 'doc') (node.content ?? []).forEach((child: any) => block(child, indent + (node.type === 'blockquote' ? 12 : 0)));
    else if (node.type === 'horizontalRule') { if (y + 10 > bottom) newPage(); page.push({ kind: 'box', x: margin + indent, y: H - y, w: width - indent, h: .2, shade: false }); y += 10; }
    else { warnings.add(`Unsupported block ${String(node.type).slice(0, 40)} is simplified to visible text in PDF.`); paragraph(node, indent); }
  }
  block(content.doc);
  for (let i = 0; i < pages.length; i++) {
    page = pages[i]; if (content.page.header) header.forEach((line, j) => drawLine(line, margin, margin + 9 + j * 12));
    if (content.page.footer) footer.forEach((line, j) => drawLine(line, margin, H - margin - 18 - (footer.length - 1 - j) * 12));
    drawLine(glyphs(`${i + 1} / ${pages.length}`, { ...base, size: 9 }), margin, H - margin);
  }
  return { bytes: serialize(pages, font), warnings: [...warnings] };
}

function serialize(pages: Op[][], font: ReturnType<typeof loadPdfFont>): Buffer {
  const objects: Buffer[] = [Buffer.alloc(0)], add = (value: string | Buffer) => { objects.push(typeof value === 'string' ? Buffer.from(value, 'ascii') : value); return objects.length - 1; };
  const stream = (bytes: Buffer, extra = '') => Buffer.concat([Buffer.from(`<< /Length ${bytes.length} ${extra} >>\nstream\n`, 'ascii'), bytes, Buffer.from('\nendstream', 'ascii')]);
  const ids = new Map<string, number>(); for (const page of pages) for (const op of page) if (op.kind === 'text') for (const g of op.glyphs) if (!ids.has(g.ch)) ids.set(g.ch, ids.size + 1);
  if (ids.size > 65534) bad('PDF glyph count limit exceeded');
  const root = add(''), pageTree = add(''), fontId = add('');
  const fontFile = add(stream(font.bytes, `/Length1 ${font.bytes.length}`));
  const descriptor = add(`<< /Type /FontDescriptor /FontName /Geist-Regular /Flags 32 /FontBBox [${font.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${font.ascent} /Descent ${font.descent} /CapHeight ${font.ascent} /StemV 80 /FontFile2 ${fontFile} 0 R >>`);
  const mapping = Buffer.alloc((ids.size + 1) * 2); for (const [ch, cid] of ids) mapping.writeUInt16BE(font.glyph(ch.codePointAt(0)!), cid * 2);
  const mapId = add(stream(mapping));
  const widths = [...ids.keys()].map(ch => font.width(ch.codePointAt(0)!));
  const descendant = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Geist-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 1000 /W [1 [${widths.join(' ')}]] /CIDToGIDMap ${mapId} 0 R >>`);
  const hex = (n: number) => n.toString(16).padStart(4, '0');
  const entries = [...ids].map(([ch, cid]) => `<${hex(cid)}> <${Array.from({ length: ch.length }, (_, i) => hex(ch.charCodeAt(i))).join('')}>`);
  const batches: string[] = []; for (let i = 0; i < entries.length; i += 100) { const batch = entries.slice(i, i + 100); batches.push(`${batch.length} beginbfchar\n${batch.join('\n')}\nendbfchar`); }
  const unicode = add(stream(Buffer.from(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /DiriqoUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${batches.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`, 'ascii')));
  objects[fontId] = Buffer.from(`<< /Type /Font /Subtype /Type0 /BaseFont /Geist-Regular /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${unicode} 0 R >>`, 'ascii');
  const pageIds: number[] = [];
  for (const page of pages) {
    const commands: string[] = [];
    for (const op of page) {
      if (op.kind === 'box') { commands.push(`q 0.65 G 0.4 w ${op.shade ? '0.94 g' : '1 g'} ${num(op.x)} ${num(op.y)} ${num(op.w)} ${num(op.h)} re B Q`); continue; }
      let x = op.x;
      for (let i = 0; i < op.glyphs.length;) {
        const style = op.glyphs[i].style; let text = '', width = 0;
        do { const g = op.glyphs[i++]; text += hex(ids.get(g.ch)!); width += g.width; } while (i < op.glyphs.length && op.glyphs[i].style === style);
        commands.push(`q ${style.color} rg ${style.color} RG BT /F1 ${num(style.size)} Tf ${style.bold ? '2 Tr 0.22 w' : '0 Tr'} 1 0 ${style.italic ? '0.18' : '0'} 1 ${num(x)} ${num(op.y)} Tm <${text}> Tj ET`);
        if (style.underline) commands.push(`0.5 w ${num(x)} ${num(op.y - 1.5)} m ${num(x + width)} ${num(op.y - 1.5)} l S`);
        if (style.strike) commands.push(`0.5 w ${num(x)} ${num(op.y + style.size * .3)} m ${num(x + width)} ${num(op.y + style.size * .3)} l S`);
        commands.push('Q'); x += width;
      }
    }
    const contents = add(stream(Buffer.from(commands.join('\n'), 'ascii')));
    pageIds.push(add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contents} 0 R >>`));
  }
  objects[root] = Buffer.from(`<< /Type /Catalog /Pages ${pageTree} 0 R >>`, 'ascii');
  objects[pageTree] = Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`, 'ascii');
  const licenseHex = 'FEFF' + Array.from({ length: font.license.length }, (_, i) => hex(font.license.charCodeAt(i))).join('');
  const info = add(`<< /Producer (Diriqo Office) /FontLicense <${licenseHex}> >>`);
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')], offsets = [0]; let offset = chunks[0].length;
  objects.slice(1).forEach((obj, index) => { offsets.push(offset); const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), obj, Buffer.from('\nendobj\n')]); chunks.push(part); offset += part.length; });
  chunks.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'ascii'));
  return Buffer.concat(chunks);
}
