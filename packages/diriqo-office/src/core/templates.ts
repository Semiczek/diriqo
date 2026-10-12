import type { DocumentContent, OfficeContent, SpreadsheetContent } from './types.ts';
export type TemplateId = 'quote' | 'workReport' | 'handover' | 'estimate' | 'attendance' | 'letter';
export type TemplateVariables = { companyName: string; customerName: string; jobName: string; date: string; price: number; currency: string };
export const TEMPLATE_VARIABLES = Object.freeze({ companyName: 'string', customerName: 'string', jobName: 'string', date: 'date', price: 'number', currency: 'currency' } as const);
export const OFFICE_TEMPLATES: readonly { id: TemplateId; kind: 'document' | 'spreadsheet'; title: string }[] = [
  { id: 'quote', kind: 'document', title: 'Cenová nabídka' }, { id: 'workReport', kind: 'document', title: 'Výkaz provedených prací' }, { id: 'handover', kind: 'document', title: 'Předávací protokol' }, { id: 'estimate', kind: 'spreadsheet', title: 'Kalkulace zakázky' }, { id: 'attendance', kind: 'spreadsheet', title: 'Docházková tabulka' }, { id: 'letter', kind: 'document', title: 'Jednoduchý dopis' },
];
const text = (value: string) => ({ type: 'text', text: value });
const paragraph = (value = '') => ({ type: 'paragraph', content: value ? [text(value)] : [] });
const heading = (value: string, level = 1) => ({ type: 'heading', attrs: { level }, content: [text(value)] });
function table(rows: string[][]) { return { type: 'table', content: rows.map((row, i) => ({ type: 'tableRow', content: row.map(value => ({ type: i === 0 ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [paragraph(value)] })) })) }; }
export function blankDocument(): DocumentContent { return { schemaVersion: 1, kind: 'document', doc: { type: 'doc', content: [paragraph()] }, page: { marginMm: 20, header: '', footer: '' } }; }
export function blankSpreadsheet(): SpreadsheetContent { return { schemaVersion: 1, kind: 'spreadsheet', workbook: { id: crypto.randomUUID(), name: 'Sešit', locale: 'enUS', appVersion: '1.0.4', sheetOrder: ['sheet-1'], styles: {}, sheets: { 'sheet-1': { id: 'sheet-1', name: 'List 1', rowCount: 200, columnCount: 26, cellData: {}, rowData: {}, columnData: {}, mergeData: [] } } } }; }
export function validateTemplateVariables(input: Partial<TemplateVariables>): TemplateVariables {
  const clean = (value: unknown) => { if (value === undefined) return ''; if (typeof value !== 'string' || value.length > 500) throw new Error('Invalid template text'); return value; };
  const date = clean(input.date) || new Date().toISOString().slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid template date');
  const price = input.price ?? 0; if (typeof price !== 'number' || !Number.isFinite(price) || Math.abs(price) > 1e12) throw new Error('Invalid template price'); const currency = clean(input.currency) || 'CZK'; if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency');
  return { companyName: clean(input.companyName), customerName: clean(input.customerName), jobName: clean(input.jobName), date, price, currency };
}
export function createTemplate(id: TemplateId, input: Partial<TemplateVariables> = {}): OfficeContent {
  if (!OFFICE_TEMPLATES.some(item => item.id === id)) throw new Error('Unknown template'); const v = validateTemplateVariables(input); const title = OFFICE_TEMPLATES.find(item => item.id === id)!.title;
  if (id === 'estimate' || id === 'attendance') {
    const result = blankSpreadsheet(); const sheet = result.workbook.sheets['sheet-1']; sheet.name = title;
    const rows: (string | number)[][] = id === 'estimate' ? [[title, v.jobName], ['Firma', v.companyName], ['Datum', v.date], ['Měna', v.currency], [], ['Položka', 'Množství', 'Cena za jednotku', 'Celkem'], ['Práce', 0, 0], ['Materiál', 0, 0], ['Doprava', 0, 0], ['Celkem']] : [[title, v.companyName], ['Zakázka', v.jobName], ['Datum', v.date], [], ['Jméno', 'Datum', 'Příchod', 'Odchod', 'Přestávka (h)', 'Hodiny'], ['', v.date, '08:00', '16:00', 0.5]];
    rows.forEach((row, r) => row.forEach((value, c) => { (sheet.cellData[r] ??= {})[c] = { v: value, t: typeof value === 'number' ? 2 : 1, ...(r === 0 || r === (id === 'estimate' ? 5 : 4) ? { s: { bl: 1, bg: { rgb: '#E9EFF9' } } } : {}) }; }));
    if (id === 'estimate') { for (let r = 6; r <= 8; r++) sheet.cellData[r][3] = { f: `=B${r + 1}*C${r + 1}` }; sheet.cellData[9][3] = { f: '=SUM(D7:D9)' }; } else sheet.cellData[5][5] = { f: '=(TIMEVALUE(D6)-TIMEVALUE(C6))*24-E6' };
    sheet.columnData = { 0: { w: 240 }, 1: { w: 170 }, 2: { w: 160 }, 3: { w: 160 }, 4: { w: 150 }, 5: { w: 130 } }; return result;
  }
  const result = blankDocument(); result.page.header = v.companyName; const meta = [paragraph(`Datum: ${v.date}`), paragraph(`Zákazník: ${v.customerName}`), paragraph(`Zakázka: ${v.jobName}`)];
  const body = id === 'quote' ? [paragraph('Předběžná cenová nabídka'), ...meta, table([['Popis plnění', 'Množství', 'Cena'], ['Doplňte rozsah prací', '', `${v.price.toLocaleString('cs-CZ')} ${v.currency}`]]), paragraph('Podmínky a platnost nabídky: doplňte.'), paragraph('Tato nabídka je pracovní návrh určený ke kontrole.')] : id === 'workReport' ? [...meta, table([['Datum', 'Popis provedené práce', 'Hodiny', 'Poznámka'], [v.date, '', '', '']]), paragraph('Vypracoval:'), paragraph('Schválil:')] : id === 'handover' ? [...meta, paragraph('Předmět předání:'), paragraph('Stav při předání a případné výhrady:'), paragraph('Seznam předávaných podkladů:'), table([['Předávající', 'Přebírající'], ['Jméno a podpis', 'Jméno a podpis']])] : [paragraph(v.date), paragraph(v.customerName), paragraph('Věc:'), paragraph('Vážení,'), paragraph(), paragraph('S pozdravem'), paragraph(v.companyName)];
  result.doc = { type: 'doc', content: [heading(title), ...body] }; return result;
}
