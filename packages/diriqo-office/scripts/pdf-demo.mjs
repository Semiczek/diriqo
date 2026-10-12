import {mkdir, writeFile} from 'node:fs/promises';
import {exportPdf} from '../src/server/pdf.ts';
const p = text => ({type:'paragraph',content:[{type:'text',text}]});
const cell = (text, header=false) => ({type:header?'tableHeader':'tableCell',content:[p(text)]});
const row = (...cells) => ({type:'tableRow',content:cells});
const heading = (text, level=1) => ({type:'heading',attrs:{level},content:[{type:'text',text}]});
const doc={schemaVersion:1,kind:'document',page:{marginMm:20,header:'Diriqo Office | Ukázková firma – syntetická data',footer:'Ověřovací dokument • Bez zákaznických údajů'},doc:{type:'doc',content:[
  heading('Předávací protokol'),
  p('Příliš žluťoučký kůň úpěl ďábelské ódy. ĚŠČŘŽÝÁÍÉÚŮŤĎŇ'),
  {type:'paragraph',content:[{type:'text',text:'Zakázka: ',marks:[{type:'bold'}]},{type:'text',text:'Montáž zařízení č. 2026/104',marks:[{type:'italic'},{type:'textStyle',attrs:{color:'#1B5865'}}]}]},
  p('Dne 11. října 2026 byly předány níže uvedené práce. Tento dokument je pouze zkouškou výstupu PDF.'),
  heading('Rozsah provedených prací',2),
  {type:'bulletList',content:['Kontrola rozvodů a bezpečného zapojení','Seřízení zařízení a předání návodu','Ověření výsledné částky v českých korunách'].map(t=>({type:'listItem',content:[p(t)]}))},
  {type:'table',content:[row(cell('Položka',true),cell('Množství',true),cell('Cena',true)),row(cell('Montáž'),cell('2 hodiny'),cell('1 250 Kč')),row(cell('Materiál'),cell('1 sada'),cell('50 €'))]},
  p('Kontrolní podpis: Čestmír Řehoř / Žaneta Šťastná.'),
  {type:'pageBreak'},heading('Zkouška dlouhé tabulky',2),
  {type:'table',content:[row(cell('Opakovaný text',true),cell('Výsledek',true)),row(cell('Položka žluťoučký kůň. '.repeat(150)+' KONEC DLOUHÉ BUŇKY'),cell('Pravý sloupec zůstává v hranicích buňky.'))]},
  heading('Zkouška dlouhého slova',2),p('dlouhé'.repeat(300)),p('KONEC DOKUMENTU – vše zachováno.')
]}};
const result=exportPdf(doc);await mkdir('output/pdf',{recursive:true});
await writeFile('output/pdf/diriqo-office-czech.pdf',result.bytes);
await writeFile('output/pdf/expected.json',JSON.stringify({mustContain:['Předávací protokol','Příliš žluťoučký kůň úpěl ďábelské ódy.','ĚŠČŘŽÝÁÍÉÚŮŤĎŇ','1 250 Kč','50 €','Čestmír Řehoř / Žaneta Šťastná.','KONEC DLOUHÉ BUŇKY','KONEC DOKUMENTU – vše zachováno.'],longWord:'dlouhé'.repeat(300),repeatedText:'Položka žluťoučký kůň.',repeatCount:150,header:doc.page.header,footer:doc.page.footer,warnings:result.warnings},null,2)+'\n');
console.log(JSON.stringify({bytes:result.bytes.length,warnings:result.warnings}));
