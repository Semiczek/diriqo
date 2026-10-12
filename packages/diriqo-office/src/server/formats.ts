import {isOfficeFormulaSafe} from '../core/formula-policy.ts';
/** Bounded, deliberately partial OOXML adapters authored for Diriqo. No macros or network I/O. */
import { FORMAT_LIMITS, readSafeZip } from './container-safety.ts';
export { FORMAT_LIMITS, readSafeZip } from './container-safety.ts';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { parseDocument } from 'htmlparser2';
import sanitizeHtml from 'sanitize-html';
import type { DocumentContent, OfficeContent, SpreadsheetContent } from '../core/types.ts';
import { exportPdf } from './pdf.ts';
import { importOdt, exportOdt, ODT_MIME } from './opendocument-text.ts';
import { importAlternativeSpreadsheet, exportAlternativeSpreadsheet, ODS_MIME } from './alternative-spreadsheets.ts';
import { importDoc } from './legacy-doc.ts';

const escapeXml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
function fail(message: string): never { throw new Error(`OFFICE_FORMAT: ${message}`); }

type X = { name: string; attrs: Record<string, string>; children: any[] };
function xml(data: Buffer | string | undefined): any[] {
  if (data === undefined) return [];
  const text = String(data);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail('XML entities are disabled');
  return new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, parseAttributeValue: false, trimValues: false, processEntities: true }).parse(text);
}
function nodes(data: any[], name?: string): X[] { return (data ?? []).flatMap(n => Object.keys(n).filter(k => k !== ':@' && k !== '#text' && !k.startsWith('?') && (!name || k === name)).map(k => ({ name: k, attrs: n[':@'] ?? {}, children: n[k] }))); }
function child(x: X | undefined, name: string) { return x && nodes(x.children, name)[0]; }
function descendants(data: any[], name: string): X[] { return nodes(data).flatMap(x => [...(x.name === name ? [x] : []), ...descendants(x.children, name)]); }
function textOf(data: any[]): string { return (data ?? []).map(n => n['#text'] !== undefined ? String(n['#text']) : nodes([n]).map(x => textOf(x.children)).join('')).join(''); }
function xmlZip(files: Record<string, string | Uint8Array>): Buffer { return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([n, v]) => [n, typeof v === 'string' ? strToU8(v) : v])), { level: 6 })); }
const doc = (content: any[]): DocumentContent => ({ schemaVersion: 1, kind: 'document', doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }, page: { marginMm: 20, header: '', footer: '' } });
const txt = (value: string, marks: any[] = []) => value ? [{ type: 'text', text: value, ...(marks.length ? { marks } : {}) }] : [];

