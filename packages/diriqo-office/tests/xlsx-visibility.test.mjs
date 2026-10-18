import test from 'node:test';
import assert from 'node:assert/strict';
import {strToU8, unzipSync, zipSync} from 'fflate';
import {exportXlsx, importXlsx, FORMAT_LIMITS} from '../src/server/formats.ts';
import {validateContent} from '../src/core/validation.ts';

// Synthetic XML only; customer workbooks must never become repository fixtures.
const book={schemaVersion:1,kind:'spreadsheet',workbook:{id:'visibility',name:'Visibility',styles:{},sheetOrder:['s'],sheets:{s:{id:'s',name:'Sheet',rowCount:1000,columnCount:26,cellData:{},rowData:{},columnData:{},mergeData:[]}}}};
function fixture({rows='',filter='',subtotal=false,hiddenInput=false}={}){
 const parts=unzipSync(exportXlsx(structuredClone(book)).bytes);
 const data=subtotal?`<row r="1"><c r="A1"><v>10</v></c></row><row r="2"${hiddenInput?' hidden="true"':''}><c r="A2"><v>20</v></c></row><row r="3"><c r="A3"><v>30</v></c></row><row r="4"><c r="B4"><f>SUBTOTAL(9,A1:A3)</f><v>60</v></c></row>`:'';
 parts['xl/worksheets/sheet1.xml']=strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data}${rows}</sheetData>${filter}</worksheet>`);
 return Buffer.from(zipSync(parts));
}
const first=content=>content.workbook.sheets[content.workbook.sheetOrder[0]];

test('XLSX preserves hidden rows with either XML boolean and without a custom height',()=>{
 const bytes=fixture({rows:'<row r="1" hidden="1"/><row r="2" hidden="true"/><row r="3" hidden="1" ht="30"/><row r="4" hidden="0"/><row r="5" hidden="false" ht="15"/>'}),before=Buffer.from(bytes);
 const {content}=importXlsx(bytes),sheet=first(content);
 assert.deepEqual(sheet.rowData,{0:{hd:1},1:{hd:1},2:{h:40,hd:1},4:{h:20}});
 validateContent(content);assert.deepEqual(bytes,before);
});

test('XLSX ignores invalid or out-of-bounds row metadata without creating invalid keys',()=>{
 const rows=['0','-1','1.5','NaN',String(FORMAT_LIMITS.rows+1)].map(r=>`<row r="${r}" hidden="1" ht="15"/>`).join('')+'<row hidden="true"/><row r="2" hidden="1"/>';
 const {content}=importXlsx(fixture({rows}));
 assert.deepEqual(first(content).rowData,{1:{hd:1}});validateContent(content);
});

test('XLSX preserves a bounded filter range and warns that criteria are not preserved',()=>{
 for(const ref of ['$A$1:$C$3','B2']){
  const {content,warnings}=importXlsx(fixture({filter:`<autoFilter ref="${ref}"><filterColumn colId="0"><filters><filter val="only"/></filters></filterColumn></autoFilter>`}));
  const range=ref==='B2'?{startRow:1,endRow:1,startColumn:1,endColumn:1}:{startRow:0,endRow:2,startColumn:0,endColumn:2};
  assert.deepEqual(first(content).officeFilter,{range,columns:[]});
  assert.match(warnings.join(' '),/filter criteria are not preserved/);validateContent(content);
 }
});

test('XLSX malformed or excessive filter references are rejected rather than discarded',()=>{
 for(const ref of ['', 'A0:B2', 'B3:A1', 'A1:B2:C3', 'A1:XFE2', `A1:A${FORMAT_LIMITS.rows+1}`]){
  assert.throws(()=>importXlsx(fixture({filter:`<autoFilter ref="${ref}"/>`})),/OFFICE_FORMAT: (?:Invalid (?:cell address|filter range)|Sheet dimensions exceed limit)/,ref);
 }
});

test('XLSX SUBTOTAL survives final validation only when referenced rows have no unsupported visibility semantics',()=>{
 const ordinary=importXlsx(fixture({subtotal:true})).content;
 assert.equal(first(ordinary).cellData[3][1].f,'=SUBTOTAL(9,A1:A3)');validateContent(ordinary);
 const hidden=importXlsx(fixture({subtotal:true,hiddenInput:true})).content;
 assert.equal(first(hidden).rowData[1].hd,1);
 assert.throws(()=>validateContent(hidden),/OFFICE_FORMULA_UNSUPPORTED_FUNCTION:.*hidden rows/);
 for(const ref of ['A1:A3','C1:C3']){
  const filtered=importXlsx(fixture({subtotal:true,filter:`<autoFilter ref="${ref}"/>`})).content;
  assert.throws(()=>validateContent(filtered),/OFFICE_FORMULA_UNSUPPORTED_FUNCTION:.*filtered ranges/);
 }
 // Visibility elsewhere must not reject an unrelated, otherwise valid subtotal.
 validateContent(importXlsx(fixture({subtotal:true,rows:'<row r="6" hidden="1"/>',filter:'<autoFilter ref="A6:B8"/>'})).content);
});
