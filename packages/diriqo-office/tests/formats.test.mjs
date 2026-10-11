import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { exportDocx, importDocx, exportXlsx, importXlsx, importCsv, exportCsv, importOfficeFile, exportOfficeFile, readSafeZip, htmlToDocument, documentToHtml, documentToText, safeFormula } from '../src/server/formats.ts';

const text = t => ({ type: 'text', text: t });
const document = { schemaVersion: 1, kind: 'document', page: { marginMm: 20, header: 'Diriqo – ukázková firma', footer: 'Předběžná nabídka' }, doc: { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2 }, content: [text('Nabídka žluťoučký kůň')] },
  { type: 'paragraph', content: [{ ...text('Tučně & bezpečně'), marks: [{ type: 'bold' }] }] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('První položka')] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [text('Druhá položka')] }] }] },
  { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [text('Cena')] }] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [text('1 200 Kč')] }] }] }] },
] } };
const spreadsheet = { schemaVersion: 1, kind: 'spreadsheet', workbook: { id: 'book', name: 'Kalkulace', sheetOrder: ['s1', 's2'], styles: { price: { bl: 1, cl: { rgb: '#123456' }, bg: { rgb: '#F0F0F0' }, n: { pattern: '#,##0.00 "Kč"' } } }, sheets: {
  s1: { id: 's1', name: 'Kalkulace', rowCount: 1000, columnCount: 26, cellData: { 0: { 0: { v: 10, t: 2, s: 'price' }, 1: { v: 5, t: 2 }, 2: { f: '=SUM(A1:B1)', v: 15 } }, 1: { 0: { v: '=HYPERLINK("https://example.test")', t: 1 }, 1: { v: '00123', t: 1 } } }, rowData: { 0: { h: 40 } }, columnData: { 0: { w: 200 } }, freeze: { xSplit: 1, ySplit: 1 }, mergeData: [{ startRow: 3, endRow: 3, startColumn: 0, endColumn: 1 }] },
  s2: { id: 's2', name: 'Přehled', rowCount: 1000, columnCount: 26, cellData: { 0: { 0: { f: "='Kalkulace'!$C$1*2", v: 30 } } } },
} } };

