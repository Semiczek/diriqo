import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFormulaGraph,parseFormulaReferences,FormulaGraphError} from '../src/core/formula-graph.ts';
function book(names=['Sheet 1']){
 const sheets=Object.fromEntries(names.map((name,i)=>['sheet-'+i,{id:'sheet-'+i,name,rowCount:10000,columnCount:256,cellData:{}}]));
 return {schemaVersion:1,kind:'spreadsheet',workbook:{sheetOrder:Object.keys(sheets),sheets}};
}
function put(content,sheet,row,column,formula){const target=content.workbook.sheets['sheet-'+sheet];(target.cellData[row]??={})[column]={f:formula};return content;}
function expectCode(fn,code){assert.throws(fn,error=>error instanceof FormulaGraphError&&error.code===code);}
test('static formulas support absolute references, ranges, quoted sheet names and escaped quotes',()=>{
 const content=book(['Main',"O'Brien"]);put(content,0,0,0,"=SUM('O''Brien'!$A$1:$B$3)+IF(B2>0,ROUND(B2/2,2),0)");
 assert.deepEqual(assertFormulaGraph(content),{formulaCount:1,expandedReferences:8,dependencyEdges:0});
 const parsed=parseFormulaReferences("=SUM('O''Brien'!$A$1:$B$3)",{sheetId:'sheet-0',sheets:Object.values(content.workbook.sheets)});
 assert.deepEqual(parsed.references,[{sheetId:'sheet-1',startRow:0,endRow:2,startColumn:0,endColumn:1}]);
});
test('quoted strings are not dependencies and normal template calculations are allowed',()=>{
 const content=book();put(content,0,0,0,'=IF(B1="A1","say ""A1""",SUM(B2:B4))');
 put(content,0,5,5,'=(TIMEVALUE(D6)-TIMEVALUE(C6))*24-E6');
 assert.equal(assertFormulaGraph(content).formulaCount,2);
 assert.doesNotThrow(()=>parseFormulaReferences('=IFERROR(#DIV/0!,0)',{sheetId:'sheet-0',sheets:Object.values(content.workbook.sheets)}));
});
test('self, pair, range and cross-sheet cycles fail with cell locations',()=>{
 for(const content of [
  put(book(),0,0,0,'=A1+1'),
  put(put(book(),0,0,0,'=B1+1'),0,0,1,'=A1+1'),
  put(book(),0,0,0,'=SUM(A1:B3)'),
  put(put(book(['Alpha','Beta']),0,0,0,'=Beta!B2'),1,1,1,'=Alpha!A1'),
 ]){
  assert.throws(()=>assertFormulaGraph(content),error=>error.code==='FORMULA_CYCLE'&&Array.isArray(error.details.cycle)&&error.details.cycle.length>=2);
 }
});
test('acyclic chains and conservative INDEX dependencies validate without evaluating values',()=>{
 const content=book();put(content,0,0,0,'=B1+1');put(content,0,0,1,'=C1+1');put(content,0,0,2,'=SUM(D1:D3)');
 assert.equal(assertFormulaGraph(content).dependencyEdges,2);
 put(content,0,1,0,'=INDEX(B3:C4,1,2)');assert.doesNotThrow(()=>assertFormulaGraph(content));
});
test('dynamic, named, explosive, external, whole-column and unsupported syntaxes fail closed',()=>{
 const content=book(['Main','Other']);
 for(const formula of ['=INDIRECT("A1")','=OFFSET(A1,1,1)','=SEQUENCE(1000000)','=REPT("x",1000000000)','=LET(x,1,x)'])
  expectCode(()=>assertFormulaGraph(put(book(),0,0,0,formula)),'FORMULA_UNSUPPORTED_FUNCTION');
 for(const formula of ['=TotalRevenue+1','=SUM(A:A)','=SUM(1:10)','=SUM(A1;B1)','=SUM({1,2})','=A1 B1','=SUM(A1,)','=SUM(','=A1:','=1 constructor','=1 toString','=SUM(1,','=Main!'])
  assert.throws(()=>assertFormulaGraph(put(book(),0,0,0,formula)),FormulaGraphError);
 expectCode(()=>assertFormulaGraph(put(content,0,0,0,'=Missing!A1')),'FORMULA_UNKNOWN_SHEET');
 expectCode(()=>assertFormulaGraph(put(book(),0,0,0,'=WEBSERVICE("https://example.test")')),'FORMULA_UNSAFE');
 expectCode(()=>assertFormulaGraph(put(book(),0,0,0,"='[Other.xlsx]Sheet'!A1")),'FORMULA_UNSAFE');
});
test('reference coordinates and expansion budgets reject oversized ranges before engine work',()=>{
 for(const formula of ['=SUM(A1:XFD1048576)','=IW1','=A10001','=A0','=SUM(C3:A1)'])
  assert.throws(()=>assertFormulaGraph(put(book(),0,0,0,formula)),FormulaGraphError);
 expectCode(()=>assertFormulaGraph(put(book(),0,0,0,'=SUM(B1:K10000)+B1')),'FORMULA_LIMIT');
 const content=book();put(content,0,0,0,'=SUM(B1:K10000)');put(content,0,1,0,'=SUM(L1:U10000)');put(content,0,2,0,'=Z1');
 expectCode(()=>assertFormulaGraph(content),'FORMULA_LIMIT');
});
test('formula count, nesting and ambiguous sheet names are bounded',()=>{
 const content=book();for(let i=0;i<2001;i++)put(content,0,i,0,'=1+1');
 expectCode(()=>assertFormulaGraph(content),'FORMULA_LIMIT');
 expectCode(()=>assertFormulaGraph(put(book(),0,0,0,'='+'('.repeat(65)+'1'+')'.repeat(65))),'FORMULA_LIMIT');
 expectCode(()=>assertFormulaGraph(book(['Same','same'])),'FORMULA_WORKBOOK');
});
test('a 2000-cell dependency chain uses iterative graph traversal',()=>{
 const content=book();
 for(let i=0;i<1999;i++)put(content,0,i,0,'=A'+(i+2)+'+1');
 put(content,0,1999,0,'=1');
 assert.deepEqual(assertFormulaGraph(content),{formulaCount:2000,expandedReferences:1999,dependencyEdges:1999});
});
