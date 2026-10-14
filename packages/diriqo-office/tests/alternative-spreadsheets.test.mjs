import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {zipSync,strToU8,unzipSync} from 'fflate';
import * as XLSX from 'xlsx';
import {importAlternativeSpreadsheet,exportAlternativeSpreadsheet,ODS_MIME} from '../src/server/alternative-spreadsheets.ts';
import {importOfficeFile,exportOfficeFile,readSafeZip} from '../src/server/formats.ts';
import {validateContent} from '../src/core/validation.ts';
import {readCompoundFile} from '../src/server/compound-file.ts';
import {compoundFixture} from './fixtures/legacy-office.mjs';

const spreadsheet=()=>({schemaVersion:1,kind:'spreadsheet',workbook:{id:'test-book',name:'Kalkulace',styles:{price:{n:{pattern:'#,##0.00'}}},sheetOrder:['s1','s2'],sheets:{
 s1:{id:'s1',name:'Kalkulace',rowCount:1000,columnCount:26,cellData:{0:{0:{v:12,t:2,s:'price'},1:{v:3,t:2},2:{f:'=SUM(A1:B1)',v:15,t:2}},1:{0:{v:'00123',t:1},1:{v:'=1+1',t:1},2:{v:true,t:3}},2:{0:{v:'Žluťoučký kůň',t:1}}},mergeData:[{startRow:3,endRow:3,startColumn:0,endColumn:1}]},
 s2:{id:'s2',name:'Přehled',rowCount:1000,columnCount:26,cellData:{0:{0:{f:"='Kalkulace'!$C$1*2",v:30,t:2}}},mergeData:[]}
}}});
const first=content=>content.workbook.sheets[content.workbook.sheetOrder[0]];
const odf=xml=>zipSync({mimetype:[strToU8(ODS_MIME),{level:0}],'META-INF/manifest.xml':strToU8('<manifest/>'),'styles.xml':strToU8('<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"/>'),'content.xml':strToU8(xml)});
const odsXml=body=>`<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="List1">${body}</table:table></office:spreadsheet></office:body></office:document-content>`;

