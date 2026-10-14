import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { XMLParser } from 'fast-xml-parser';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { FORMAT_LIMITS, readSafeZip } from './container-safety.ts';
import { readCompoundFile } from './compound-file.ts';
import { isOfficeFormulaSafe } from '../core/formula-policy.ts';
import type { SpreadsheetContent } from '../core/types.ts';
import { officeFormulaToOdf, odfFormulaToOffice } from './odf-formulas.ts';

export const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet';
const fail = (message: string): never => { throw new Error(`OFFICE_FORMAT: ${message}`); };
const warning = 'Partial conversion: values, supported formulas, number formats, sheets and merges. Fonts, colors, drawings, charts, pivots, validations and print layout may differ. The uploaded original is retained.';
function index(value: unknown, max: number) { const n = Number(value); if (!Number.isInteger(n) || n < 0 || n >= max) fail('Sheet dimensions exceed limit'); return n; }
function range(value: string) {
  if (!/^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}(?::\$?[A-Z]{1,3}\$?[1-9]\d{0,6})?$/.test(value)) fail('Invalid spreadsheet range');
  const r = XLSX.utils.decode_range(value);
  for (const p of [r.s, r.e]) { index(p.r, FORMAT_LIMITS.rows); index(p.c, FORMAT_LIMITS.columns); }
  if (r.s.r > r.e.r || r.s.c > r.e.c) fail('Invalid spreadsheet range');
  return r;
}

/** Bound compact repeated ODF cells before the third-party codec expands them. */
function inspectOds(bytes: Uint8Array) {
  const files = readSafeZip(bytes, 'odf');
  if (files.mimetype.toString('utf8') !== ODS_MIME) fail('File is not ODS');
  const tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, processEntities: true, htmlEntities: true }).parse(files['content.xml'].toString('utf8'));
  const formulas = new Map<string, string>();
  let cells = 0, sheets = 0;
  const repeat = (value: unknown, max: number) => { const n = value === undefined ? 1 : Number(value); if (!Number.isSafeInteger(n) || n < 1 || n > max) fail('OpenDocument repetition limit exceeded'); return n; };
  function rows(nodes: any[], rowOffset: { value: number }) {
    for (const node of nodes) for (const [name, children] of Object.entries(node)) {
      if (name === ':@' || !Array.isArray(children)) continue;
      if (name === 'table-row') {
        const repeats = repeat(node[':@']?.['number-rows-repeated'], FORMAT_LIMITS.rows);
        const row = rowOffset.value; rowOffset.value += repeats; if (rowOffset.value > FORMAT_LIMITS.rows) fail('ODS row limit exceeded');
        let columns = 0;
        for (const cell of children) for (const key of ['table-cell', 'covered-table-cell']) if (Object.hasOwn(cell, key)) {
          const copies = repeat(cell[':@']?.['number-columns-repeated'], FORMAT_LIMITS.columns);
          const formula = cell[':@']?.formula;
          if (formula !== undefined) {
            if (key === 'covered-table-cell') fail('ODS cannot import a formula hidden in a merged cell');
            if (repeats > 1 || copies > 1) fail('Repeated formula cells are unsupported; expand them before importing');
            formulas.set(`${sheets - 1}:${row}:${columns}`, odfFormulaToOffice(String(formula)));
          }
          columns += copies;
          if (columns > FORMAT_LIMITS.columns || (cells += copies * repeats) > FORMAT_LIMITS.cells) fail('ODS expanded cell limit exceeded');
          repeat(cell[':@']?.['number-columns-spanned'], FORMAT_LIMITS.columns);
          repeat(cell[':@']?.['number-rows-spanned'], FORMAT_LIMITS.rows);
        }
      } else if (name === 'table-column') repeat(node[':@']?.['number-columns-repeated'], FORMAT_LIMITS.columns);
      else if (name === 'table') fail('Nested spreadsheets are unsupported');
      else rows(children, rowOffset);
    }
  }
  function visit(nodes: any[]) { for (const node of nodes) for (const [name, children] of Object.entries(node)) if (Array.isArray(children)) {
    if (name === 'table') { if (++sheets > FORMAT_LIMITS.sheets) fail('Too many sheets'); rows(children, { value: 0 }); }
    else visit(children);
  } }
  visit(tree); if (!sheets) fail('ODS contains no sheets');
  return formulas;
}

