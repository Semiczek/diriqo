import type { SpreadsheetContent } from './types.ts';
import { isOfficeFormulaSafe } from './formula-policy.ts';

/** Deliberately bounded A1-only grammar. This analyzes dependencies; it never evaluates formulas. */
export const FORMULA_GRAPH_LIMITS = Object.freeze({
 rows:10_000, columns:256, sheets:32, formulas:8_000, formulaLength:4_096,
 tokens:2_048, depth:64, functionArguments:255, referencesPerFormula:100_000,
 expandedReferences:15_000_000, scannedCells:100_000, formulaCharacters:1_000_000,
 dependencyEdges:200_000, dependencyChecks:200_000, dependencyDepth:2_000,
});
export const OFFICE_FORMULA_FUNCTIONS = Object.freeze([
 'SUM','SUBTOTAL','AVERAGE','MIN','MAX','COUNT','COUNTA','IF','AND','OR','SUMIF','COUNTIF','ROUND',
 'SUMIFS','COUNTIFS','ISNUMBER','IFERROR','NOT','ABS','ROUNDUP','ROUNDDOWN','VLOOKUP','HLOOKUP','MATCH','INDEX',
 'TODAY','DATE','YEAR','MONTH','DAY','TIMEVALUE',
] as const);
const allowedFunctions=new Set<string>(OFFICE_FORMULA_FUNCTIONS);
export type FormulaGraphCode =
 'FORMULA_WORKBOOK'|'FORMULA_SYNTAX'|'FORMULA_UNSUPPORTED_FUNCTION'|'FORMULA_NAMED_REFERENCE'
 |'FORMULA_UNKNOWN_SHEET'|'FORMULA_REFERENCE_BOUNDS'|'FORMULA_LIMIT'|'FORMULA_CYCLE'|'FORMULA_UNSAFE';