test('ODS roundtrip: Unicode, values, formulas, cross-sheet references and merges, genuine first stored mimetype',async()=>{
 const input=spreadsheet(),before=JSON.stringify(input),result=exportAlternativeSpreadsheet(input,'ods');
 assert.equal(JSON.stringify(input),before); assert.equal(readSafeZip(result.bytes,'odf').mimetype.toString(),ODS_MIME);
 const imported=await importOfficeFile('Ceník.ODS',result.bytes),s=first(imported.content);
 assert.equal(imported.original.sha256,createHash('sha256').update(result.bytes).digest('hex')); assert.equal(imported.original.mime,ODS_MIME);
 assert.equal(s.cellData[0][2].f,'=SUM(A1:B1)'); assert.equal(s.cellData[1][0].v,'00123');assert.equal(s.cellData[1][1].f,undefined);assert.equal(s.cellData[1][1].v,'=1+1');
 assert.equal(s.cellData[1][2].v,true);assert.equal(s.cellData[2][0].v,'Žluťoučký kůň'); assert.equal(s.mergeData.length,1);
 const other=imported.content.workbook.sheets[imported.content.workbook.sheetOrder[1]];
 assert.equal(other.cellData[0][0].f,"='Kalkulace'!$C$1*2"); validateContent(imported.content); assert.ok(imported.warnings.length);
 assert.deepEqual(imported.content,importAlternativeSpreadsheet(result.bytes,'ods').content,'worker retry content is deterministic');
});
test('XLS is genuine BIFF8, preserves cached values and explicitly warns formulas are not exported',async()=>{
 const result=exportOfficeFile(spreadsheet(),'Rozpočet.xlsx','xls');assert.equal(result.name,'Rozpočet.xls');
 const bytes=Buffer.from(result.base64,'base64');assert.equal(bytes.subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1');
 assert.match(result.warnings.join(' '),/cached values only; formulas are not exported/);
 const imported=await importOfficeFile(result.name,bytes);assert.equal(imported.original.mime,'application/vnd.ms-excel');
 assert.equal(first(imported.content).cellData[0][2].v,15);assert.equal(first(imported.content).cellData[0][2].f,undefined);
 assert.equal(first(imported.content).cellData[2][0].v,'Žluťoučký kůň');assert.equal(imported.content.workbook.sheetOrder.length,2);validateContent(imported.content);
});
test('TSV keeps text, quotes, tabs, leading zeros and prevents formula injection on export',async()=>{
 const bytes=Buffer.from('Kód\tText\r\n00123\t"a\tb"\r\n=1+1\t"line\ntext"');
 const imported=await importOfficeFile('test.tsv',bytes);const s=first(imported.content);assert.equal(s.cellData[1][0].v,'00123');assert.equal(s.cellData[1][1].v,'a\tb');assert.equal(s.cellData[2][0].f,undefined);
 const result=exportOfficeFile(imported.content,'test','tsv');assert.equal(result.mime,'text/tab-separated-values;charset=utf-8');assert.match(Buffer.from(result.base64,'base64').toString(),/"'=1\+1"\t"line\ntext"/);assert.match(result.warnings[0],/first sheet only/);
});
test('ODF cell repetition bombs, invalid repetitions, namespaces and oversized dimensions are bounded before codec',()=>{
 for(const attrs of ['table:number-columns-repeated="16385"','table:number-columns-repeated="-1"','table:number-columns-repeated="1e30"'])assert.throws(()=>importAlternativeSpreadsheet(odf(odsXml(`<table:table-row><table:table-cell ${attrs}/></table:table-row>`)),'ods'),/repetition limit/);
 assert.throws(()=>importAlternativeSpreadsheet(odf(odsXml('<table:table-row table:number-rows-repeated="100000"><table:table-cell table:number-columns-repeated="2"/></table:table-row>')),'ods'),/expanded cell limit/);
 const alias=odsXml('<table:table-row><table:table-cell office:value-type="float" office:value="7"><text:p>7</text:p></table:table-cell></table:table-row>').replaceAll('table:','alias:').replace('xmlns:table=','xmlns:alias='); assert.equal(first(importAlternativeSpreadsheet(odf(alias),'ods').content).cellData[0][0].v,7);
});

test('ODS preserves supported formulas without cached values and extends bounds to the formula position',()=>{
 for(const attributes of ['', ' office:value-type="string"']){
  const body=`<table:table-row><table:table-cell table:formula="of:=1+2"${attributes}><text:p/></table:table-cell></table:table-row>`;
  const result=importAlternativeSpreadsheet(odf(odsXml(body)),'ods'),s=first(result.content);
  assert.deepEqual(s.cellData[0][0],{v:'',t:1,f:'=1+2'});assert.match(result.warnings.join(' '),/must be recalculated/);
  validateContent(result.content);
 }
 const body='<table:table-row table:number-rows-repeated="1001"/><table:table-row><table:table-cell table:number-columns-repeated="30"/><table:table-cell table:formula="of:=SUM([.$A$1:.$A$2])"/></table:table-row>';
 const result=importAlternativeSpreadsheet(odf(odsXml(body)),'ods'),s=first(result.content);
 assert.equal(s.cellData[1001][30].f,'=SUM($A$1:$A$2)');assert.equal(s.rowCount,1002);assert.equal(s.columnCount,31);
 validateContent(result.content);
});

test('ODS rejects formula content hidden in a covered or merged cell instead of dropping it',()=>{
 for(const tag of ['table:covered-table-cell','table:table-cell']){
  const body=`<table:table-row><table:table-cell table:number-columns-spanned="2" office:value-type="float" office:value="1"><text:p>1</text:p></table:table-cell><${tag} table:formula="of:=1+2" office:value-type="float" office:value="3"><text:p>3</text:p></${tag}></table:table-row>`;
  assert.throws(()=>importAlternativeSpreadsheet(odf(odsXml(body)),'ods'),/formula hidden in a merged cell/);
 }
});
test('false extension and active ODS content never become executable cells',async()=>{
 for(const ext of ['odt','ods','doc','xls'])await assert.rejects(()=>importOfficeFile('fake.'+ext,Buffer.from('plain text')),/OFFICE_FORMAT/);
 const bytes=exportAlternativeSpreadsheet(spreadsheet(),'ods').bytes;await assert.rejects(()=>importOfficeFile('fake.odt',bytes),/not ODT|not an ODT|not a text/i);
 const files=unzipSync(bytes); files['content.xml']=strToU8(new TextDecoder().decode(files['content.xml']).replace('of:=SUM([.A1:.B1])','of:=WEBSERVICE(&quot;http://127.0.0.1&quot;)'));
 const active=zipSync({...files,mimetype:[files.mimetype,{level:0}]});
 assert.throws(()=>importAlternativeSpreadsheet(active,'ods'),/active|External/i);
});
test('ODS 10000 populated cells preserves endpoints within bounded output',()=>{
 const content=spreadsheet();content.workbook.sheetOrder=['s1'];const s=content.workbook.sheets.s1;s.cellData={};s.mergeData=[];
 for(let r=0;r<1000;r++)s.cellData[r]=Object.fromEntries(Array.from({length:10},(_,c)=>[c,{v:r*10+c,t:2}]));
 const result=importAlternativeSpreadsheet(exportAlternativeSpreadsheet(content,'ods').bytes,'ods');assert.equal(first(result.content).cellData[999][9].v,9999);
});
test('export refuses truncation, renamed formula sheets, active formulas and excessive sparse area',()=>{
 for(const [format,r,c]of[['xls',65536,0],['xls',0,256],['ods',100000,0]]){const content=spreadsheet();content.workbook.sheets.s1.cellData={[r]:{[c]:{v:1}}};assert.throws(()=>exportAlternativeSpreadsheet(content,format),/dimensions/);}
 const bad=spreadsheet();bad.workbook.sheets.s1.name='A'.repeat(32);assert.throws(()=>exportAlternativeSpreadsheet(bad,'ods'),/sheet names/);
 const sparse=spreadsheet();sparse.workbook.sheets.s1.cellData={99999:{1:{v:1}}};assert.throws(()=>exportAlternativeSpreadsheet(sparse,'ods'),/area/);
 const external=spreadsheet();external.workbook.sheets.s1.cellData[0][2].f='=WEBSERVICE("https://example.test")';assert.throws(()=>exportAlternativeSpreadsheet(external,'ods'),/Unsafe formula/);
});

// Original MS-XLS synthetic Formula record: two PtgInt constants and PtgAdd.
// Public spec: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/bccb00ac-67a1-490a-9f0b-5ce59978eb9a
function xlsWithRecord(make){
 const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,{A1:{t:'n',v:3},'!ref':'A1'},'List1');
 const streams=readCompoundFile(XLSX.write(w,{type:'buffer',bookType:'biff8'}));const b=streams.Workbook;
 for(let p=0;p+4<=b.length;){const type=b.readUInt16LE(p),n=b.readUInt16LE(p+2);if(type===0x203){const next=make(b.subarray(p+4,p+4+n));streams.Workbook=Buffer.concat([b.subarray(0,p),next,b.subarray(p+4+n)]);return compoundFixture(Object.fromEntries(Object.entries(streams).filter(([name])=>name!=='\u0001Sh33tJ5')));}p+=4+n;}
 throw Error('Synthetic number record missing');
}
const record=(type,bytes)=>{const h=Buffer.alloc(4);h.writeUInt16LE(type);h.writeUInt16LE(bytes.length,2);return Buffer.concat([h,bytes]);};
test('genuine XLS formula record imports a formula and cached result',()=>{
 const bytes=xlsWithRecord(number=>{const formula=Buffer.alloc(29);number.copy(formula,0,0,14);formula.writeUInt16LE(7,20);formula.set([0x1e,1,0,0x1e,2,0,0x03],22);return record(0x6,formula);});
 const cell=first(importAlternativeSpreadsheet(bytes,'xls').content).cellData[0][0];assert.equal(cell.f,'=1+2');assert.equal(cell.v,3);
});
test('XLS refuses FILEPASS, macro-sheet and external-link BIFF records',()=>{
 for(const [type,data]of[[0x2f,Buffer.from([0,0])],[0x809,Buffer.from([0,6,0x40,0])],[0x1ae,Buffer.from([1,0,0,0])]]){
  const bytes=xlsWithRecord(()=>record(type,data));assert.throws(()=>importAlternativeSpreadsheet(bytes,'xls'),/Encrypted|Macro sheets|External workbooks/);
 }
});
