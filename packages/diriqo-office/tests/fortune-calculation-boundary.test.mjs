import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {transformFortuneCore} from '../scripts/fortune-safe-transform.mjs';
import {guardFortuneCalculation} from '../src/core/fortune-formula-guard.ts';
import {toFortuneSheets} from '../src/core/fortune-adapter.ts';
import {validateContent} from '../src/core/validation.ts';
import {exportXlsx,importXlsx} from '../src/server/formats.ts';
const require=createRequire(import.meta.url),{Parser}=require('@fortune-sheet/formula-parser');
const source=transformFortuneCore(await readFile('node_modules/@fortune-sheet/core/dist/index.esm.js','utf8'));
function engine(){
 const writes=[];const scope={__officeFormulaGuard:guardFortuneCalculation,error:{r:'#REF!'},checkBracketNum:()=>true,_:{isNil:x=>x==null},insertUpdateFunctionGroup:()=>{},execFunctionGroup:()=>{},getSheetIndex:(ctx,id)=>ctx.luckysheetfile.findIndex(s=>s.id===id),setCellValue$1:(ctx,r,c,value,options)=>{writes.push({id:options?.id??ctx.currentSheetId,r,c,value});}};
 const first=source.slice(source.indexOf('function execfunction('),source.indexOf('function insertUpdateDynamicArray('));
 const second=source.slice(source.indexOf('function calculateSheetFromula('),source.indexOf('function calculateFormula('));
 vm.runInNewContext(first+'\n'+second,scope);
 return {...scope,writes};
}
const sheet=(id,name,f)=>({id,name,row:10,column:3,data:[[{v:1},{v:2},{f}]],calcChain:[{r:0,c:2,id}]});
const context=files=>({currentSheetId:files[0].id,luckysheetfile:files,formulaCache:{parser:new Parser()}});
test('actual transformed engine gates self, two-cell and cross-sheet cycles before parser execution',()=>{
 for(const files of [
  [sheet('a','A','=C1+1')],
  [{...sheet('a','A','=A1+1'),data:[[{f:'=C1+1'},null,{f:'=A1+1'}]],calcChain:[{r:0,c:0,id:'a'},{r:0,c:2,id:'a'}]}],
  [sheet('a','A',"='B'!C1+1"),sheet('b','B',"='A'!C1+1")],
 ]){
  const e=engine(),ctx=context(files);let calls=0;ctx.formulaCache.parser.parse=()=>{calls++;throw Error('Parser must not run');};
  const formula=files[0].data[0][2].f;const value=e.execfunction(ctx,formula,0,2,'a');
  assert.equal(value[1],'#CYCLE!');assert.equal(value[2],formula);assert.equal(calls,0);
 }
});
test('actual transformed engine rejects oversized and dynamic ranges before parser execution',()=>{
 for(const formula of ['=SUM(A1:XFD1048576)','=INDIRECT("A1")','=REPT("x",999999999)']){
  const e=engine(),ctx=context([sheet('a','A',formula)]);ctx.formulaCache.parser.parse=()=>{throw Error('Parser must not run');};
  const value=e.execfunction(ctx,formula,0,2,'a');assert.match(value[1],/^#OFFICE_/);assert.equal(value[2],formula);
 }
});
test('actual transformed explicit-sheet calculation writes only into its requested sheet',()=>{
 const e=engine(),ctx=context([sheet('a','A','=SUM(10,20)'),sheet('b','B','=SUM(30,40)')]);
 e.calculateSheetFromula(ctx,'b');assert.deepEqual(e.writes,[{id:'b',r:0,c:2,value:70}]);
 assert.equal(ctx.luckysheetfile[0].data[0][2].f,'=SUM(10,20)');
 assert.equal(ctx.luckysheetfile[1].data[0][2].f,'=SUM(30,40)');
});
test('engine output cannot expand into oversized strings, arrays or nonfinite numbers',()=>{
 for(const [result,expected]of [['x'.repeat(32768),'#OFFICE_LIMIT!'],[[1,2],'#OFFICE_LIMIT!'],[Infinity,'#NUM!']]){
  const e=engine(),ctx=context([sheet('a','A','=1')]);ctx.formulaCache.parser.parse=()=>({error:null,result});
  assert.equal(e.execfunction(ctx,'=1',0,2,'a')[1],expected);
 }
});

test('XLSX unquoted Czech sheet references survive roundtrip and calculate through the actual engine boundary',()=>{
 const content={schemaVersion:1,kind:'spreadsheet',workbook:{id:'unicode-test',name:'Synthetic',sheetOrder:['summary','work','install'],sheets:{
  summary:{id:'summary',name:'Summary',rowCount:10,columnCount:3,cellData:{0:{0:{f:'=SUM(Vícepráce!$A$1:$A$2)+Montáž!B2',v:999}}}},
  work:{id:'work',name:'Vícepráce',rowCount:10,columnCount:3,cellData:{0:{0:{v:10,t:2}},1:{0:{v:20,t:2}}}},
  install:{id:'install',name:'Montáž',rowCount:10,columnCount:3,cellData:{1:{1:{v:5,t:2}}}},
 }}};
 const imported=validateContent(importXlsx(exportXlsx(content).bytes).content);
 const files=toFortuneSheets(imported),ctx=context(files),e=engine();
 const lookup=(name,row,column)=>files.find(file=>file.name===name).celldata.find(cell=>cell.r===row&&cell.c===column)?.v.v??0;
 ctx.formulaCache.parser.on('callCellValue',(cell,_options,done)=>done(lookup(cell.sheetName,cell.row.index,cell.column.index)));
 ctx.formulaCache.parser.on('callRangeValue',(start,end,_options,done)=>{
  const rows=[];for(let row=start.row.index;row<=end.row.index;row++){
   const values=[];for(let column=start.column.index;column<=end.column.index;column++)values.push(lookup(start.sheetName,row,column));rows.push(values);
  }done(rows);
 });
 const formula=files[0].celldata.find(cell=>cell.r===0&&cell.c===0).v.f;
 assert.equal(formula,content.workbook.sheets.summary.cellData[0][0].f);
 assert.deepEqual(files.map(file=>file.name),['Summary','Vícepráce','Montáž']);
 assert.equal(e.execfunction(ctx,formula,0,0,files[0].id)[1],35);
 files[1].celldata.find(cell=>cell.r===1&&cell.c===0).v.v=30;
 assert.equal(e.execfunction(ctx,formula,0,0,files[0].id)[1],45);
});