test('DOCX roundtrip preserves headings, inline styles, lists, tables, text and simple letterhead', () => {
  const before = JSON.stringify(document); const exported = exportDocx(document); const imported = importDocx(exported.bytes);
  assert.equal(JSON.stringify(document), before); assert.ok(imported.warnings.length);
  assert.equal(imported.content.doc.content[0].type, 'heading'); assert.equal(imported.content.doc.content[0].attrs.level, 2);
  assert.equal(imported.content.doc.content[1].content[0].marks[0].type, 'bold');
  assert.equal(imported.content.doc.content[2].type, 'bulletList'); assert.equal(imported.content.doc.content[2].content.length, 2);
  assert.equal(imported.content.doc.content[3].type, 'table'); assert.match(documentToText(imported.content), /1 200 Kč/);
  assert.equal(imported.content.page.header, document.page.header); assert.equal(imported.content.page.footer, document.page.footer);
});
test('XLSX roundtrip preserves multiple sheets, formulas, text values, basic formatting and merges', () => {
  const result = importXlsx(exportXlsx(structuredClone(spreadsheet)).bytes); const wb = result.content.workbook;
  assert.equal(wb.sheetOrder.length, 2); const first = wb.sheets[wb.sheetOrder[0]], second = wb.sheets[wb.sheetOrder[1]];
  assert.equal(first.cellData[0][2].f, '=SUM(A1:B1)'); assert.equal(second.cellData[0][0].f, "='Kalkulace'!$C$1*2");
  assert.equal(first.cellData[1][0].v, '=HYPERLINK("https://example.test")'); assert.equal(first.cellData[1][0].f, undefined);
  assert.equal(first.cellData[1][1].v, '00123'); assert.equal(first.mergeData.length, 1); assert.equal(first.freeze.xSplit, 1);
  assert.equal(wb.styles[first.cellData[0][0].s].n.pattern, '#,##0.00 "Kč"'); assert.equal(wb.styles[first.cellData[0][0].s].bl, 1);
});
test('XLSX 20,000 populated cells roundtrip stays within limits', () => {
  const content = structuredClone(spreadsheet); content.workbook.sheetOrder = ['s1']; content.workbook.sheets.s1.cellData = {};
  for (let r = 0; r < 2000; r++) content.workbook.sheets.s1.cellData[r] = Object.fromEntries(Array.from({ length: 10 }, (_, c) => [c, { v: r * 10 + c, t: 2 }]));
  const wb = importXlsx(exportXlsx(content).bytes).content.workbook; assert.equal(wb.sheets[wb.sheetOrder[0]].cellData[1999][9].v, 19999);
});
test('HTML import sanitizes XSS, external image and active content', () => {
  const content = htmlToDocument('<h1>Ahoj</h1><script>alert(1)</script><img src="http://127.0.0.1/private"><p onclick="alert(1)"><a href="javascript:alert(1)">unsafe</a><a href="https://example.test">safe</a></p><iframe src="https://bad.test"></iframe>');
  const html = documentToHtml(content); assert.match(html, /<h1(?: style="text-align:left")?>Ahoj<\/h1>/); assert.doesNotMatch(html, /javascript:|onclick|<script|<img|<iframe|alert\(1\)/); assert.match(html, /https:\/\/example.test/);
});
test('CSV retains leading zero and quotes, imports formulas as text, exports injection safely', () => {
  const imported = importCsv('Code;Value\r\n00123;"a;b"\r\n"=1+1";"line\ntext"'); const s = imported.workbook.sheets[imported.workbook.sheetOrder[0]];
  assert.equal(s.cellData[1][0].v, '00123'); assert.equal(s.cellData[1][1].v, 'a;b'); assert.equal(s.cellData[2][0].f, undefined);
  assert.match(exportCsv(imported), /"'=1\+1"/); assert.throws(() => importCsv('"broken'), /Unclosed/);
});
test('ZIP rejects macros, expansion bomb and corrupted CRC before parsing', () => {
  const base = { '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<x/>') };
  assert.throws(() => readSafeZip(zipSync({ ...base, 'word/vbaProject.bin': new Uint8Array([1]) })), /Macros/);
  assert.throws(() => readSafeZip(zipSync({ ...base, 'big.xml': new Uint8Array(1024 * 1024).fill(65) })), /oversized|expansion/);
  const broken = Buffer.from(zipSync(base, { level: 0 })); broken[broken.indexOf(Buffer.from('<Types/>'))] ^= 1;
  assert.throws(() => readSafeZip(broken), /integrity/);
});
test('ZIP traversal, XXE and false file extension are rejected', async () => {
  assert.throws(() => readSafeZip(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), '../danger': strToU8('x') })), /Unsafe/);
  assert.throws(() => readSafeZip(zipSync({ '[Content_Types].xml': strToU8('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><Types/>') })), /Active XML/);
  await assert.rejects(() => importOfficeFile('fake.docx', Buffer.from('plain text')), /Invalid ZIP/);
  await assert.rejects(() => importOfficeFile('payload.exe', Buffer.from('MZ')), /Supported imports/);
});
test('Unsafe formulas are rejected; ordinary cross-sheet and absolute references are allowed', () => {
  for (const value of ['=WEBSERVICE("http://127.0.0.1")', "='[other.xlsx]S1'!A1", '=cmd|x!A1', '=IMPORTXML("http://x")']) assert.equal(safeFormula(value), false);
  for (const value of ['=SUM(A1:A10)', '=IF(A1>1,ROUND($B$2,2),0)', "='Přehled'!A1"]) assert.equal(safeFormula(value), true);
});
test('Original hash is retained and PDF is a downloadable self-contained document', async () => {
  const bytes = exportDocx(document).bytes; const imported = await importOfficeFile('sample.docx', bytes);
  assert.equal(imported.original.size, bytes.length); assert.match(imported.original.sha256, /^[a-f0-9]{64}$/);
  assert.match(Buffer.from(exportOfficeFile(imported.content, 'Text', 'html').base64, 'base64').toString(), /Content-Security-Policy/);
  const pdf = exportOfficeFile(imported.content, 'Text', 'pdf');
  assert.equal(pdf.mime, 'application/pdf'); assert.equal(pdf.name, 'Text.pdf');
  assert.equal(Buffer.from(pdf.base64, 'base64').subarray(0, 8).toString(), '%PDF-1.4');
});