export function safeLink(url: unknown): string | null { return typeof url === 'string' && /^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(url) ? url : null; }
export function sanitizeOfficeHtml(value: string): string {
  return sanitizeHtml(value, { allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'a', 'span', 'blockquote', 'hr'], allowedAttributes: { a: ['href'], '*': ['style'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] }, allowedSchemes: ['http', 'https', 'mailto'], allowProtocolRelative: false, allowedStyles: { '*': { color: [/^#[0-9a-f]{3,8}$/i], 'background-color': [/^#[0-9a-f]{3,8}$/i], 'text-align': [/^(left|center|right|justify)$/], 'font-size': [/^\d{1,2}(px|pt)$/], 'font-family': [/^(Arial|Georgia|Verdana|Tahoma|Times New Roman|Courier New|sans-serif|serif)$/] } } });
}
export function htmlToDocument(html: string): DocumentContent {
  const tree = parseDocument(sanitizeOfficeHtml(html));
  function convert(n: any, marks: any[] = []): any[] {
    if (n.type === 'text') return txt(n.data, marks);
    const tag = n.name; let next = marks;
    const mark = ({ strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline', s: 'strike', del: 'strike' } as Record<string, string>)[tag];
    if (mark) next = [...marks, { type: mark }];
    if (tag === 'a' && safeLink(n.attribs.href)) next = [...next, { type: 'link', attrs: { href: safeLink(n.attribs.href), target: '_blank', rel: 'noopener noreferrer' } }];
    const styles = Object.fromEntries((n.attribs?.style ?? '').split(';').map((s: string) => s.split(':').map(x => x.trim())).filter((p: string[]) => p.length === 2));
    if (styles.color || styles['font-family'] || styles['font-size']) next = [...next, { type: 'textStyle', attrs: { ...(styles.color?{color:styles.color}:{}), ...(styles['font-family']?{fontFamily:styles['font-family']}:{}), ...(styles['font-size']?{fontSize:styles['font-size']}:{} ) } }];
    const content = (n.children ?? []).flatMap((c: any) => convert(c, next));
    if (tag === 'br') return [{ type: 'hardBreak' }]; if (tag === 'hr') return [{ type: 'horizontalRule' }];
    const type = ({ p: 'paragraph', blockquote: 'blockquote', ul: 'bulletList', ol: 'orderedList', li: 'listItem', table: 'table', tr: 'tableRow', td: 'tableCell', th: 'tableHeader' } as Record<string, string>)[tag];
    if (/^h[1-6]$/.test(tag)) return [{ type: 'heading', attrs: { level: Number(tag[1]), textAlign: styles['text-align'] || 'left' }, content }];
    if (type) {
      const blockContent = ['tableCell', 'tableHeader', 'listItem'].includes(type) && !content.some((c:any) => ['paragraph', 'heading', 'bulletList', 'orderedList'].includes(c.type)) ? [{ type: 'paragraph', content }] : content;
      return [{ type, ...(tag === 'p' ? { attrs: { textAlign: styles['text-align'] || 'left' } } : {}), ...(['td', 'th'].includes(tag) ? { attrs: { colspan: Math.min(100, Math.max(1, Number(n.attribs.colspan) || 1)), rowspan: Math.min(100, Math.max(1, Number(n.attribs.rowspan) || 1)), colwidth: null } } : {}), ...(blockContent.length ? { content: blockContent } : {}) }];
    }
    return content;
  }
  const content = tree.children.flatMap(n => convert(n));
  return doc(content.flatMap(n => n.type === 'text' ? (n.text.trim() ? [{ type: 'paragraph', content: [n] }] : []) : [n]));
}

export function documentToHtml(document: DocumentContent): string {
  function render(n: any): string {
    if (n.type === 'text') { let s = escapeXml(n.text); for (const m of n.marks ?? []) { const tag = ({ bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code' } as Record<string, string>)[m.type]; if (tag) s = `<${tag}>${s}</${tag}>`; if (m.type === 'link' && safeLink(m.attrs?.href)) s = `<a href="${escapeXml(m.attrs.href)}">${s}</a>`; if (m.type === 'textStyle') { const a = m.attrs ?? {}; s = `<span style="${escapeXml([a.color && `color:${a.color}`, a.fontFamily && `font-family:${a.fontFamily}`, a.fontSize && `font-size:${a.fontSize}`].filter(Boolean).join(';'))}">${s}</span>`; } } return s; }
    if (n.type === 'hardBreak') return '<br>'; if (n.type === 'horizontalRule') return '<hr>'; if (n.type === 'pageBreak') return '<div style="break-after:page"></div>';
    if (n.type === 'image') return /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(n.attrs?.src ?? '') ? `<img alt="${escapeXml(n.attrs?.alt)}" src="${escapeXml(n.attrs.src)}" style="max-width:100%">` : '';
    const tag = n.type === 'heading' ? `h${Math.max(1, Math.min(6, n.attrs?.level ?? 1))}` : ({ doc: 'article', paragraph: 'p', bulletList: 'ul', orderedList: 'ol', listItem: 'li', table: 'table', tableRow: 'tr', tableCell: 'td', tableHeader: 'th', blockquote: 'blockquote', codeBlock: 'pre' } as Record<string, string>)[n.type] ?? 'div';
    const align = ['left', 'right', 'center', 'justify'].includes(n.attrs?.textAlign) ? ` style="text-align:${n.attrs.textAlign}"` : '';
    const span = ['td', 'th'].includes(tag) ? ` colspan="${Math.min(100, n.attrs?.colspan || 1)}" rowspan="${Math.min(100, n.attrs?.rowspan || 1)}"` : '';
    return `<${tag}${align}${span}>${(n.content ?? []).map(render).join('')}</${tag}>`;
  }
  return render(document.doc);
}
export function documentToText(document: DocumentContent): string {
  const walk = (n: any): string => n.type === 'text' ? n.text : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(walk).join('') + (['paragraph', 'heading', 'tableRow', 'listItem'].includes(n.type) ? '\n' : n.type === 'tableCell' ? '\t' : '');
  return walk(document.doc).trimEnd();
}

export function importDocx(input: Uint8Array): { content: DocumentContent; warnings: string[] } {
  const zip = readSafeZip(input); if (!zip['word/document.xml']) fail('File is not DOCX');
  const warnings = ['DOCX subset: headings, paragraphs, basic inline styles, lists and tables. Layout, drawings, comments, fields, revisions and advanced styles may differ; the original is retained.'];
  const numbering = xml(zip['word/numbering.xml']); const nums = new Map(descendants(numbering, 'w:num').map(n => [n.attrs['w:numId'], child(n, 'w:abstractNumId')?.attrs['w:val']]));
  const numberTypes = new Map(descendants(numbering, 'w:abstractNum').map(n => [n.attrs['w:abstractNumId'], descendants(n.children, 'w:numFmt')[0]?.attrs['w:val']]));
  function convert(element: X): any[] {
    if (element.name === 'w:tbl') return [{ type: 'table', content: nodes(element.children, 'w:tr').map(row => ({ type: 'tableRow', content: nodes(row.children, 'w:tc').map(cell => ({ type: 'tableCell', attrs: { colspan: Number(child(child(cell, 'w:tcPr'), 'w:gridSpan')?.attrs['w:val'] ?? 1), rowspan: 1, colwidth: null }, content: nodes(cell.children).flatMap(convert).filter(n => n.type !== 'table') })) })) }];
    if (element.name !== 'w:p') return [];
    const pr = child(element, 'w:pPr'), style = child(pr, 'w:pStyle')?.attrs['w:val'] ?? '';
    const heading = /heading\s*([1-6])/i.exec(style); const content: any[] = [];
    for (const run of descendants(element.children, 'w:r')) {
      const rp = child(run, 'w:rPr'); const marks: any[] = [];
      for (const [w, type] of [['w:b', 'bold'], ['w:i', 'italic'], ['w:u', 'underline'], ['w:strike', 'strike']]) { const v = child(rp, w); if (v && !['0', 'false', 'none'].includes(v.attrs['w:val'])) marks.push({ type }); }
      const color = child(rp, 'w:color')?.attrs['w:val']; const size = Number(child(rp, 'w:sz')?.attrs['w:val']); const font = child(rp, 'w:rFonts')?.attrs['w:ascii'];
      if (color || size || font) marks.push({ type: 'textStyle', attrs: { ...(/^[\da-f]{6}$/i.test(color ?? '') ? { color: `#${color}` } : {}), ...(size > 0 && size <= 288 ? { fontSize: `${size / 2}pt` } : {}), ...(font ? { fontFamily: font } : {}) } });
      for (const c of nodes(run.children)) { if (c.name === 'w:t') content.push(...txt(textOf(c.children), marks)); if (c.name === 'w:tab') content.push(...txt('\t', marks)); if (c.name === 'w:br') content.push({ type: 'hardBreak' }); }
    }
    const para = { type: heading ? 'heading' : 'paragraph', attrs: { ...(heading ? { level: Number(heading[1]) } : {}), textAlign: child(pr, 'w:jc')?.attrs['w:val'] === 'both' ? 'justify' : child(pr, 'w:jc')?.attrs['w:val'] ?? 'left' }, content };
    const num = child(child(pr, 'w:numPr'), 'w:numId')?.attrs['w:val'];
    return num ? [{ type: numberTypes.get(nums.get(num)??'') === 'bullet' ? 'bulletList' : 'orderedList', content: [{ type: 'listItem', content: [para] }] }] : [para];
  }
  const body = descendants(xml(zip['word/document.xml']), 'w:body')[0]; if (!body) fail('Missing DOCX body');
  const converted = nodes(body.children).flatMap(convert); const merged: any[] = [];
  for (const n of converted) { const prev = merged.at(-1); if (['orderedList', 'bulletList'].includes(n.type) && prev?.type === n.type) prev.content.push(...n.content); else merged.push(n); }
  const result = doc(merged);
  const section = child(body, 'w:sectPr'); const margin = Number(child(section, 'w:pgMar')?.attrs['w:left']); if (margin > 0 && margin < 3000) result.page.marginMm = Math.round(margin * 25.4 / 1440);
  for (const key of ['header', 'footer'] as const) { const file = Object.keys(zip).find(n => new RegExp(`^word/${key}\\d*\\.xml$`).test(n)); if (file) result.page[key] = descendants(xml(zip[file]), 'w:t').map(n => textOf(n.children)).join(''); }
  return { content: result, warnings };
}

const wNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const contentNS = 'http://schemas.openxmlformats.org/package/2006/content-types';
export function exportDocx(document: DocumentContent): { bytes: Buffer; warnings: string[] } {
  const warnings: string[] = ['DOCX export supports basic text, lists, tables and simple headers/footers; exact pagination and advanced objects are not preserved.'];
  function runs(n: any): string {
    if (n.type === 'hardBreak') return '<w:r><w:br/></w:r>';
    if (n.type !== 'text') return (n.content ?? []).map(runs).join('');
    const properties = (n.marks ?? []).map((m: any) => { if (m.type === 'bold') return '<w:b/>'; if (m.type === 'italic') return '<w:i/>'; if (m.type === 'underline') return '<w:u w:val="single"/>'; if (m.type === 'strike') return '<w:strike/>'; if (m.type === 'textStyle') { const a = m.attrs ?? {}; return (/^#[\da-f]{6}$/i.test(a.color ?? '') ? `<w:color w:val="${a.color.slice(1)}"/>` : '') + (a.fontFamily ? `<w:rFonts w:ascii="${escapeXml(a.fontFamily)}" w:hAnsi="${escapeXml(a.fontFamily)}"/>` : '') + (parseFloat(a.fontSize) > 0 ? `<w:sz w:val="${Math.round(parseFloat(a.fontSize) * (String(a.fontSize).endsWith('px') ? 1.5 : 2))}"/>` : ''); } return ''; }).join('');
    return `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${escapeXml(n.text)}</w:t></w:r>`;
  }
  function block(n: any, list?: number): string {
    if (n.type === 'doc' || n.type === 'listItem' || n.type === 'blockquote') return (n.content ?? []).map((c: any) => block(c, list)).join('');
    if (n.type === 'bulletList' || n.type === 'orderedList') return (n.content ?? []).map((c: any) => block(c, n.type === 'bulletList' ? 1 : 2)).join('');
    if (n.type === 'table') return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="single" w:sz="4" w:color="CCCCCC"/>`).join('')}</w:tblBorders></w:tblPr>${(n.content ?? []).map((row: any) => `<w:tr>${(row.content ?? []).map((cell: any) => `<w:tc><w:tcPr><w:gridSpan w:val="${Math.max(1, Math.min(100, cell.attrs?.colspan || 1))}"/></w:tcPr>${(cell.content ?? []).map((c: any) => block(c)).join('') || '<w:p/>'}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
    if (n.type === 'pageBreak') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (n.type === 'image') return '<w:p><w:r><w:t>[Image omitted from DOCX subset]</w:t></w:r></w:p>';
    return `<w:p><w:pPr>${n.type === 'heading' ? `<w:pStyle w:val="Heading${n.attrs?.level || 1}"/>` : ''}${list ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${list}"/></w:numPr>` : ''}${n.attrs?.textAlign ? `<w:jc w:val="${escapeXml(n.attrs.textAlign === 'justify' ? 'both' : n.attrs.textAlign)}"/>` : ''}</w:pPr>${runs(n)}</w:p>`;
  }
  const margin = Math.round(Math.max(5, Math.min(50, document.page.marginMm)) * 1440 / 25.4);
  const files: Record<string, string> = {
    '[Content_Types].xml': `<Types xmlns="${contentNS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${relNS}"><Relationship Id="r1" Type="${rNS}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': `<w:document xmlns:w="${wNS}" xmlns:r="${rNS}"><w:body>${block(document.doc)}<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="360" w:footer="360"/></w:sectPr></w:body></w:document>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${relNS}">${['styles', 'numbering', 'header', 'footer'].map(k => `<Relationship Id="${k}" Type="${rNS}/${k}" Target="${k}${['header', 'footer'].includes(k) ? '1' : ''}.xml"/>`).join('')}</Relationships>`,
    'word/styles.xml': `<w:styles xmlns:w="${wNS}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${[1, 2, 3, 4, 5, 6].map(i => `<w:style w:type="paragraph" w:styleId="Heading${i}"><w:name w:val="heading ${i}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${i - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${48 - i * 4}"/></w:rPr></w:style>`).join('')}</w:styles>`,
    'word/numbering.xml': `<w:numbering xmlns:w="${wNS}">${[1, 2].map(i => `<w:abstractNum w:abstractNumId="${i}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${i === 1 ? 'bullet' : 'decimal'}"/><w:lvlText w:val="${i === 1 ? '•' : '%1.'}"/></w:lvl></w:abstractNum><w:num w:numId="${i}"><w:abstractNumId w:val="${i}"/></w:num>`).join('')}</w:numbering>`,
    'word/header1.xml': `<w:hdr xmlns:w="${wNS}"><w:p><w:r><w:t>${escapeXml(document.page.header)}</w:t></w:r></w:p></w:hdr>`,
    'word/footer1.xml': `<w:ftr xmlns:w="${wNS}"><w:p><w:r><w:t>${escapeXml(document.page.footer)}</w:t></w:r></w:p></w:ftr>`,
  };
  return { bytes: xmlZip(files), warnings };
}

export function columnName(index: number): string { let out = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out; return out; }
export function address(value: string): { row: number; col: number } { const m = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})$/i.exec(value); if (!m) fail('Invalid cell address'); const col = [...m[1].toUpperCase()].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1, row = Number(m[2]) - 1; if (row >= FORMAT_LIMITS.rows || col >= FORMAT_LIMITS.columns) fail('Sheet dimensions exceed limit'); return { row, col }; }
export function safeFormula(formula:string):boolean{return isOfficeFormulaSafe(formula);}
// Imported content must be identical across independent retry/worker executions.
// Storage creates a separate file ID per operation; these IDs identify workbook content only.
function importedWorkbookId(format: 'xlsx' | 'csv' | 'tsv', source: Uint8Array | string): string { return `import-${format}-${createHash('sha256').update(source).digest('hex')}`; }
function workbook(id: string, sheets: Record<string, any>, order: string[], name: string): SpreadsheetContent { return { schemaVersion: 1, kind: 'spreadsheet', workbook: { id, name, appVersion: '1.0.4', locale: 'enUS', styles: {}, sheetOrder: order, sheets } }; }
function sheet(id: string, name: string): any { return { id, name, rowCount: 1000, columnCount: 26, cellData: {}, rowData: {}, columnData: {}, mergeData: [], defaultRowHeight: 24, defaultColumnWidth: 100 }; }
export function importXlsx(input: Uint8Array): { content: SpreadsheetContent; warnings: string[] } {
  const zip = readSafeZip(input); if (!zip['xl/workbook.xml']) fail('File is not XLSX');
  const bookId = importedWorkbookId('xlsx', input);
  const warnings = ['XLSX subset: cells, ordinary formulas, basic styles, sizes, merges and freezes. Charts, pivots, validations and advanced workbook features are not preserved; the original is retained.'];
  const relations = new Map(descendants(xml(zip['xl/_rels/workbook.xml.rels']), 'Relationship').filter(r => r.attrs.TargetMode !== 'External').map(r => [r.attrs.Id, r.attrs.Target]));
  const shared = descendants(xml(zip['xl/sharedStrings.xml']), 'si').map(n => descendants(n.children, 't').map(t => textOf(t.children)).join(''));
  const styleXml = xml(zip['xl/styles.xml']); const xfs = child(nodes(styleXml)[0], 'cellXfs'); const styles = xfs ? nodes(xfs.children, 'xf') : [];
  const fonts = child(nodes(styleXml)[0], 'fonts'); const fontList = fonts ? nodes(fonts.children, 'font') : [];
  const fills = child(nodes(styleXml)[0], 'fills'); const fillList = fills ? nodes(fills.children, 'fill') : [];
  const formats = new Map(descendants(styleXml, 'numFmt').map(x => [Number(x.attrs.numFmtId), x.attrs.formatCode]));
  const basic: Record<number, string> = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 14: 'yyyy-mm-dd', 22: 'yyyy-mm-dd hh:mm' };
  const styleMap: Record<string, any> = {};
  styles.forEach((xf, i) => { const f = fontList[Number(xf.attrs.fontId) || 0], fill = fillList[Number(xf.attrs.fillId) || 0]; const color = child(f, 'color')?.attrs.rgb; const bg = child(child(fill, 'patternFill'), 'fgColor')?.attrs.rgb; styleMap[String(i)] = { ...(child(f, 'b') ? { bl: 1 } : {}), ...(child(f, 'i') ? { it: 1 } : {}), ...(child(f, 'u') ? { ul: { s: 1 } } : {}), ...(child(f, 'sz') ? { fs: Number(child(f, 'sz')!.attrs.val) } : {}), ...(child(f, 'name') ? { ff: child(f, 'name')!.attrs.val } : {}), ...(color ? { cl: { rgb: `#${color.slice(-6)}` } } : {}), ...(bg ? { bg: { rgb: `#${bg.slice(-6)}` } } : {}), n: { pattern: formats.get(Number(xf.attrs.numFmtId)) ?? basic[Number(xf.attrs.numFmtId)] ?? 'General' } }; });
  const sheets: Record<string, any> = {}, order: string[] = []; let cells = 0;
  const sourceSheets = descendants(xml(zip['xl/workbook.xml']), 'sheet'); if (!sourceSheets.length || sourceSheets.length > FORMAT_LIMITS.sheets) fail('Invalid sheet count');
  for (const source of sourceSheets) {
    const target = relations.get(source.attrs['r:id']); if (!target) fail('Missing worksheet relationship');
    const path = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join('xl', target)); if (!path.startsWith('xl/') || !zip[path]) fail('Invalid worksheet path');
    const id = `${bookId}-sheet-${order.length + 1}`, s = sheet(id, source.attrs.name); order.push(id); sheets[id] = s;
    const sheetXml = xml(zip[path]);
    for (const row of descendants(sheetXml, 'row')) { const ri = Number(row.attrs.r) - 1; if (row.attrs.ht && ri >= 0 && ri < FORMAT_LIMITS.rows) s.rowData[ri] = { h: Number(row.attrs.ht) * 4 / 3 }; }
    for (const col of descendants(sheetXml, 'col')) { const min = Number(col.attrs.min) - 1, max = Number(col.attrs.max) - 1; if (min < 0 || max >= FORMAT_LIMITS.columns || max - min > 4096) fail('Oversized column range'); for (let c = min; c <= max; c++) s.columnData[c] = { w: Math.max(10, Number(col.attrs.width) * 7 + 5) }; }
    for (const c of descendants(sheetXml, 'c')) {
      if (++cells > FORMAT_LIMITS.cells) fail('Too many populated cells'); const { row, col } = address(c.attrs.r); const type = c.attrs.t; const value = textOf(child(c, 'v')?.children ?? []); let v: any = value;
      if (type === 's') v = shared[Number(value)] ?? ''; else if (type === 'inlineStr') v = descendants(c.children, 't').map(t => textOf(t.children)).join(''); else if (type === 'b') v = value === '1'; else if (!type || type === 'n') v = value === '' ? null : Number(value); else if (type === 'e') v = value;
      const f = child(c, 'f'); const formula = f ? `=${textOf(f.children)}` : undefined;
      if (formula && (!safeFormula(formula) || f?.attrs.t === 'shared' || f?.attrs.t === 'array' || formula === '=')) { warnings.push(`Unsupported or unsafe formula at ${source.attrs.name}!${c.attrs.r}; cached result retained.`); }
      const cell: any = { v, t: typeof v === 'number' ? 2 : typeof v === 'boolean' ? 3 : 1, ...(c.attrs.s ? { s: c.attrs.s } : {}) };
      if (formula && formula !== '=' && safeFormula(formula) && !['shared', 'array', 'dataTable'].includes(f?.attrs.t ?? '')) cell.f = formula;
      (s.cellData[row] ??= {})[col] = cell; s.rowCount = Math.max(s.rowCount, row + 20); s.columnCount = Math.max(s.columnCount, col + 5);
    }
    s.rowCount = Math.min(FORMAT_LIMITS.rows, s.rowCount); s.columnCount = Math.min(FORMAT_LIMITS.columns, s.columnCount);
    for (const merge of descendants(sheetXml, 'mergeCell')) { const [a, b] = merge.attrs.ref.split(':').map(address); if (!a || !b) fail('Invalid merge'); s.mergeData.push({ startRow: a.row, startColumn: a.col, endRow: b.row, endColumn: b.col }); }
    const pane = descendants(sheetXml, 'pane')[0]; if (pane?.attrs.state === 'frozen') { const x = Number(pane.attrs.xSplit) || 0, y = Number(pane.attrs.ySplit) || 0; s.freeze = { startRow: y ? y : -1, startColumn: x ? x : -1, xSplit: x, ySplit: y }; }
  }
  const content = workbook(bookId, sheets, order, 'Imported workbook'); content.workbook.styles = styleMap; return { content, warnings: [...new Set(warnings)] };
}

export function exportXlsx(content: SpreadsheetContent): { bytes: Buffer; warnings: string[] } {
  const wb = content.workbook; const order: string[] = wb.sheetOrder; const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'; const warnings = ['XLSX export is partial: values, formulas, basic styles, merges, freezes and dimensions. Cached formula results are recalculated by the receiving spreadsheet.'];
  const styleList: any[] = [{}]; const styleIds = new Map<string, number>([['{}', 0]]);
  function styleId(s: any) { const style = typeof s === 'string' ? wb.styles?.[s] ?? {} : s ?? {}; const key = JSON.stringify(style); if (!styleIds.has(key)) { styleIds.set(key, styleList.length); styleList.push(style); } return styleIds.get(key)!; }
  const files: Record<string, string> = {}; const names = new Set<string>(); const exportNames:Record<string,string>={};
  order.forEach((id, i) => {
    const s = wb.sheets[id]; if (!s) fail('Missing sheet'); let name = String(s.name || `Sheet ${i + 1}`).replace(/[\\/?*\[\]:]/g, '_').slice(0, 31); if (names.has(name)) name = `${name.slice(0, 25)}_${i + 1}`; names.add(name); exportNames[id] = name;
    const rows = Object.keys(s.cellData ?? {}).sort((a, b) => Number(a) - Number(b)).map(r => `<row r="${Number(r) + 1}"${s.rowData?.[r]?.h ? ` ht="${Number(s.rowData[r].h) * .75}" customHeight="1"` : ''}>${Object.entries(s.cellData[r]).sort(([a], [b]) => Number(a) - Number(b)).map(([c, cell]: [string, any]) => { if (!cell) return ''; const ref = `${columnName(Number(c))}${Number(r) + 1}`; const f = cell.f; if (f && !safeFormula(f)) fail('Unsafe formula'); const v = cell.v; const sid = styleId(cell.s); if (f) return `<c r="${ref}" s="${sid}"><f>${escapeXml(f.replace(/^=/, ''))}</f>${typeof v === 'number' && Number.isFinite(v) ? `<v>${v}</v>` : ''}</c>`; if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${sid}"><v>${v}</v></c>`; if (typeof v === 'boolean') return `<c r="${ref}" s="${sid}" t="b"><v>${v ? 1 : 0}</v></c>`; const value = v ?? cell.p?.body?.dataStream?.replace(/\r?\n$/, '') ?? ''; return `<c r="${ref}" s="${sid}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`; }).join('')}</row>`).join('');
    const freeze = s.freeze; const pane = freeze && (freeze.xSplit || freeze.ySplit) ? `<pane xSplit="${freeze.xSplit || 0}" ySplit="${freeze.ySplit || 0}" topLeftCell="${columnName(freeze.xSplit || 0)}${(freeze.ySplit || 0) + 1}" state="frozen"/>` : '';
    const columns = Object.entries(s.columnData ?? {}).filter(([, v]: any) => v?.w).map(([c, v]: any) => `<col min="${Number(c) + 1}" max="${Number(c) + 1}" width="${Math.max(1, (Number(v.w) - 5) / 7)}" customWidth="1"/>`).join('');
    const merges = (s.mergeData ?? []).map((m: any) => `<mergeCell ref="${columnName(m.startColumn)}${m.startRow + 1}:${columnName(m.endColumn)}${m.endRow + 1}"/>`).join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>${columns ? `<cols>${columns}</cols>` : ''}<sheetData>${rows}</sheetData>${merges ? `<mergeCells count="${s.mergeData.length}">${merges}</mergeCells>` : ''}</worksheet>`;
  });
  files['[Content_Types].xml'] = `<Types xmlns="${contentNS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${order.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  files['_rels/.rels'] = `<Relationships xmlns="${relNS}"><Relationship Id="r1" Type="${rNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  files['xl/workbook.xml'] = `<workbook xmlns="${ns}" xmlns:r="${rNS}"><sheets>${order.map((id, i) => `<sheet name="${escapeXml(exportNames[id])}" sheetId="${i + 1}" r:id="r${i + 1}"/>`).join('')}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<Relationships xmlns="${relNS}">${order.map((_, i) => `<Relationship Id="r${i + 1}" Type="${rNS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="styles" Type="${rNS}/styles" Target="styles.xml"/></Relationships>`;
  files['xl/styles.xml'] = `<styleSheet xmlns="${ns}"><numFmts count="${styleList.length}">${styleList.map((s, i) => `<numFmt numFmtId="${164 + i}" formatCode="${escapeXml(s.n?.pattern || 'General')}"/>`).join('')}</numFmts><fonts count="${styleList.length}">${styleList.map(s => `<font><name val="${escapeXml(s.ff || 'Arial')}"/><sz val="${s.fs || 11}"/>${s.bl ? '<b/>' : ''}${s.it ? '<i/>' : ''}${s.ul?.s ? '<u/>' : ''}${s.cl?.rgb ? `<color rgb="FF${escapeXml(s.cl.rgb.replace('#', '').slice(-6))}"/>` : ''}</font>`).join('')}</fonts><fills count="${styleList.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${styleList.map(s => `<fill><patternFill patternType="${s.bg?.rgb ? 'solid' : 'none'}">${s.bg?.rgb ? `<fgColor rgb="FF${escapeXml(s.bg.rgb.replace('#', '').slice(-6))}"/><bgColor indexed="64"/>` : ''}</patternFill></fill>`).join('')}</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styleList.length}">${styleList.map((s, i) => `<xf numFmtId="${164 + i}" fontId="${i}" fillId="${i + 2}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return { bytes: xmlZip(files), warnings };
}

export function importCsv(value: string, delimiter?: '\t'): SpreadsheetContent {
  if (Buffer.byteLength(value) > FORMAT_LIMITS.inputBytes || value.includes('\0')) fail('Invalid CSV');
  const first = value.split(/\r?\n/)[0]; const separator = delimiter ?? ((first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',');
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false, cells = 0;
  for (let i = 0; i <= value.length; i++) { const c = value[i]; if (quoted) { if (c === '"') { if (value[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else if (c === undefined) fail('Unclosed CSV quote'); else field += c; continue; }
    if (c === '"' && field === '' && !closed) { quoted = true; continue; }
    if (c === separator || c === '\n' || c === '\r' || c === undefined) { row.push(field); if (++cells > FORMAT_LIMITS.cells || row.length > FORMAT_LIMITS.columns) fail('CSV limit exceeded'); field = ''; closed = false; if (c !== separator) { if (c === '\r' && value[i + 1] === '\n') i++; rows.push(row); row = []; } } else { if (closed) fail('Invalid CSV quoting'); field += c; }
  }
  const label = delimiter ? 'TSV' : 'CSV';
  const bookId = importedWorkbookId(delimiter ? 'tsv' : 'csv', value), id = `${bookId}-sheet-1`, s = sheet(id, label); rows.forEach((r, ri) => { if (ri >= FORMAT_LIMITS.rows) fail('Too many CSV rows'); r.forEach((v, ci) => { (s.cellData[ri] ??= {})[ci] = { v, t: 1 }; }); }); s.rowCount = Math.min(FORMAT_LIMITS.rows, Math.max(1000, rows.length + 10)); s.columnCount = Math.max(26, ...rows.map(r => r.length)); return workbook(bookId, { [id]: s }, [id], label);
}
export function exportCsv(content: SpreadsheetContent, delimiter = ','): string {
  const s = content.workbook.sheets[content.workbook.sheetOrder[0]]; const rows = Object.keys(s.cellData ?? {}).map(Number); const maxRow = Math.max(0, ...rows); const maxCol = Math.max(0, ...rows.flatMap(r => Object.keys(s.cellData[r]).map(Number))); if ((maxRow + 1) * (maxCol + 1) > FORMAT_LIMITS.cells) fail('CSV export area too large');
  return Array.from({ length: maxRow + 1 }, (_, r) => Array.from({ length: maxCol + 1 }, (_, c) => { const cell = s.cellData?.[r]?.[c]; let v = String(cell?.v ?? ''); if (/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(v)) v = `'${v}`; return `"${v.replace(/"/g, '""')}"`; }).join(delimiter)).join('\r\n');
}
export async function importOfficeFile(name: string, bytes: Uint8Array): Promise<{ content: OfficeContent; warnings: string[]; original: { name: string; mime: string; size: number; sha256: string } }> {
  if (bytes.length > FORMAT_LIMITS.inputBytes) fail('File exceeds 12 MiB'); const ext = name.split('.').at(-1)?.toLowerCase(); let result: { content: OfficeContent; warnings: string[] };
  if (ext === 'docx') result = importDocx(bytes);
  else if (ext === 'odt') result = importOdt(readSafeZip(bytes, 'odf'));
  else if (ext === 'doc') result = importDoc(bytes);
  else if (ext === 'xlsx') result = importXlsx(bytes);
  else if (ext === 'ods' || ext === 'xls') result = importAlternativeSpreadsheet(bytes, ext);
  else if (['txt', 'html', 'htm', 'csv', 'tsv'].includes(ext ?? '')) { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (text.includes('\0')) fail('Binary content in text file'); result = ext === 'csv' || ext === 'tsv' ? { content: importCsv(text, ext === 'tsv' ? '\t' : undefined), warnings: [`${ext.toUpperCase()} values are imported as text; formulas are not executed.`] } : ext === 'html' || ext === 'htm' ? { content: htmlToDocument(text), warnings: ['HTML is sanitized; scripts, external images, embedded objects and unsupported formatting are removed.'] } : { content: doc(text.split(/\r?\n/).map(t => ({ type: 'paragraph', content: txt(t) }))), warnings: [] }; } else fail('Supported imports: DOCX, ODT, DOC, XLSX, ODS, XLS, CSV, TSV, TXT, HTML');
  return { ...result, original: { name: name.slice(0, 200), mime: MIME[ext!], size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
}
export const MIME: Record<string, string> = { odt: ODT_MIME, doc: 'application/msword', ods: ODS_MIME, xls: 'application/vnd.ms-excel', tsv: 'text/tab-separated-values;charset=utf-8', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain;charset=utf-8', html: 'text/html;charset=utf-8', htm: 'text/html;charset=utf-8', csv: 'text/csv;charset=utf-8' };
export function exportOfficeFile(content: OfficeContent, title: string, format: string): { name: string; mime: string; base64: string; warnings: string[] } {
  if(format==='print'&&content.kind==='document')return{name:title,mime:'text/plain',base64:'',warnings:[]};
  let bytes: Uint8Array, warnings: string[] = [];
  if (content.kind === 'document') { if (format === 'pdf') ({ bytes, warnings } = exportPdf(content)); else if (format === 'docx') ({ bytes, warnings } = exportDocx(content)); else if (format === 'odt') ({ bytes, warnings } = exportOdt(content)); else if (format === 'txt') bytes = Buffer.from(documentToText(content)); else if (format === 'html') bytes = Buffer.from(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escapeXml(title)}</title><style>body{font-family:Arial;max-width:170mm;margin:20mm auto}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:5px}@page{size:A4;margin:${Math.max(5, Math.min(50, content.page.marginMm))}mm}</style><header>${escapeXml(content.page.header)}</header>${documentToHtml(content)}<footer>${escapeXml(content.page.footer)}</footer>`); else fail('Unsupported document export'); }
  else { if (format === 'xlsx') ({ bytes, warnings } = exportXlsx(structuredClone(content))); else if (format === 'ods' || format === 'xls') ({ bytes, warnings } = exportAlternativeSpreadsheet(content, format)); else if (format === 'csv' || format === 'tsv') { bytes = Buffer.from('\uFEFF' + exportCsv(content, format === 'tsv' ? '\t' : ',')); warnings = [`${format.toUpperCase()} exports values from the first sheet only. Potential spreadsheet formulas are prefixed with an apostrophe.`]; } else fail('Unsupported spreadsheet export'); }
  return { name: `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.(docx|odt|doc|xlsx|ods|xls|csv|tsv|txt|html|pdf)$/i,'').slice(0, 120)}.${format}`, mime: MIME[format], base64: Buffer.from(bytes).toString('base64'), warnings };
}
