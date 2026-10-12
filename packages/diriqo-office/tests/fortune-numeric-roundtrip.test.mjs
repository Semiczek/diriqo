import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {blankSpreadsheet} from '../src/core/templates.ts';
import {toFortuneSheets,fromFortuneSheets,isFortuneInputSafe} from '../src/core/fortune-adapter.ts';
import {exportXlsx,importXlsx,readSafeZip} from '../src/server/formats.ts';
const require=createRequire(import.meta.url),{Parser}=require('@fortune-sheet/formula-parser');
function convert(cells,dense=true){
 const base=blankSpreadsheet();const sheets=toFortuneSheets(base);
 if(dense)sheets[0].data=[cells];
 else sheets[0].celldata=cells.map((v,c)=>({r:0,c,v}));
 const before=JSON.stringify(sheets),content=fromFortuneSheets(sheets,base);
 assert.equal(JSON.stringify(sheets),before,'Snapshot normalization must not mutate engine state');
 return content;
}
function firstRow(content){return content.workbook.sheets[content.workbook.sheetOrder[0]].cellData[0];}
const numberCell=(v,fa='General',t='n')=>({v,ct:{t,fa}});

test('numeric strings explicitly typed by Fortune normalize in dense and sparse snapshots',()=>{
 for(const dense of [true,false]){
  const content=convert([numberCell('30'),numberCell('20'),{...numberCell('25'),f:'=AVERAGE(A1:B1)'}],dense);
  const row=firstRow(content);
  assert.equal(row[0].v,30);assert.equal(row[0].t,2);
  assert.equal(row[1].v,20);assert.equal(row[2].v,25);
  assert.equal(row[2].f,'=AVERAGE(A1:B1)');
  const reopened=toFortuneSheets(content)[0].celldata;
  assert.equal(reopened.find(x=>x.r===0&&x.c===0).v.v,30);
  assert.equal(reopened.find(x=>x.r===0&&x.c===0).v.ct.t,'n');
 }
});

test('finite decimal, signed, exponent, percentage and date serial values retain numeric types',()=>{
 const input=[numberCell('0'),numberCell('-12.5'),numberCell('+.5'),numberCell('1E3'),numberCell(' 30 '),numberCell('0.25','0%'),numberCell('45200.5','yyyy-mm-dd hh:mm','d')];
 const row=firstRow(convert(input));
 assert.deepEqual(Object.values(row).map(c=>c.v),[0,-12.5,0.5,1000,30,0.25,45200.5]);
 for(const cell of Object.values(row))assert.equal(cell.t,2);
 assert.equal(row[5].s.n.pattern,'0%');assert.equal(row[6].s.n.pattern,'yyyy-mm-dd hh:mm');
});

test('text, leading-zero identifiers, explicit text formats and rich clipboard text stay text',()=>{
 const input=[{v:'00123',ct:{t:'s',fa:'General'}},{v:'30',ct:{t:'s',fa:'General'}},{v:'30',ct:{t:'n',fa:'@'}},{v:'00123',ct:{t:'n',fa:'General'},qp:1},{v:'1e3'},{v:'12.5',ct:{t:'g',fa:'General'}},{ct:{t:'inlineStr',fa:'General',s:[{v:'00'},{v:'123'}]}}];
 const row=firstRow(convert(input));
 assert.deepEqual(Object.values(row).map(c=>c.v),['00123','30','30','00123','1e3','12.5','00123']);
 for(const cell of Object.values(row))assert.equal(cell.t,1);
 const roundtrip=firstRow(importXlsx(exportXlsx(convert(input)).bytes).content);
 assert.deepEqual(Object.values(roundtrip).map(c=>c.v),['00123','30','30','00123','1e3','12.5','00123']);
});

test('numeric metadata never partially parses malformed input or accepts non-finite values',()=>{
 const values=['',' ','NaN','Infinity','-Infinity','1e309','0x10','0b10','30 EUR','1,5','1,000','20%','=1+1'];
 const row=firstRow(convert(values.map(v=>numberCell(v))));
 for(const [index,value]of values.entries()){
  assert.equal(row[index].v,value);assert.equal(row[index].t,1);assert.equal(row[index].f,undefined);
 }
 assert.equal(isFortuneInputSafe(numberCell('=WEBSERVICE("https://example.test")')),false);
});

test('realistic Fortune input exports numeric XLSX and preserves SUM, AVERAGE and COUNT after reimport',()=>{
 const content=convert([numberCell('30'),numberCell('20'),{...numberCell('50'),f:'=SUM(A1:B1)'},{...numberCell('25'),f:'=AVERAGE(A1:B1)'},{v:'00123',ct:{t:'s',fa:'General'}},{v:'30',ct:{t:'s',fa:'General'}}]);
 const bytes=exportXlsx(content).bytes;
 const xml=Buffer.from(readSafeZip(bytes)['xl/worksheets/sheet1.xml']).toString('utf8');
 assert.match(xml,/<c r="A1"[^>]*><v>30<\/v><\/c>/);
 assert.match(xml,/<c r="B1"[^>]*><v>20<\/v><\/c>/);
 assert.match(xml,/<c r="E1"[^>]*t="inlineStr"[^>]*><is><t[^>]*>00123<\/t>/);
 assert.match(xml,/<c r="F1"[^>]*t="inlineStr"[^>]*><is><t[^>]*>30<\/t>/);
 const imported=importXlsx(bytes).content,row=firstRow(imported);
 assert.equal(row[0].v,30);assert.equal(row[0].t,2);assert.equal(row[1].v,20);
 assert.equal(row[2].f,'=SUM(A1:B1)');assert.equal(row[3].f,'=AVERAGE(A1:B1)');
 assert.equal(row[4].v,'00123');assert.equal(row[5].v,'30');
 const parser=new Parser();
 parser.on('callRangeValue',(_start,_end,_options,done)=>done([[row[0].v,row[1].v]]));
 for(const [formula,expected]of [[row[2].f.slice(1),50],[row[3].f.slice(1),25],['COUNT(A1:B1)',2]]){
  const result=parser.parse(formula);assert.equal(result.error,null,formula);assert.equal(result.result,expected,formula);
 }
});
