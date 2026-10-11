import test from 'node:test';
import assert from 'node:assert/strict';
import {toFortuneSheets,fromFortuneSheets,isOfficeFormulaSafe,isFortuneInputSafe} from '../src/core/fortune-adapter.ts';
import {blankSpreadsheet,createTemplate} from '../src/core/templates.ts';
test('Fortune adapter preserves formulas, numeric/string values and ordered sheets',()=>{
 const base=createTemplate('estimate',{companyName:'A',date:'2026-10-11',currency:'CZK'});
 base.workbook.sheets.second={id:'second',name:'Second',rowCount:100,columnCount:20,cellData:{0:{0:{v:4,t:2},1:{f:"='Kalkulace zakázky'!D10+$A$1"}}},rowData:{},columnData:{},mergeData:[]};base.workbook.sheetOrder.push('second');
 const sheets=toFortuneSheets(base);assert.equal(sheets[0].celldata.find(x=>x.r===6&&x.c===3).v.f,'=B7*C7');
 const next=fromFortuneSheets(sheets,base);assert.deepEqual(next.workbook.sheetOrder,base.workbook.sheetOrder);assert.equal(next.workbook.sheets.second.cellData[0][1].f,"='Kalkulace zakázky'!D10+$A$1");assert.equal(next.workbook.sheets.second.cellData[0][0].v,4);
});
test('Fortune adapter roundtrips supported style, merge, dimensions and frozen panes',()=>{
 const base=blankSpreadsheet();const sheet=base.workbook.sheets['sheet-1'];sheet.cellData={0:{0:{v:'Header',t:1,s:{bl:1,it:1,cl:{rgb:'#123456'},bg:{rgb:'#eeeeee'},fs:14,ff:'Arial',n:{pattern:'0.00'},bd:{b:{s:1,cl:{rgb:'#000000'}}}}}}};sheet.mergeData=[{startRow:0,endRow:0,startColumn:0,endColumn:2}];sheet.rowData={0:{h:35}};sheet.columnData={0:{w:180}};sheet.freeze={xSplit:1,ySplit:2,startRow:2,startColumn:1};
 const result=fromFortuneSheets(toFortuneSheets(base),base).workbook.sheets['sheet-1'];assert.equal(result.cellData[0][0].s.bl,1);assert.equal(result.cellData[0][0].s.cl.rgb,'#123456');assert.equal(result.cellData[0][0].s.bd.b.s,1);assert.deepEqual(result.mergeData,sheet.mergeData);assert.equal(result.rowData[0].h,35);assert.equal(result.columnData[0].w,180);assert.equal(result.freeze.ySplit,2);
});
test('active/external formulas and enormous dense grids are rejected before rendering',()=>{
 for(const f of ['=WEBSERVICE("https://x")','=HYPERLINK("file:///x")',"='[Other.xlsx]Sheet1'!A1",'=CALL("x")','=cmd|x!A1'])assert.equal(isOfficeFormulaSafe(f),false);
 for(const f of ['=SUM(A1:A4)','=IF(A1>0,1,0)',"='Other Sheet'!$A$1",'=COUNTIF(A1:A3,">2")'])assert.equal(isOfficeFormulaSafe(f),true);
 assert.equal(isFortuneInputSafe({f:'=WEBSERVICE("x")'}),false);
 const base=blankSpreadsheet();base.workbook.sheets['sheet-1'].rowCount=20000;assert.throws(()=>toFortuneSheets(base));
});
test('adapter ignores images, hyperlinks, comments and unknown raw metadata',()=>{
 const base=blankSpreadsheet();const sheets=toFortuneSheets(base);sheets[0].images=[{src:'https://evil.test/x'}];sheets[0].hyperlink={x:{linkAddress:'javascript:alert(1)'}};sheets[0].celldata=[{r:0,c:0,v:{v:'safe',ps:{value:'bad'},hl:{id:'x'},spl:'bad'}}];
 const output=JSON.stringify(fromFortuneSheets(sheets,base));assert.ok(output.includes('safe'));assert.ok(!output.includes('evil.test'));assert.ok(!output.includes('javascript:'));assert.ok(!output.includes('"ps"'));
});
