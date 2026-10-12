import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {exportPdf, PDF_LIMITS} from '../src/server/pdf.ts';
import {loadPdfFont} from '../src/server/pdf-font.ts';
const text = value => ({type:'paragraph',content:[{type:'text',text:value}]});
const document = (content, page = {}) => ({schemaVersion:1,kind:'document',page:{marginMm:20,header:'Česká firma',footer:'Předávací protokol',...page},doc:{type:'doc',content}});
const countPages = bytes => Number(bytes.toString('latin1').match(/\/Type \/Pages \/Count (\d+)/)[1]);

test('PDF contains real cross-reference offsets, embedded unmodified OFL font and Unicode map', async()=>{
  const source = document([{type:'heading',attrs:{level:1},content:[{type:'text',text:'Příliš žluťoučký kůň úpěl ďábelské ódy.'}]},text('Zařízení: 1 250 Kč / 50 € ěščřžýáíéúůťďň ĚŠČŘŽÝÁÍÉÚŮŤĎŇ')]);
  const before=JSON.stringify(source), a=exportPdf(source), b=exportPdf(source);
  assert.equal(JSON.stringify(source),before); assert.deepEqual(a.bytes,b.bytes); assert.equal(countPages(a.bytes),1);
  const raw=a.bytes.toString('latin1'); assert.match(raw,/\/FontFile2/); assert.match(raw,/\/ToUnicode/);
  const xref=Number(raw.match(/startxref\n(\d+)/)[1]); assert.equal(raw.slice(xref,xref+4),'xref');
  const rows=raw.slice(xref).split('\n'); const count=Number(rows[1].split(' ')[1]);
  for(let i=1;i<count;i++){const offset=Number(rows[2+i].slice(0,10));assert.equal(raw.slice(offset,offset+String(i).length+6),`${i} 0 obj`);}
  const bytes=await readFile(new URL('../licenses/assets/Geist-Regular.ttf',import.meta.url)); assert.notEqual(a.bytes.indexOf(bytes),-1);
  for(const char of 'ěščřžýáíéúůťďňĚŠČŘŽÝÁÍÉÚŮŤĎŇ€') assert.match(raw,new RegExp(`<${char.charCodeAt(0).toString(16).padStart(4,'0')}>`));
});
test('Reviewed font and full OFL retain exact hashes and Czech coverage',async()=>{
  const evidence=JSON.parse(await readFile(new URL('../licenses/assets/evidence.json',import.meta.url),'utf8')).assets[0];
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(await readFile(new URL('../'+evidence.path,import.meta.url))),evidence.sha256);
  const license=await readFile(new URL('../'+evidence.licensePath,import.meta.url));assert.equal(hash(license),evidence.licenseSha256);
  assert.match(license.toString(),/SIL OPEN FONT LICENSE Version 1.1/); assert.match(license.toString(),/Geist Project Authors/);
  const font=loadPdfFont();for(const c of 'Příliš žluťoučký kůň úpěl ďábelské ódy. ĚŠČŘŽÝÁÍÉÚŮŤĎŇ 1 250 Kč €') {assert.ok(font.glyph(c.codePointAt(0))>0,c); assert.ok(font.width(c.codePointAt(0))>0,c);}
});
test('Long words, long table cells and explicit page breaks paginate without discarding text',()=>{
  const content=[text('dlouhé'.repeat(1500)),{type:'pageBreak'},{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[text('Položka '.repeat(600))]},{type:'tableCell',content:[text('KONEC TABULKY')]}]}]},text('KONEC DOKUMENTU')];
  const result=exportPdf(document(content)); assert.ok(countPages(result.bytes)>3); assert.ok(countPages(result.bytes)<20);
  assert.ok(result.warnings.some(w=>w.includes('continue across pages')));
});
test('Visible unsupported glyph and image warnings replace omissions; URLs cannot become PDF actions',()=>{
  const doc=document([{type:'paragraph',content:[{type:'text',text:'🦄',marks:[{type:'link',attrs:{href:'http://127.0.0.1/private'}}]}]},{type:'image',attrs:{src:'http://127.0.0.1/private',alt:'Fotografie zakázky'}},text(') endstream /JavaScript /Launch')]);
  const result=exportPdf(doc), raw=result.bytes.toString('latin1'); assert.ok(result.warnings.some(w=>w.includes('[U+XXXX]')));assert.ok(result.warnings.some(w=>w.includes('Images')));assert.ok(result.warnings.some(w=>w.includes('no active links')));
  assert.doesNotMatch(raw,/\/JavaScript|\/Launch|\/URI|127\.0\.0\.1/);
});
test('PDF rejects excessive, nonfinite or unsupported layout before silent loss',()=>{
  assert.throws(()=>exportPdf(document([text('x'.repeat(PDF_LIMITS.characters+1))])),/100000/);
  assert.throws(()=>exportPdf(document([text('x')],{marginMm:NaN})),/margins/);
  assert.throws(()=>exportPdf(document([{type:'paragraph',attrs:{lineHeight:Infinity},content:[]}])) ,/line spacing/);
  assert.throws(()=>exportPdf(document([text('x')],{header:'x'.repeat(2001)})),/Header\/footer/);
  assert.throws(()=>exportPdf(document([{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{rowspan:2},content:[text('x')]}]}]}])),/merged table rows/);
  assert.throws(()=>exportPdf(document(Array.from({length:201},()=>({type:'pageBreak'})))),/200 pages/);
});
