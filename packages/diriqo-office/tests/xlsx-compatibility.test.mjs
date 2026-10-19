import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {exportXlsx,importXlsx,readSafeZip} from '../src/server/formats.ts';
import {translateSharedFormula} from '../src/server/xlsx-shared-formulas.ts';
import {validateContent} from '../src/core/validation.ts';
import {assertFormulaGraph,FORMULA_GRAPH_LIMITS} from '../src/core/formula-graph.ts';
const content=()=>({schemaVersion:1,kind:'spreadsheet',workbook:{id:'synthetic',name:'Synthetic',sheetOrder:['main'],sheets:{main:{id:'main',name:'Sheet',rowCount:1000,columnCount:26,cellData:{0:{0:{v:10,t:2},1:{f:'=A1*2',v:20,t:2}},1:{0:{v:20,t:2},1:{f:'=A2*2',v:40,t:2}}}}}}});
function rewrite(input,fn){return zipSync(Object.fromEntries(Object.entries(readSafeZip(input)).map(([name,bytes])=>[name,strToU8(fn(name,bytes.toString()))])));}
const sheet=book=>book.workbook.sheets[book.workbook.sheetOrder[0]];

test('XLSX resolves spreadsheet and relationship namespaces with arbitrary prefixes',()=>{
 const original=exportXlsx(content()).bytes;
 const prefixed=rewrite(original,(name,xml)=>{
  if(/xl\/(workbook|styles|worksheets\/sheet1)\.xml/.test(name))xml=xml.replace(/(<\/?)([A-Za-z][\w]*)(?=[\s/>])/g,'$1x:$2').replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"','xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"');
  if(name==='xl/workbook.xml')xml=xml.replaceAll('r:id=','rel:id=').replace('xmlns:r=','xmlns:rel=');
  if(name.endsWith('.rels'))xml=xml.replace(/(<\/?)([A-Za-z][\w]*)(?=[\s/>])/g,'$1p:$2').replace('xmlns="http://schemas.openxmlformats.org/package/2006/relationships"','xmlns:p="http://schemas.openxmlformats.org/package/2006/relationships"');
  return xml;
 });
 const result=validateContent(importXlsx(prefixed).content);assert.equal(sheet(result).cellData[1][1].f,'=A2*2');assert.equal(sheet(result).cellData[0][0].v,10);
 const spoof=rewrite(prefixed,(name,xml)=>name==='xl/workbook.xml'?xml.replace('http://schemas.openxmlformats.org/spreadsheetml/2006/main','https://untrusted.invalid/spreadsheet'):xml);
 assert.throws(()=>importXlsx(spoof),/Invalid sheet count/);
});

test('shared formulas retain every formula and cache, including out-of-order followers',()=>{
 const shared=rewrite(exportXlsx(content()).bytes,(name,xml)=>name==='xl/worksheets/sheet1.xml'?xml.replace('<f>A1*2</f>','<f t="shared" si="0" ref="B1:B2">A1*2</f>').replace('<f>A2*2</f>','<f t="shared" si="0"/>'):xml);
 const imported=importXlsx(shared);assert.equal(imported.warnings.length,1);assert.equal(sheet(imported.content).cellData[0][1].f,'=A1*2');assert.equal(sheet(imported.content).cellData[1][1].f,'=A2*2');assert.equal(sheet(imported.content).cellData[1][1].v,40);
 const reordered=rewrite(shared,(name,xml)=>name==='xl/worksheets/sheet1.xml'?xml.replace(/(<row[^>]*>[\s\S]*?<\/row>)(<row[^>]*>[\s\S]*?<\/row>)/,'$2$1'):xml);
 assert.equal(sheet(validateContent(importXlsx(reordered).content)).cellData[1][1].f,'=A2*2');
 const roundtrip=importXlsx(exportXlsx(imported.content).bytes);assert.equal(sheet(roundtrip.content).cellData[1][1].f,'=A2*2');
});