export class FormulaGraphError extends Error {
 readonly code:FormulaGraphCode;readonly status=400;readonly cell?:string;readonly details?:Record<string,unknown>;
 constructor(code:FormulaGraphCode,message:string,cell?:string,details?:Record<string,unknown>){
  super(message);this.name='FormulaGraphError';this.code=code;this.cell=cell;this.details=details;
 }
}
export type FormulaSheetDescriptor={id:string;name:string;rowCount:number;columnCount:number};
export type FormulaReference={sheetId:string;startRow:number;endRow:number;startColumn:number;endColumn:number};
export type FormulaReferenceResult={references:FormulaReference[];expandedReferences:number;subtotalReferences?:FormulaReference[]};
export type FormulaGraphStats={formulaCount:number;expandedReferences:number;dependencyEdges:number};
type Token={kind:'number'|'text'|'name'|'quoted'|'error'|'op'|'eof';value:string;at:number};
type Environment={byId:Map<string,FormulaSheetDescriptor>;byName:Map<string,FormulaSheetDescriptor>};
const own=(object:object,key:string)=>Object.prototype.hasOwnProperty.call(object,key);
const record=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function fail(code:FormulaGraphCode,message:string,cell?:string,details?:Record<string,unknown>):never {
 throw new FormulaGraphError(code,message,cell,details);
}
function descriptors(sheets:readonly FormulaSheetDescriptor[]):Environment{
 if(!sheets.length||sheets.length>FORMULA_GRAPH_LIMITS.sheets)fail('FORMULA_WORKBOOK','Workbook must contain 1 to 32 sheets.');
 const byId=new Map<string,FormulaSheetDescriptor>(),byName=new Map<string,FormulaSheetDescriptor>();
 for(const sheet of sheets){
  if(!sheet||typeof sheet.id!=='string'||!sheet.id||typeof sheet.name!=='string'||!sheet.name.trim()||sheet.name.length>100
   ||!Number.isInteger(sheet.rowCount)||!Number.isInteger(sheet.columnCount)||sheet.rowCount<1||sheet.columnCount<1
   ||sheet.rowCount>FORMULA_GRAPH_LIMITS.rows||sheet.columnCount>FORMULA_GRAPH_LIMITS.columns)
   fail('FORMULA_WORKBOOK','Invalid sheet identity or dimensions; maximum is 10,000 rows and 256 columns.');
  const name=sheet.name.toLowerCase();
  if(byId.has(sheet.id)||byName.has(name))fail('FORMULA_WORKBOOK','Sheet identities and names must be unique (names ignore case).');
  byId.set(sheet.id,sheet);byName.set(name,sheet);
 }
 return {byId,byName};
}
function columnName(index:number):string{
 let result='';for(let value=index+1;value>0;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;
 return result;
}
function label(sheet:FormulaSheetDescriptor,row:number,column:number){return "'"+sheet.name.replace(/'/g,"''")+"'!"+columnName(column)+(row+1);}
function lex(formula:string,cell?:string):Token[]{
 if(typeof formula!=='string'||formula.length>FORMULA_GRAPH_LIMITS.formulaLength)fail('FORMULA_LIMIT','Formula is longer than 4,096 characters.',cell);
 if(!isOfficeFormulaSafe(formula))fail('FORMULA_UNSAFE','Formula contains blocked active content or an external reference.',cell);
 if(formula[0]!=='=')fail('FORMULA_SYNTAX','Formula must start with = and use English function names and comma separators.',cell);
 const tokens:Token[]=[];let i=1;
 const push=(kind:Token['kind'],value:string,at:number)=>{tokens.push({kind,value,at});if(tokens.length>FORMULA_GRAPH_LIMITS.tokens)fail('FORMULA_LIMIT','Formula token limit exceeded.',cell);};
 while(i<formula.length){
  const start=i,ch=formula[i];
  if(ch===' '){i++;continue;}
  if(ch==='"'||ch==="'"){
   const quote=ch;let value='',closed=false;i++;
   while(i<formula.length){if(formula[i]===quote){if(formula[i+1]===quote){value+=quote;i+=2;}else{i++;closed=true;break;}}else{value+=formula[i++];}}
   if(!closed)fail('FORMULA_SYNTAX','Unterminated quoted text or sheet name.',cell,{offset:start});
   push(quote==='"'?'text':'quoted',value,start);continue;
  }
  if(ch==='#'){
   const error=/^(?:#REF!|#DIV\/0!|#VALUE!|#NAME\?|#NUM!|#N\/A|#NULL!)/i.exec(formula.slice(i));
   if(!error)fail('FORMULA_SYNTAX','Unsupported error or spill syntax.',cell,{offset:i});
   push('error',error[0].toUpperCase(),i);i+=error[0].length;continue;
  }
  if(/[0-9.]/.test(ch)){
   const match=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(formula.slice(i));
   if(!match||!Number.isFinite(Number(match[0])))fail('FORMULA_SYNTAX','Invalid numeric literal.',cell,{offset:i});
   push('number',match[0],i);i+=match[0].length;continue;
  }
  const match=/^[\p{L}_$][\p{L}\p{N}_.$]*/u.exec(formula.slice(i));
  if(match){
   push('name',match[0],i);i+=match[0].length;continue;
  }
  const pair=formula.slice(i,i+2);
  if(['<=','>=','<>'].includes(pair)){push('op',pair,i);i+=2;continue;}
  if('+-*/^&=<>%(),:!'.includes(ch)){push('op',ch,i);i++;continue;}
  fail('FORMULA_SYNTAX','Unsupported syntax. Use A1 references, quoted sheet names and comma-separated arguments; named, array and dynamic references are not supported.',cell,{offset:i});
 }
 push('eof','',i);return tokens;
}
class ReferenceParser {
 private readonly tokens:Token[];private cursor=0;private depth=0;
 private readonly environment:Environment;private readonly sheet:FormulaSheetDescriptor;private readonly cell?:string;
 private readonly references:FormulaReference[]=[];private readonly subtotalReferences:FormulaReference[]=[];private expanded=0;
 constructor(formula:string,sheet:FormulaSheetDescriptor,environment:Environment,cell?:string){this.tokens=lex(formula,cell);this.environment=environment;this.sheet=sheet;this.cell=cell;}
 private peek(){return this.tokens[this.cursor]??this.tokens[this.tokens.length-1];}
 private take(){const token=this.peek();if(this.cursor<this.tokens.length-1)this.cursor++;return token;}
 private is(value:string){return this.peek().value===value;}
 private expect(value:string){if(!this.is(value))fail('FORMULA_SYNTAX','Expected '+value+'.',this.cell,{offset:this.peek().at});this.take();}
 private resolve(name:string){const result=this.environment.byName.get(name.toLowerCase());if(!result)fail('FORMULA_UNKNOWN_SHEET','Unknown referenced sheet: '+name,this.cell);return result;}
 private address(token:Token,sheet:FormulaSheetDescriptor){
  const match=/^\$?([A-Za-z]+)\$?([1-9][0-9]*)$/.exec(token.value);
  if(token.kind!=='name'||!match)fail('FORMULA_NAMED_REFERENCE','Named, whole-row and whole-column references are not supported: '+token.value,this.cell);
  let column=0;for(const character of match[1].toUpperCase()){column=column*26+character.charCodeAt(0)-64;if(column>FORMULA_GRAPH_LIMITS.columns)break;}
  const row=Number(match[2]);
  if(!Number.isSafeInteger(row)||row<1||row>sheet.rowCount||column<1||column>sheet.columnCount)
   fail('FORMULA_REFERENCE_BOUNDS','Reference '+token.value+' is outside sheet '+sheet.name+'.',this.cell,{sheetId:sheet.id,row,column});
  return {row:row-1,column:column-1};
 }
 private reference(first:Token,defaultSheet:FormulaSheetDescriptor){
  let sheet=defaultSheet,addressToken=first;
  if(this.is('!')){this.take();sheet=this.resolve(first.value);addressToken=this.take();}
  else if(first.kind==='quoted')fail('FORMULA_SYNTAX','A quoted sheet name must be followed by ! and an A1 address.',this.cell);
  const start=this.address(addressToken,sheet);let end=start;
  if(this.is(':')){
   this.take();let last=this.take();let endpointSheet=sheet;
   if(this.is('!')){this.take();endpointSheet=this.resolve(last.value);last=this.take();}
   if(endpointSheet.id!==sheet.id)fail('FORMULA_SYNTAX','Three-dimensional and cross-sheet range endpoints are not supported.',this.cell);
   end=this.address(last,sheet);
   if(end.row<start.row||end.column<start.column)fail('FORMULA_SYNTAX','Range endpoints must be in increasing order.',this.cell);
  }
  const count=(end.row-start.row+1)*(end.column-start.column+1);this.expanded+=count;
  if(this.expanded>FORMULA_GRAPH_LIMITS.referencesPerFormula)fail('FORMULA_LIMIT','One formula may reference at most 100,000 cells.',this.cell);
  this.references.push({sheetId:sheet.id,startRow:start.row,endRow:end.row,startColumn:start.column,endColumn:end.column});
 }
 private primary(){
  const token=this.take();
  if(token.kind==='number'||token.kind==='text'||token.kind==='error')return;
  if(token.value==='('){this.expression(0);this.expect(')');return;}
  if(token.kind==='quoted'){this.reference(token,this.sheet);return;}
  if(token.kind!=='name')fail('FORMULA_SYNTAX','Expected a value, function or A1 reference.',this.cell,{offset:token.at});
  if(this.is('(')){
   const name=token.value.toUpperCase();
   if(!/^[A-Za-z][A-Za-z0-9_.]*$/.test(token.value)||!allowedFunctions.has(name))fail('FORMULA_UNSUPPORTED_FUNCTION','Unsupported function '+token.value+'. Dynamic and potentially explosive functions are disabled.',this.cell,{function:name});
   this.take();
   if(name==='SUBTOTAL'){
    // This OSS engine accepts only one reference and does not exclude nested subtotals.
    const unsupported=()=>fail('FORMULA_UNSUPPORTED_FUNCTION','SUBTOTAL supports only a literal function code (1–11 or 101–111) and one static A1 reference or range.',this.cell,{function:name});
    const code=this.take();if(code.kind!=='number'||!/^(?:[1-9]|10|11|10[1-9]|110|111)$/.test(code.value)||!this.is(','))unsupported();
    this.take();const first=this.take();
    if((first.kind!=='name'&&first.kind!=='quoted')||this.is('('))unsupported();
    this.reference(first,this.sheet);
    if(!this.is(')'))unsupported();this.take();
    this.subtotalReferences.push(this.references[this.references.length-1]);return;
   }
   let args=0;
   if(!this.is(')')){for(;;){if(++args>FORMULA_GRAPH_LIMITS.functionArguments)fail('FORMULA_LIMIT','Function argument limit exceeded.',this.cell);this.expression(0);if(!this.is(','))break;this.take();}}
   this.expect(')');return;
  }
  if(!this.is('!')&&/^(TRUE|FALSE)$/i.test(token.value))return;
  this.reference(token,this.sheet);
 }
 private expression(minimum:number){
  if(++this.depth>FORMULA_GRAPH_LIMITS.depth)fail('FORMULA_LIMIT','Formula nesting limit exceeded.',this.cell);
  try{
   if(this.is('+')||this.is('-')){this.take();this.expression(6);}else this.primary();
   while(this.is('%'))this.take();
   for(;;){
    const operator=this.peek().value;const priority=this.peek().kind==='op'?({'=':1,'<>':1,'<':1,'>':1,'<=':1,'>=':1,'&':2,'+':3,'-':3,'*':4,'/':4,'^':5} as Record<string,number>)[operator]:undefined;
    if(priority===undefined||priority<minimum)break;
    this.take();this.expression(operator==='^'?priority:priority+1);
   }
  }finally{this.depth--;}
 }
 parse():FormulaReferenceResult{this.expression(0);if(this.peek().kind!=='eof')fail('FORMULA_SYNTAX','Unexpected token '+this.peek().value+'.',this.cell,{offset:this.peek().at});return {references:this.references,expandedReferences:this.expanded,...(this.subtotalReferences.length?{subtotalReferences:this.subtotalReferences}:{})};}
}
/** Returns bounded rectangles, never a potentially huge materialized coordinate list. */
export function parseFormulaReferences(formula:string,options:{sheetId:string;sheets:readonly FormulaSheetDescriptor[];cell?:string}):FormulaReferenceResult {
 const environment=descriptors(options.sheets);const sheet=environment.byId.get(options.sheetId);
 if(!sheet)fail('FORMULA_UNKNOWN_SHEET','The formula source sheet does not exist.',options.cell);
 return new ReferenceParser(formula,sheet,environment,options.cell).parse();
}
const coordinate=(sheetId:string,row:number,column:number)=>JSON.stringify([sheetId,row,column]);
/** Call before every engine execution and before accepting imported, saved or proposed workbook content. */
export function assertFormulaGraph(content:SpreadsheetContent):FormulaGraphStats {
 if(!content||content.kind!=='spreadsheet'||!record(content.workbook)||!record(content.workbook.sheets))fail('FORMULA_WORKBOOK','Invalid spreadsheet workbook.');
 const sheetEntries=Object.entries(content.workbook.sheets);
 const sheets:FormulaSheetDescriptor[]=sheetEntries.map(([id,sheet])=>({id,name:sheet?.name,rowCount:sheet?.rowCount,columnCount:sheet?.columnCount}));
 const environment=descriptors(sheets);
 const formulas=new Map<string,{formula:string;sheet:FormulaSheetDescriptor;row:number;column:number;label:string}>();
 let scanned=0,formulaCharacters=0;
 for(const [sheetId,source] of sheetEntries){
  const sheet=environment.byId.get(sheetId)!;
  if(source.cellData!=null&&!record(source.cellData))fail('FORMULA_WORKBOOK','Invalid cell data.');
  for(const [rowKey,row] of Object.entries(source.cellData??{})){
   if(!/^(0|[1-9][0-9]*)$/.test(rowKey)||!record(row))fail('FORMULA_WORKBOOK','Invalid cell row.');
   const r=Number(rowKey);if(r>=sheet.rowCount)fail('FORMULA_REFERENCE_BOUNDS','Cell row is outside its sheet.');
   for(const [columnKey,cell] of Object.entries(row)){
    if(++scanned>FORMULA_GRAPH_LIMITS.scannedCells)fail('FORMULA_LIMIT','Workbook cell scan limit exceeded.');
    if(!/^(0|[1-9][0-9]*)$/.test(columnKey))fail('FORMULA_WORKBOOK','Invalid cell column.');
    const c=Number(columnKey);if(c>=sheet.columnCount)fail('FORMULA_REFERENCE_BOUNDS','Cell column is outside its sheet.');
    if(cell==null)continue;if(!record(cell))fail('FORMULA_WORKBOOK','Invalid cell.');
    if(cell.f==null)continue;
    const at=label(sheet,r,c);
    if(typeof cell.f!=='string')fail('FORMULA_SYNTAX','Formula must be a string.',at);
    if(formulas.size>=FORMULA_GRAPH_LIMITS.formulas)fail('FORMULA_LIMIT','Workbook formula count limit exceeded.',at);
    formulaCharacters+=cell.f.length;if(formulaCharacters>FORMULA_GRAPH_LIMITS.formulaCharacters)fail('FORMULA_LIMIT','Workbook formula text limit exceeded.',at);
    formulas.set(coordinate(sheetId,r,c),{formula:cell.f,sheet,row:r,column:c,label:at});
   }
  }
 }
 // Index only formula cells. Repeated criteria ranges over source values must not
 // allocate millions of coordinates just to discover that they contain no formulas.
 const index=new Map<string,Map<number,Map<number,string>>>();
 for(const[key,item]of formulas){let columns=index.get(item.sheet.id);if(!columns){columns=new Map();index.set(item.sheet.id,columns);}let rows=columns.get(item.column);if(!rows){rows=new Map();columns.set(item.column,rows);}rows.set(item.row,key);}
 const sortedRows=new Map([...index].map(([id,columns])=>[id,new Map([...columns].map(([column,rows])=>[column,[...rows.keys()].sort((a,b)=>a-b)]))]));
 const lowerBound=(values:number[],target:number)=>{let start=0,end=values.length;while(start<end){const middle=(start+end)>>>1;if(values[middle]<target)start=middle+1;else end=middle;}return start;};
 const graph=new Map<string,string[]>(),subtotals=new Map<string,FormulaReference[]>();let expandedReferences=0,dependencyEdges=0,dependencyChecks=0;
 for(const [key,item] of formulas){
  const parsed=new ReferenceParser(item.formula,item.sheet,environment,item.label).parse();
  if(parsed.subtotalReferences)subtotals.set(key,parsed.subtotalReferences);
  expandedReferences+=parsed.expandedReferences;
  if(expandedReferences>FORMULA_GRAPH_LIMITS.expandedReferences)fail('FORMULA_LIMIT','Workbook formula calculation budget exceeded.',item.label);
  const targets=new Set<string>();
  for(const range of parsed.references){
   const columns=sortedRows.get(range.sheetId),byColumn=index.get(range.sheetId);
   for(let column=range.startColumn;column<=range.endColumn;column++){
    const rows=columns?.get(column)??[];
    for(let i=lowerBound(rows,range.startRow);i<rows.length&&rows[i]<=range.endRow;i++){
     if(++dependencyChecks>FORMULA_GRAPH_LIMITS.dependencyChecks)fail('FORMULA_LIMIT','Workbook dependency inspection budget exceeded.',item.label);
     targets.add(byColumn!.get(column)!.get(rows[i])!);
    }
   }
  }
  const edges=[...targets];dependencyEdges+=edges.length;
  if(dependencyEdges>FORMULA_GRAPH_LIMITS.dependencyEdges)fail('FORMULA_LIMIT','Workbook dependency edge limit exceeded.',item.label);
  graph.set(key,edges);
 }
 // Iterative DFS avoids JavaScript call-stack exhaustion for long dependency chains.
 const state=new Map<string,0|1|2>(),heights=new Map<string,number>();
 for(const start of formulas.keys()){
  if(state.get(start)===2)continue;
  const stack:Array<{key:string;next:number}>=[{key:start,next:0}];state.set(start,1);
  while(stack.length){
   const frame=stack[stack.length-1],edges=graph.get(frame.key)!;
   if(frame.next>=edges.length){const height=1+edges.reduce((max,key)=>Math.max(max,heights.get(key)??0),0);if(height>FORMULA_GRAPH_LIMITS.dependencyDepth)fail('FORMULA_LIMIT','Formula dependency chain is too deep.',formulas.get(frame.key)!.label);heights.set(frame.key,height);state.set(frame.key,2);stack.pop();continue;}
   const target=edges[frame.next++],color=state.get(target)??0;
   if(color===1){
    const position=stack.findIndex(value=>value.key===target);
    const cycle=[...stack.slice(position).map(value=>formulas.get(value.key)!.label),formulas.get(target)!.label];
    fail('FORMULA_CYCLE','Cyclic formula reference: '+cycle.slice(0,12).join(' → ')+(cycle.length>12?' …':''),formulas.get(target)!.label,{cycle:cycle.slice(0,100)});
   }
   if(color===0){state.set(target,1);stack.push({key:target,next:0});}
  }
 }
 // Bound this scan by the same already-checked reference budget, and inspect only
 // actual SUBTOTAL input ranges: another ordinary dependency may contain a subtotal.
 for(const [key,ranges] of subtotals)for(const range of ranges){
  const source=content.workbook.sheets[range.sheetId],filter=source.officeFilter?.range;
  if(record(filter)&&[filter.startRow,filter.endRow,filter.startColumn,filter.endColumn].every(Number.isInteger)
   &&filter.startRow<=range.endRow&&filter.endRow>=range.startRow)
   fail('FORMULA_UNSUPPORTED_FUNCTION','SUBTOTAL over filtered ranges is not supported by the spreadsheet engine.',formulas.get(key)!.label,{function:'SUBTOTAL'});
  for(let row=range.startRow;row<=range.endRow;row++){
   if(source.rowData?.[row]?.hd===1)
    fail('FORMULA_UNSUPPORTED_FUNCTION','SUBTOTAL over hidden rows is not supported by the spreadsheet engine.',formulas.get(key)!.label,{function:'SUBTOTAL'});
   for(let column=range.startColumn;column<=range.endColumn;column++){
    if(subtotals.has(coordinate(range.sheetId,row,column)))
     fail('FORMULA_UNSUPPORTED_FUNCTION','Nested SUBTOTAL references are not supported by the spreadsheet engine.',formulas.get(key)!.label,{function:'SUBTOTAL'});
   }
  }
 }
 return {formulaCount:formulas.size,expandedReferences,dependencyEdges};
}
