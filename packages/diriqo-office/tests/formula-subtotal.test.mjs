import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {validateContent} from '../src/core/validation.ts';
import {blankSpreadsheet} from '../src/core/templates.ts';
import {assertFormulaGraph,FormulaGraphError} from '../src/core/formula-graph.ts';
import {exportXlsx,importXlsx} from '../src/server/formats.ts';
import {guardFortuneCalculation} from '../src/core/fortune-formula-guard.ts';

const require=createRequire(import.meta.url),{Parser}=require('@fortune-sheet/formula-parser');

test('XLSX SUBTOTAL formulas survive import, final validation and OSS calculation',()=>{
 const content=blankSpreadsheet(),sheet=content.workbook.sheets['sheet-1'];
 sheet.cellData={0:{0:{v:10,t:2}},1:{0:{v:20,t:2}},2:{0:{v:30,t:2}},
  3:{0:{f:'=SUBTOTAL(9,A1:A3)',v:60}},4:{0:{f:'=SUBTOTAL(109,$A$1:$A$3)',v:60}}};
 const imported=validateContent(importXlsx(exportXlsx(content).bytes).content);
 const actual=imported.workbook.sheets[imported.workbook.sheetOrder[0]];
 const parser=new Parser();
 parser.on('callRangeValue',(start,end,_options,done)=>{
  assert.equal(start.row.index,0);assert.equal(end.row.index,2);
  assert.equal(start.column.index,0);assert.equal(end.column.index,0);
  done([0,1,2].map(row=>[actual.cellData[row][0].v]));
 });
 for(const row of [3,4]){
  assert.equal(actual.cellData[row][0].f,sheet.cellData[row][0].f);
  assert.deepEqual(parser.parse(actual.cellData[row][0].f.slice(1)),{error:null,result:60});
 }
 // Changed input must be recalculated rather than read from an imported result cache.
 actual.cellData[1][0].v=40;
 for(const row of [3,4])assert.deepEqual(parser.parse(actual.cellData[row][0].f.slice(1)),{error:null,result:80});
});

function book(){
 const content=blankSpreadsheet(),sheet=content.workbook.sheets['sheet-1'];
 sheet.rowCount=10000;sheet.columnCount=256;
 return content;
}
function put(content,row,column,formula){
 const sheet=content.workbook.sheets['sheet-1'];(sheet.cellData[row]??={})[column]={f:formula};return content;
}
function expectCode(formula,code){
 assert.throws(()=>assertFormulaGraph(put(book(),0,0,formula)),
  error=>error instanceof FormulaGraphError&&error.code===code);
}

test('SUBTOTAL retains static dependency edges and all existing graph protections',()=>{
 const content=book();put(content,0,0,'=SUBTOTAL(109,$B$1:$B$3)');put(content,1,1,'=C2*2');
 assert.deepEqual(assertFormulaGraph(content),{formulaCount:2,expandedReferences:4,dependencyEdges:1});
 expectCode('=SUBTOTAL(9,A1:A3)','FORMULA_CYCLE');
 expectCode('=SUBTOTAL(9,B1:L10000)','FORMULA_LIMIT');
 expectCode('=SUBTOTAL(9,INDIRECT("B1"))','FORMULA_UNSUPPORTED_FUNCTION');
 expectCode('=SUBTOTAL(9,WEBSERVICE("https://example.test"))','FORMULA_UNSAFE');
 expectCode("=SUBTOTAL(9,'[other.xlsx]Sheet'!B1)",'FORMULA_UNSAFE');
});

test('unsupported SUBTOTAL invocations fail instead of silently discarding arguments',()=>{
 for(const formula of ['=SUBTOTAL(9,B1:B3,C1:C3)','=SUBTOTAL(12,B1:B3)',
  '=SUBTOTAL(A2,B1:B3)','=SUBTOTAL(9,B1+B2)','=SUBTOTAL(9,SUM(B1:B3))',
  '=SUBTOTAL(9,SUBTOTAL(9,B1:B3))','=SUBTOTAL(9,"B1:B3")'])
  expectCode(formula,'FORMULA_UNSUPPORTED_FUNCTION');
 for(const code of [...Array.from({length:11},(_,i)=>i+1),...Array.from({length:11},(_,i)=>i+101)])
  assert.doesNotThrow(()=>assertFormulaGraph(put(book(),0,0,`=SUBTOTAL(${code},B1:B3)`)));
});

test('nested subtotal range detection uses parsed functions without false positive text',()=>{
 const nested=book();put(nested,0,0,'=SUBTOTAL(9,B1:B3)');put(nested,1,1,'=SUBTOTAL(9,C1:C3)');
 assert.throws(()=>assertFormulaGraph(nested),error=>error.code==='FORMULA_UNSUPPORTED_FUNCTION');
 const separate=book();put(separate,0,0,'=SUBTOTAL(9,B1:B3)+C1');put(separate,0,2,'=SUBTOTAL(109,D1:D3)');
 assert.doesNotThrow(()=>assertFormulaGraph(separate));
 const text=book();put(text,0,0,'=SUBTOTAL(9,B1:B3)');put(text,1,1,'=IF(C2="SUBTOTAL(9,A1)",1,2)');
 assert.doesNotThrow(()=>assertFormulaGraph(text));
});

test('SUBTOTAL rejects hidden or filtered input ranges the engine cannot faithfully calculate',()=>{
 for(const code of [9,109]){
  const content=book();put(content,0,0,`=SUBTOTAL(${code},B1:B3)`);
  const sheet=content.workbook.sheets['sheet-1'];
  sheet.rowData={1:{hd:1}};
  assert.throws(()=>assertFormulaGraph(content),error=>error.code==='FORMULA_UNSUPPORTED_FUNCTION');
  sheet.rowData={5:{hd:1}};
  assert.doesNotThrow(()=>assertFormulaGraph(content));
  sheet.officeFilter={range:{startRow:0,endRow:3,startColumn:1,endColumn:1},columns:[]};
  assert.throws(()=>assertFormulaGraph(content),error=>error.code==='FORMULA_UNSUPPORTED_FUNCTION');
  sheet.officeFilter.range={startRow:6,endRow:8,startColumn:1,endColumn:1};
  assert.doesNotThrow(()=>assertFormulaGraph(content));
  sheet.officeFilter.range={startRow:0,endRow:3,startColumn:5,endColumn:5};
  assert.throws(()=>assertFormulaGraph(content),error=>error.code==='FORMULA_UNSUPPORTED_FUNCTION');
 }
});

test('runtime calculation guard includes visibility changes in validation and cache signature',()=>{
 const file={id:'sheet-1',name:'Sheet',row:100,column:26,calcChain:[],config:{rowhidden:{}}};
 const ctx={currentSheetId:'sheet-1',luckysheetfile:[file]};
 const check=()=>guardFortuneCalculation(ctx,'=SUBTOTAL(109,B1:B3)',0,0,'sheet-1');
 assert.equal(check(),null);
 file.config.rowhidden={1:0};assert.equal(check(),'#OFFICE_BLOCKED!');
 file.config.rowhidden={};assert.equal(check(),null);
 file.filter_select={row:[0,3],column:[4,4]};assert.equal(check(),'#OFFICE_BLOCKED!');
 delete file.filter_select;assert.equal(check(),null);
 file.config.rowhidden={7:0};assert.equal(check(),null);
 file.filter_select={row:[6,9],column:[1,1]};assert.equal(check(),null);
 file.filter_select={row:[0,1000000],column:[1,1]};assert.equal(check(),'#OFFICE_LIMIT!');
});