/** Only bounded, unencrypted BIFF8 workbooks; never execute macro or link records. */
function inspectXls(bytes: Uint8Array) {
  const streams = readCompoundFile(bytes);
  const book = streams.Workbook ?? streams.Book;
  if (!book || book.length < 8 || book.readUInt16LE(0) !== 0x0809 || book.readUInt16LE(4) !== 0x0600) fail('Only Excel 97–2003 BIFF8 XLS is supported');
  let p = 0, records = 0;
  while (p + 4 <= book.length) {
    const type = book.readUInt16LE(p), length = book.readUInt16LE(p + 2); p += 4;
    if (p + length > book.length || ++records > 500000) fail('Malformed XLS records');
    if (type === 0 && length === 0) { if (book.subarray(p).some(n => n !== 0)) fail('Invalid XLS padding'); break; }
    if (type === 0x002f || type === 0x00d3 || type === 0x0023) fail('Encrypted, macro or external-name XLS is not accepted');
    if (type === 0x0809 && (length < 4 || ![0x0005, 0x0010, 0x0020].includes(book.readUInt16LE(p + 2)))) fail('Macro sheets are not accepted');
    if (type === 0x0085 && (length < 6 || ![0, 2].includes(book[p + 5]))) fail('Macro sheets are not accepted');
    if (type === 0x01ae && (length < 4 || book.readUInt16LE(p + 2) !== 0x0401)) fail('External workbooks and add-ins are not accepted');
    p += length;
  }
  if (p < book.length && book.subarray(p).some(n => n !== 0)) fail('Truncated XLS records');
}