test('shared translation honors absolutes, quoted strings, sheet names and exponents',()=>{
 assert.equal(translateSharedFormula('=SUM($A1,B$2,$C$3,A1!D4,\'A1\'!E5)+IF(A1="A1",1E10,2)',2,3),'=SUM($A3,E$2,$C$3,A1!G6,\'A1\'!H7)+IF(D3="A1",1E10,2)');
 assert.equal(translateSharedFormula('=\'O\'\'Brien\'!A1+LOG10(A1)',1,1),'=\'O\'\'Brien\'!B2+LOG10(B2)');
 assert.throws(()=>translateSharedFormula('=A1',-1,0),/out of bounds/);
 assert.throws(()=>translateSharedFormula('="broken',1,0),/quoted text/);
 assert.throws(()=>translateSharedFormula('='+ '1'.repeat(4096),0,0),/length limit/);
});

test('missing, duplicate and out-of-range shared anchors reject without flattening formulas',()=>{
 const shared=rewrite(exportXlsx(content()).bytes,(name,xml)=>name==='xl/worksheets/sheet1.xml'?xml.replace('<f>A1*2</f>','<f t="shared" si="0" ref="B1:B2">A1*2</f>').replace('<f>A2*2</f>','<f t="shared" si="0"/>'):xml);
 for(const change of [xml=>xml.replace('si="0"/>','si="1"/>'),xml=>xml.replace('ref="B1:B2"','ref="B1:B1"'),xml=>xml.replace('<f t="shared" si="0"/>','<f t="shared" si="0" ref="B1:B2">A2*2</f>')])assert.throws(()=>importXlsx(rewrite(shared,(name,xml)=>name==='xl/worksheets/sheet1.xml'?change(xml):xml)),/shared formula/);
});

test('large repeated criteria ranges are indexed without expanding blank dependency cells',()=>{
 const book=content(),s=book.workbook.sheets.main;s.rowCount=10000;s.columnCount=26;s.cellData={};
 for(let row=0;row<6000;row++)s.cellData[row]={0:{f:'=COUNTIFS(B1:B1000,"A",C1:C1000,"B")'}};
 assert.deepEqual(assertFormulaGraph(book),{formulaCount:6000,expandedReferences:12000000,dependencyEdges:0});
 const result=validateContent(book);assert.equal(Object.keys(result.workbook.sheets.main.cellData).length,6000);
});

test('new bounded graph rejects total work, dense dependency graphs and deep chains',()=>{
 const make=()=>{const b=content();b.workbook.sheets.main.rowCount=10000;b.workbook.sheets.main.columnCount=256;b.workbook.sheets.main.cellData={};return b;};
 const work=make();for(let r=0;r<=Math.floor(FORMULA_GRAPH_LIMITS.expandedReferences/100000);r++)work.workbook.sheets.main.cellData[r]={0:{f:'=SUM(B1:K10000)'}};
 assert.throws(()=>assertFormulaGraph(work),error=>error.code==='FORMULA_LIMIT');
 const dense=make();for(let r=0;r<500;r++)dense.workbook.sheets.main.cellData[r]={0:{f:'=SUM(A1:A500)'}};
 assert.throws(()=>assertFormulaGraph(dense),error=>error.code==='FORMULA_LIMIT');
 const deep=make();for(let r=0;r<2001;r++)deep.workbook.sheets.main.cellData[r]={0:{f:r===2000?'=1':'=A'+(r+2)}};
 assert.throws(()=>assertFormulaGraph(deep),error=>error.code==='FORMULA_LIMIT');
 const text=make();for(let r=0;r<8000;r++)text.workbook.sheets.main.cellData[r]={0:{f:'=1'+ '+0'.repeat(70)}};
 assert.throws(()=>assertFormulaGraph(text),error=>error.code==='FORMULA_LIMIT');
});
 test('formula cached strings, empty strings, booleans and numbers survive XLSX export/import',()=>{
 const book=content();book.workbook.sheets.main.cellData={0:{0:{f:'=IF(1=1,"",0)',v:'',t:1},1:{f:'=IF(1=1,"text",0)',v:'text',t:1},2:{f:'=ISNUMBER(1)',v:true,t:3},3:{f:'=1+1',v:2,t:2}}};
 const restored=sheet(importXlsx(exportXlsx(book).bytes).content).cellData[0];
 for(const column of [0,1,2,3]){assert.equal(restored[column].v,book.workbook.sheets.main.cellData[0][column].v);assert.equal(restored[column].f,book.workbook.sheets.main.cellData[0][column].f);}
 });