import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {validateContent} from '../src/core/validation.ts';
import {blankSpreadsheet} from '../src/core/templates.ts';
import {toFortuneSheets} from '../src/core/fortune-adapter.ts';
const require=createRequire(import.meta.url),{Parser}=require('@fortune-sheet/formula-parser');
test('reviewed OSS parser evaluates ordinary formulas and reports errors without eval',()=>{
 const parser=new Parser();
 for(const [formula,expected]of [['SUM(10,20)',30],['AVERAGE(10,20)',15],['MIN(10,20)',10],['MAX(10,20)',20],['COUNT(10,20)',2],['COUNTA(10,"A")',2],['IF(AND(1=1,OR(1=2,2=2)),10,0)',10],['ROUND(12.345,2)',12.35]]){
  const result=parser.parse(formula);assert.equal(result.error,null,formula);assert.equal(result.result,expected,formula);
 }
 assert.equal(parser.parse('1/0').result,'DIV/0');assert.equal(parser.parse('NO_SUCH_FUNCTION(1)').error,'#NAME?');
 parser.on('callRangeValue',(_start,_end,_options,done)=>done([[1],[2]]));
 assert.equal(parser.parse('SUMIF(A1:A2,">1")').result,2);
 assert.equal(parser.parse('COUNTIF(A1:A2,">1")').result,1);
});
test('raw spreadsheet values cannot enter Fortune inline HTML path',()=>{
 for(const value of ['<span onclick="alert(1)">test</span>','<img src="https://example.test/x">','=REGISTER("x")','=EXEC("cmd")']){
  const content=blankSpreadsheet();content.workbook.sheets['sheet-1'].cellData={0:{0:{v:value,t:1}}};
  assert.throws(()=>validateContent(content),/UNSAFE/);assert.throws(()=>toFortuneSheets(content),/Active/);
 }
});
test('numeric display is derived from value rather than stale cached text',()=>{
 const content=blankSpreadsheet();content.workbook.sheets['sheet-1'].cellData={0:{0:{v:250,t:2,m:'9999',s:{n:{pattern:'0.00'}}}}};
 const actual=toFortuneSheets(content,(format,value)=>Number(value).toFixed(2))[0].celldata[0].v;
 assert.equal(actual.v,250);assert.equal(actual.m,'250.00');assert.equal(actual.ct.fa,'0.00');
});