export function importAlternativeSpreadsheet(bytes: Uint8Array, format: 'ods' | 'xls'): { content: SpreadsheetContent; warnings: string[] } {
  if (bytes.length > FORMAT_LIMITS.inputBytes) fail('File exceeds 12 MiB');
  const formulas = format === 'ods' ? inspectOds(bytes) : (inspectXls(bytes), null);
  const parsed = XLSX.read(Buffer.from(bytes), { type: 'buffer', cellFormula: true, cellHTML: false, cellNF: true, cellText: false, cellDates: false, bookVBA: true, sheetRows: FORMAT_LIMITS.rows + 1, WTF: true });
  if (parsed.vbaraw || !parsed.SheetNames.length || parsed.SheetNames.length > FORMAT_LIMITS.sheets) fail('Invalid workbook or macros');
  const id = `import-${format}-${createHash('sha256').update(bytes).digest('hex')}`, sheets: Record<string, any> = {}, order: string[] = [];
  const warnings = new Set([`${format.toUpperCase()} ${warning}`]); let count = 0;
  for (const [i, name] of parsed.SheetNames.entries()) {
    const input = parsed.Sheets[name]; if (!input || String(input['!type']) === 'macro') fail('Invalid sheet');
    const bounds = range(input['!fullref'] ?? input['!ref'] ?? 'A1');
    const sid = `${id}-sheet-${i + 1}`;
    const s: any = { id: sid, name: String(name).slice(0, 100), rowCount: Math.min(FORMAT_LIMITS.rows, Math.max(1000, bounds.e.r + 1)), columnCount: Math.max(26, bounds.e.c + 1), cellData: {}, rowData: {}, columnData: {}, mergeData: [], defaultRowHeight: 24, defaultColumnWidth: 100 };
    for (const [address, cell] of Object.entries(input)) {
      if (address.startsWith('!') || !cell || typeof cell !== 'object') continue;
      if (++count > FORMAT_LIMITS.cells) fail('Cell limit exceeded');
      const location = range(address).s; let v: string | number | boolean = cell.v ?? '';
      if (cell.t === 'e') { v = `#ERROR(${String(v)})`; warnings.add('Spreadsheet error values are imported as text.'); }
      if (!['string', 'number', 'boolean'].includes(typeof v) || typeof v === 'number' && !Number.isFinite(v) || String(v).length > 100000) fail('Unsupported cell value');
      const out: any = { v, t: typeof v === 'number' ? 2 : typeof v === 'boolean' ? 3 : 1 };
      const formula = formulas ? formulas.get(`${i}:${location.r}:${location.c}`) : cell.f ? '=' + cell.f.replace(/^=/, '') : null;
      if (formula) { if (!isOfficeFormulaSafe(formula)) fail('External or active spreadsheet formula is not accepted'); out.f = formula; }
      if (cell.z && typeof cell.z === 'string' && cell.z.length <= 500) out.s = { n: { pattern: cell.z } };
      if (cell.l || cell.c || cell.F) warnings.add('Hyperlinks, comments and array-formula metadata are omitted.');
      (s.cellData[location.r] ??= {})[location.c] = out;
    }
    if ((input['!merges']?.length ?? 0) > 10000) fail('Too many merged ranges');
    for (const m of input['!merges'] ?? []) { range(XLSX.utils.encode_range(m)); s.mergeData.push({ startRow: m.s.r, endRow: m.e.r, startColumn: m.s.c, endColumn: m.e.c }); }
    // SheetJS drops ODF formula cells with no cached value. The independently
    // inspected formula map is authoritative and must never disappear silently.
    if (formulas) for (const [position, formula] of formulas) {
      const [sheetIndex, row, column] = position.split(':').map(Number);
      if (sheetIndex !== i) continue;
      index(row, FORMAT_LIMITS.rows); index(column, FORMAT_LIMITS.columns);
      if (s.mergeData.some((m: any) => row >= m.startRow && row <= m.endRow && column >= m.startColumn && column <= m.endColumn && (row !== m.startRow || column !== m.startColumn))) fail('ODS cannot import a formula hidden in a merged cell');
      if (!isOfficeFormulaSafe(formula)) fail('External or active spreadsheet formula is not accepted');
      const cells = s.cellData[row] ??= {};
      if (!Object.hasOwn(cells, column)) {
        if (++count > FORMAT_LIMITS.cells) fail('Cell limit exceeded');
        cells[column] = { v: '', t: 1, f: formula };
        warnings.add('Formula cells without a stored result are preserved and must be recalculated in Office.');
      } else cells[column].f = formula;
      s.rowCount = Math.max(s.rowCount, row + 1); s.columnCount = Math.max(s.columnCount, column + 1);
      formulas.delete(position);
    }
    order.push(sid); sheets[sid] = s;
  }
  if (formulas?.size) fail('ODS formula sheet mapping could not be preserved');
  return { content: { schemaVersion: 1, kind: 'spreadsheet', workbook: { id, name: format.toUpperCase(), appVersion: '1.0.4', locale: 'enUS', styles: {}, sheetOrder: order, sheets } }, warnings: [...warnings] };
}

