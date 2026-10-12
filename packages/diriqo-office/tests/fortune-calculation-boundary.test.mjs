import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {transformFortuneCore} from '../scripts/fortune-safe-transform.mjs';
import {guardFortuneCalculation} from '../src/core/fortune-formula-guard.ts';
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
