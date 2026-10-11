import type { Cell, Sheet } from '@fortune-sheet/core';
import type { SpreadsheetContent } from './types';
import {assertFormulaGraph} from './formula-graph.ts';
type Dict=Record<string,any>;
const MAX_ROWS=10000,MAX_COLS=256,MAX_GRID=2_000_000,MAX_POPULATED=100000;
const own=(value:any,key:string)=>Object.prototype.hasOwnProperty.call(value??{},key);
const int=(value:any,min:number,max:number,fallback=min)=>Number.isInteger(Number(value))&&Number(value)>=min&&Number(value)<=max?Number(value):fallback;
const color=(value:any):string|undefined=>{const v=typeof value==='string'?value:value?.rgb;return typeof v==='string'&&/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,20})$/i.test(v)?v:undefined;};
const safeText=(value:any,max=32767)=>typeof value==='string'?value.slice(0,max):'';
const primitive=(value:any):value is string|number|boolean=>['string','boolean'].includes(typeof value)||(typeof value==='number'&&Number.isFinite(value));
const fontNames=['Times New Roman','Arial','Tahoma','Verdana','Microsoft YaHei','SimSun','STHeiti','STKaiti','STFangsong','STSong','STXinwei','STXingkai','STLiti'];
function fontName(value:unknown):string|undefined {
 if(typeof value==='number'||typeof value==='string'&&/^\d+$/.test(value))return fontNames[Number(value)];
 return typeof value==='string'?value.slice(0,100):undefined;
}
/** Prevent network, external workbook, DDE and active formula primitives before the engine sees input. */
import {isOfficeFormulaSafe} from './formula-policy.ts';
export {isOfficeFormulaSafe} from './formula-policy.ts';
export function isFortuneInputSafe(value:unknown):boolean {
 if(typeof value==='string')return isOfficeFormulaSafe(value);
 if(value&&typeof value==='object'){const item=value as Dict;return isOfficeFormulaSafe(item.f)&&isOfficeFormulaSafe(item.v)&&!item.hl&&!item.spl;}
 return true;
}
function canonicalStyle(cell:Dict,book:Dict):Dict {return typeof cell.s==='string'?(book.styles?.[cell.s]??{}):(cell.s??{});}
function toCell(cell:Dict,book:Dict,formatter?:(format:string,value:any)=>unknown):Cell {
 const result:Dict={};if(!isOfficeFormulaSafe(cell.v))throw new Error('Active cell content is unsupported');if(primitive(cell.v))result.v=cell.v;
 if(typeof cell.f==='string'){if(!isOfficeFormulaSafe(cell.f))throw new Error('Unsafe spreadsheet formula');result.f=cell.f;}
 const style=canonicalStyle(cell,book);const format=style.n?.pattern;
 // Compute display from authoritative value/format; never trust a stale imported or AI-supplied cache.
 if(primitive(cell.v)){let display:unknown=cell.v;try{display=formatter?.(typeof format==='string'?format.slice(0,256):'General',cell.v)??cell.v;}catch{display=cell.v;}result.m=String(display).slice(0,32767);}
 result.ct={fa:typeof format==='string'?format.slice(0,256):'General',t:cell.t===1||typeof cell.v==='string'?'s':typeof cell.v==='boolean'?'b':typeof format==='string'&&/[dy]/i.test(format.replace(/"[^"]*"/g,''))?'d':'n'};
 for(const key of ['bl','it'])if(style[key]!=null)result[key]=style[key]?1:0;
 if(style.ul!=null)result.un=typeof style.ul==='object'?(style.ul.s?1:0):(style.ul?1:0);
 if(style.st!=null)result.cl=typeof style.st==='object'?(style.st.s?1:0):(style.st?1:0);
 const font=fontName(style.ff);if(font)result.ff=font;
 if(Number.isFinite(style.fs))result.fs=Math.min(200,Math.max(6,style.fs));
 if(color(style.cl))result.fc=color(style.cl);if(color(style.bg))result.bg=color(style.bg);
 if(style.ht!=null)result.ht=({1:1,2:0,3:2} as Dict)[style.ht]??1;
 if(style.vt!=null)result.vt=({1:1,2:0,3:2} as Dict)[style.vt]??0;
 if(style.tb!=null)result.tb=String(({1:1,2:0,3:2} as Dict)[style.tb]??0);
 return result as Cell;
}
function canonicalCellValue(cell:Cell):unknown {
 const value=cell.v;
 // Fortune's General input path may keep a numeric value as a string with ct.t='n'.
 // Only explicit numeric/date metadata permits coercion; never infer a type from text.
 if(typeof value!=='string'||!['n','d'].includes(cell.ct?.t??'')||cell.ct?.fa==='@'||(cell as Dict).qp===1)return value;
 const decimal=value.trim();
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(decimal))return value;
 const numeric=Number(decimal);return Number.isFinite(numeric)?numeric:value;
}
function fromCell(cell:Cell):Dict {
 const result:Dict={};let value=canonicalCellValue(cell);
 // Keep rich clipboard text while flattening unsupported per-character formatting.
 if(!primitive(value)&&cell.ct?.t==='inlineStr'&&Array.isArray(cell.ct.s))value=cell.ct.s.slice(0,32767).map((run:Dict)=>safeText(run.v)).join('').slice(0,32767);
 if(primitive(value)){result.v=typeof value==='string'?value.slice(0,32767):value;result.t=typeof value==='number'?2:typeof value==='boolean'?3:1;}
 if(typeof cell.f==='string'){if(!isOfficeFormulaSafe(cell.f))throw new Error('Unsafe spreadsheet formula');result.f=cell.f;}
 const style:Dict={};
 for(const key of ['bl','it'] as const)if(cell[key]!=null)style[key]=cell[key]?1:0;
 if(cell.un!=null)style.ul={s:cell.un?1:0};if(cell.cl!=null)style.st={s:cell.cl?1:0};
 const font=fontName(cell.ff);if(font)style.ff=font;
 if(Number.isFinite(cell.fs))style.fs=Math.min(200,Math.max(6,cell.fs!));
 if(color(cell.fc))style.cl={rgb:color(cell.fc)};if(color(cell.bg))style.bg={rgb:color(cell.bg)};
 if(cell.ht!=null)style.ht=({0:2,1:1,2:3} as Dict)[cell.ht]??1;
 if(cell.vt!=null)style.vt=({0:2,1:1,2:3} as Dict)[cell.vt]??2;
 if(cell.tb!=null)style.tb=({0:2,1:1,2:3} as Dict)[cell.tb]??2;
 if(typeof cell.ct?.fa==='string'&&cell.ct.fa!=='General')style.n={pattern:cell.ct.fa.slice(0,256)};
 if(Object.keys(style).length)result.s=style;
 return result;
}
const dimensions=(rows:number,cols:number)=>{
 if(!Number.isInteger(rows)||!Number.isInteger(cols)||rows<1||cols<1||rows>MAX_ROWS||cols>MAX_COLS||rows*cols>MAX_GRID)throw new Error('Spreadsheet exceeds editor limit (10,000 rows, 256 columns, 2,000,000 grid cells).');
};
function toFilter(sheet:Dict):Pick<Sheet,'filter'|'filter_select'> {
 const value=sheet.officeFilter;if(!value?.range)return {};
 const r=value.range;const range={row:[int(r.startRow,0,MAX_ROWS-1),int(r.endRow,0,MAX_ROWS-1)],column:[int(r.startColumn,0,MAX_COLS-1),int(r.endColumn,0,MAX_COLS-1)]};
 if(range.row[1]<range.row[0]||range.column[1]<range.column[0])return {};
 const filter:Dict={};
 for(const column of (Array.isArray(value.columns)?value.columns:[]).slice(0,MAX_COLS)){
  const index=int(column.index,0,MAX_COLS-1,-1);if(index<0)continue;
  const hidden:Dict={};for(const row of (Array.isArray(column.hiddenRows)?column.hiddenRows:[]).slice(0,MAX_ROWS)){if(Number.isInteger(row)&&row>=0&&row<MAX_ROWS)hidden[row]=0;}
  filter[index]={rowhidden:hidden,optionstate:true,cindex:index+1,str:range.row[0],edr:range.row[1],stc:range.column[0],edc:range.column[1],caljs:{}};
 }
 return {filter_select:range,filter};
}
export function toFortuneSheets(content:SpreadsheetContent,formatter?:(format:string,value:any)=>unknown):Sheet[] {
 assertFormulaGraph(content);
 const book=content.workbook;const order:Array<string>=Array.isArray(book.sheetOrder)?book.sheetOrder:Object.keys(book.sheets??{});
 if(!order.length||order.length>32)throw new Error('Workbook must contain 1 to 32 sheets.');
 let populated=0,totalGrid=0,mergeWork=0;const identities=new Set<string>();
 return order.map((id,index)=>{
  if(typeof id!=='string'||['__proto__','constructor','prototype'].includes(id)||identities.has(id)||!own(book.sheets,id))throw new Error('Invalid sheet identity');identities.add(id);
  const source=book.sheets[id] as Dict;
  const rows=Number(source.rowCount??200),cols=Number(source.columnCount??26);dimensions(rows,cols);
  if((totalGrid+=rows*cols)>MAX_GRID)throw new Error('Workbook total grid limit exceeded');
  const cells=new Map<string,{r:number;c:number;v:Cell}>();const borders:any[]=[];
  for(const [rkey,row] of Object.entries(source.cellData??{})){
   const r=int(rkey,0,MAX_ROWS-1,-1);if(r<0||r>=rows)throw new Error('Cell row outside sheet');
   for(const [ckey,value] of Object.entries(row as Dict)){
    const c=int(ckey,0,MAX_COLS-1,-1);if(c<0||c>=cols)throw new Error('Cell column outside sheet');if(value===null)continue;
    if(++populated>MAX_POPULATED)throw new Error('Spreadsheet cell limit exceeded');
    const cell=value as Dict;cells.set(r+'_'+c,{r,c,v:toCell(cell,book,formatter)});const bd=canonicalStyle(cell,book).bd;
    if(bd){const border:Dict={row_index:r,col_index:c};for(const edge of ['l','r','t','b'])if(bd[edge])border[edge]={style:int(bd[edge].s,0,13,1),color:color(bd[edge].cl)||'#000000'};borders.push({rangeType:'cell',value:border});}
   }
  }
  const merge:Dict={};
  for(const item of source.mergeData??[]){
   const r=int(item.startRow,0,rows-1),c=int(item.startColumn,0,cols-1),endR=int(item.endRow,r,rows-1,r),endC=int(item.endColumn,c,cols-1,c);
   const value={r,c,rs:endR-r+1,cs:endC-c+1};
   if((mergeWork+=value.rs*value.cs)>MAX_POPULATED)throw new Error('Merged cell expansion limit exceeded');
   merge[r+'_'+c]=value;
   for(let rr=r;rr<=endR;rr++)for(let cc=c;cc<=endC;cc++){
    const k=rr+'_'+cc;let entry=cells.get(k);
    if(!entry){if(++populated>MAX_POPULATED)throw new Error('Spreadsheet cell limit exceeded');entry={r:rr,c:cc,v:{}};}
    entry.v.mc=rr===r&&cc===c?value:{r,c};cells.set(k,entry);
   }
  }
  const config:NonNullable<Sheet['config']>={merge,borderInfo:borders,rowlen:{},columnlen:{},rowhidden:{},colhidden:{}};
  for(const [r,value] of Object.entries(source.rowData??{})){const n=int(r,0,rows-1,-1);if(n<0)continue;const v=value as Dict;if(Number.isFinite(v.h))config.rowlen![r]=Math.min(1000,Math.max(10,v.h));if(v.hd===1)config.rowhidden![r]=0;}
  for(const [c,value] of Object.entries(source.columnData??{})){const n=int(c,0,cols-1,-1);if(n<0)continue;const v=value as Dict;if(Number.isFinite(v.w))config.columnlen![c]=Math.min(2000,Math.max(10,v.w));if(v.hd===1)config.colhidden![c]=0;}
  const y=int(source.freeze?.ySplit??source.freeze?.startRow,0,rows-1),x=int(source.freeze?.xSplit??source.freeze?.startColumn,0,cols-1);
  const origin=merge['0_0'];
  const sheet:Sheet={id,name:safeText(source.name,100)||'Sheet '+(index+1),order:index,status:book.activeSheetId?Number(book.activeSheetId===id):Number(index===0),hide:source.hidden===1?1:0,row:rows,column:cols,celldata:[...cells.values()],config,showGridLines:source.showGridlines!==0,defaultRowHeight:Number(source.defaultRowHeight)||22,defaultColWidth:Number(source.defaultColumnWidth)||100,luckysheet_select_save:[{row:[0,origin?origin.rs-1:0],column:[0,origin?origin.cs-1:0],row_focus:0,column_focus:0}],...toFilter(source)};
  if(x||y)sheet.frozen={type:x&&y?'rangeBoth':y?'rangeRow':'rangeColumn',range:{row_focus:y,column_focus:x}};
  sheet.calcChain=[...cells.values()].filter(item=>item.v.f).map(item=>({r:item.r,c:item.c,id}));
  return sheet;
 });
}
function addBorder(sheet:Dict,r:number,c:number,edge:string,value:Dict|null){const row=sheet.cellData[r]??(sheet.cellData[r]={});const cell=row[c]??(row[c]={});const style=cell.s??(cell.s={});const borders=style.bd??(style.bd={});if(value)borders[edge]={s:int(value.style,0,13,1),cl:{rgb:color(value.color)||'#000000'}};else delete borders[edge];}
function applyBorders(sheet:Dict,items:any[]){
 let work=0;
 for(const item of (Array.isArray(items)?items:[]).slice(0,MAX_POPULATED)){
  if(item.rangeType==='cell'){const v=item.value??{};const r=int(v.row_index,0,sheet.rowCount-1,-1),c=int(v.col_index,0,sheet.columnCount-1,-1);if(r<0||c<0)continue;for(const e of ['l','r','t','b'])if(v[e])addBorder(sheet,r,c,e,v[e]);continue;}
  if(item.rangeType!=='range')continue;
  for(const range of (Array.isArray(item.range)?item.range:[]).slice(0,1000)){
   const r0=int(range.row?.[0],0,sheet.rowCount-1),r1=int(range.row?.[1],r0,sheet.rowCount-1,r0),c0=int(range.column?.[0],0,sheet.columnCount-1),c1=int(range.column?.[1],c0,sheet.columnCount-1,c0);
   if((work+=(r1-r0+1)*(c1-c0+1))>MAX_POPULATED)throw new Error('Border range limit exceeded');
   const type=item.borderType;
   for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)for(const edge of ['l','r','t','b']){
    const outer=edge==='l'?c===c0:edge==='r'?c===c1:edge==='t'?r===r0:r===r1;
    const apply=type==='border-none'||type==='border-all'||type==='border-outside'&&outer||type==='border-inside'&&!outer||type==='border-horizontal'&&['t','b'].includes(edge)&&!outer||type==='border-vertical'&&['l','r'].includes(edge)&&!outer||type==='border-'+({l:'left',r:'right',t:'top',b:'bottom'} as Dict)[edge]&&outer;
    if(apply)addBorder(sheet,r,c,edge,type==='border-none'?null:item);
   }
  }
 }
}
export function fromFortuneSheets(data:Sheet[],base:SpreadsheetContent):SpreadsheetContent {
 if(!Array.isArray(data)||!data.length||data.length>32)throw new Error('Invalid workbook sheet count');
 const ordered=[...data].sort((a,b)=>(a.order??0)-(b.order??0));const sheets:Dict=Object.create(null);let populated=0,totalGrid=0,finalCells=0,mergeWork=0;
 for(const [index,source] of ordered.entries()){
  const id=source.id||'sheet-'+index;if(['__proto__','constructor','prototype'].includes(id)||own(sheets,id))throw new Error('Invalid sheet identity');
  const rows=Math.max(source.row??1,source.data?.length??1);
  if(!Number.isInteger(rows)||rows<1||rows>MAX_ROWS)throw new Error('Spreadsheet row limit exceeded');
  let cols=source.column??1;for(const row of source.data??[])cols=Math.max(cols,row?.length??0);dimensions(rows,cols);
  if((totalGrid+=rows*cols)>MAX_GRID)throw new Error('Workbook total grid limit exceeded');
  const target:Dict={id,name:safeText(source.name,100)||'Sheet '+(index+1),rowCount:rows,columnCount:cols,cellData:{},rowData:{},columnData:{},mergeData:[],hidden:source.hide===1?1:0,showGridlines:source.showGridLines===false||source.showGridLines===0?0:1,defaultRowHeight:source.defaultRowHeight??22,defaultColumnWidth:source.defaultColWidth??100};
  const add=(r:number,c:number,value:Cell|null)=>{
   if(!value)return;if(!Number.isInteger(r)||!Number.isInteger(c)||r<0||r>=rows||c<0||c>=cols)throw new Error('Cell outside sheet');
   if(++populated>MAX_POPULATED)throw new Error('Spreadsheet cell limit exceeded');
   const cell=fromCell(value);if(Object.keys(cell).length)(target.cellData[r]??={})[c]=cell;
  };
  if(source.data?.length)source.data.forEach((row,r)=>row?.forEach((value,c)=>add(r,c,value)));else for(const cell of source.celldata??[])add(cell.r,cell.c,cell.v);
  const config=source.config??{};
  for(const item of Object.values(config.merge??{})){
   const r=int(item.r,0,rows-1),c=int(item.c,0,cols-1),rs=int(item.rs,1,rows-r,1),cs=int(item.cs,1,cols-c,1);
   if((mergeWork+=rs*cs)>MAX_POPULATED)throw new Error('Merged cell expansion limit exceeded');
   target.mergeData.push({startRow:r,endRow:r+rs-1,startColumn:c,endColumn:c+cs-1});
  }
  for(const [r,h] of Object.entries(config.rowlen??{}))if(/^\d+$/.test(r)&&Number(r)<rows&&Number.isFinite(h))target.rowData[r]={h:Math.min(1000,Math.max(10,h))};
  for(const r of Object.keys(config.rowhidden??{}))if(/^\d+$/.test(r)&&Number(r)<rows)(target.rowData[r]??={}).hd=1;
  for(const [c,w] of Object.entries(config.columnlen??{}))if(/^\d+$/.test(c)&&Number(c)<cols&&Number.isFinite(w))target.columnData[c]={w:Math.min(2000,Math.max(10,w))};
  for(const c of Object.keys(config.colhidden??{}))if(/^\d+$/.test(c)&&Number(c)<cols)(target.columnData[c]??={}).hd=1;
  const frozen=source.frozen;let x=0,y=0;
  if(frozen){const type=frozen.type;if(type==='row'||type==='both')y=1;if(type==='column'||type==='both')x=1;if(type==='rangeRow'||type==='rangeBoth')y=int(frozen.range?.row_focus,0,rows-1);if(type==='rangeColumn'||type==='rangeBoth')x=int(frozen.range?.column_focus,0,cols-1);}
  target.freeze={xSplit:x,ySplit:y,startRow:y,startColumn:x};
  if(source.filter_select?.row?.length===2&&source.filter_select?.column?.length===2){const r=source.filter_select;target.officeFilter={range:{startRow:int(r.row[0],0,rows-1),endRow:int(r.row[1],0,rows-1),startColumn:int(r.column[0],0,cols-1),endColumn:int(r.column[1],0,cols-1)},columns:Object.entries(source.filter??{}).filter(([k])=>/^\d+$/.test(k)&&Number(k)<cols).map(([k,v])=>({index:Number(k),hiddenRows:Object.keys(v.rowhidden??{}).filter(r=>/^\d+$/.test(r)&&Number(r)<rows).map(Number)}))};}
  applyBorders(target,config.borderInfo??[]);
  for(const row of Object.values(target.cellData)){finalCells+=Object.keys(row as Dict).length;if(finalCells>MAX_POPULATED)throw new Error('Spreadsheet styled cell limit exceeded');}
  sheets[id]=target;
 }
 const ids=ordered.map((s,i)=>s.id||'sheet-'+i);const active=ordered.find(s=>s.status===1)?.id||ids[0];
 const result:SpreadsheetContent={schemaVersion:1,kind:'spreadsheet',workbook:{...base.workbook,id:base.workbook.id||crypto.randomUUID(),sheetOrder:ids,sheets,styles:{},activeSheetId:active}};
 assertFormulaGraph(result);return result;
}