export function exportAlternativeSpreadsheet(content: SpreadsheetContent, format: 'ods' | 'xls'): { bytes: Buffer; warnings: string[] } {
  const input = content.workbook, book = XLSX.utils.book_new(), names = new Set<string>(), formulaOrder: string[] = []; let count = 0;
  const warnings = new Set([`${format.toUpperCase()} ${warning.replace('The uploaded original is retained.', 'Keep the editable Office document for full fidelity.')}`]);
  if (format === 'xls') warnings.add('XLS export contains cached values only; formulas are not exported. Use XLSX or ODS to preserve formulas. Recalculate and save the Office workbook before exporting values.');
  if (!input.sheetOrder.length || input.sheetOrder.length > FORMAT_LIMITS.sheets) fail('Invalid sheet count');
  for (const id of input.sheetOrder) {
    const source = input.sheets[id]; if (!source) fail('Missing sheet');
    const name = String(source.name || 'Sheet');
    if (!name || name.length > 31 || /[\\/?*\[\]:]/.test(name) || names.has(name.toLowerCase())) fail('Export requires unique sheet names up to 31 characters without []:*?/\\');
    names.add(name.toLowerCase());
    const target: XLSX.WorkSheet = {}; let maxRow = 0, maxCol = 0;
    for (const [r, row] of Object.entries(source.cellData ?? {})) for (const [c, raw] of Object.entries(row as any)) {
      const cell: any = raw; if (!cell) continue;
      const ri = index(r, format === 'xls' ? 65536 : FORMAT_LIMITS.rows), ci = index(c, format === 'xls' ? 256 : FORMAT_LIMITS.columns);
      if (++count > FORMAT_LIMITS.cells) fail('Cell limit exceeded'); maxRow = Math.max(maxRow, ri); maxCol = Math.max(maxCol, ci);
      const v = cell.v ?? ''; if (!['string', 'number', 'boolean'].includes(typeof v) || typeof v === 'number' && !Number.isFinite(v)) fail('Invalid cell value');
      const out: XLSX.CellObject = { t: typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 's', v };
      if (cell.f) { if (!isOfficeFormulaSafe(cell.f)) fail('Unsafe formula'); if (format === 'ods') { out.f = cell.f.replace(/^=/, ''); formulaOrder.push(officeFormulaToOdf(cell.f)); } }
      const style = typeof cell.s === 'string' ? input.styles?.[cell.s] : cell.s;
      if (typeof style?.n?.pattern === 'string') out.z = style.n.pattern;
      target[XLSX.utils.encode_cell({ r: ri, c: ci })] = out;
    }
    target['!merges'] = (source.mergeData ?? []).map((m: any) => {
      const s = { r: index(m.startRow, format === 'xls' ? 65536 : FORMAT_LIMITS.rows), c: index(m.startColumn, format === 'xls' ? 256 : FORMAT_LIMITS.columns) }, e = { r: index(m.endRow, format === 'xls' ? 65536 : FORMAT_LIMITS.rows), c: index(m.endColumn, format === 'xls' ? 256 : FORMAT_LIMITS.columns) };
      if (s.r > e.r || s.c > e.c) fail('Invalid merge'); maxRow = Math.max(maxRow, e.r); maxCol = Math.max(maxCol, e.c);
      target[XLSX.utils.encode_cell(s)] ??= { t: 's', v: '' }; return { s, e };
    });
    target['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
    XLSX.utils.book_append_sheet(book, target, name);
  }
  // Both codecs walk rectangular areas, so a sparse far-away cell must not create an output bomb.
  const area = book.SheetNames.reduce((sum, name) => { const r = range(book.Sheets[name]['!ref']!); return sum + (r.e.r + 1) * (r.e.c + 1); }, 0);
  if (area > FORMAT_LIMITS.cells) fail('Export area exceeds 100000 cells');
  let bytes = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: format === 'xls' ? 'biff8' : 'ods', compression: true, cellStyles: false }));
  if (format === 'ods') {
    // ODF Part 2 §3.3: place mimetype first, stored without an extra field.
    const files = unzipSync(bytes); delete files.mimetype;
    let formulaIndex = 0;
    const xmlEscape = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
    files['content.xml'] = strToU8(new TextDecoder().decode(files['content.xml']).replace(/table:formula="[^"]*"/g, () => {
      const formula = formulaOrder[formulaIndex++]; if (!formula) fail('ODS formula serialization mismatch'); return `table:formula="${xmlEscape(formula)}"`;
    }));
    if (formulaIndex !== formulaOrder.length) fail('ODS cannot export a formula hidden in a merged cell');
    bytes = Buffer.from(zipSync({ mimetype: [strToU8(ODS_MIME), { level: 0 }], ...files }, { level: 6 }));
  }
  if (bytes.length > FORMAT_LIMITS.inputBytes) fail('Export exceeds 12 MiB');
  return { bytes, warnings: [...warnings] };
}
