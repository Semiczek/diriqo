import {assertFormulaGraph} from './formula-graph.ts';
import {formulaGraphRequiresPreview} from './spreadsheet-execution.ts';
import {isOfficeFormulaSafe} from './formula-policy.ts';
import type {SpreadsheetContent} from './types.ts';

/** Called inside the audited OSS calculation entrypoint, including paste/fill paths.
 * Only formula metadata is inspected. No cached financial values are trusted.
 */
let lastSignature='';
let lastError:string|null=null;
export function guardFortuneCalculation(ctx:any,formula:string,row?:number,column?:number,sheetId?:string):string|null {
 try {
  if(!isOfficeFormulaSafe(formula))return '#OFFICE_BLOCKED!';
  const files=ctx.luckysheetfile;if(!Array.isArray(files)||!files.length||files.length>32)return '#OFFICE_LIMIT!';
  const active=sheetId??ctx.currentSheetId;const sheets:Record<string,any>=Object.create(null);const order:string[]=[];let count=0;
  for(const file of files){
   const id=String(file.id);order.push(id);
   const cells:Record<string,any>=Object.create(null);
   const put=(r:number,c:number,f:unknown)=>{if(typeof f!=='string'||!f.startsWith('='))return;if(++count>2001)throw Error('Formula count limit');(cells[r]??=Object.create(null))[c]={f};};
   // calcChain is maintained by the engine; the candidate is checked before insertion.
   for(const item of file.calcChain??[]){const cell=file.data?.[item.r]?.[item.c]??file.celldata?.find((v:any)=>v.r===item.r&&v.c===item.c)?.v;put(item.r,item.c,cell?.f);}
   if(id===active&&Number.isInteger(row)&&Number.isInteger(column))put(row!,column!,formula);
   const rowCount=file.row??file.data?.length??200,columnCount=file.column??file.data?.[0]?.length??26;
   const rowData:Record<string,{hd:number}>=Object.create(null);
   for(const key of Object.keys(file.config?.rowhidden??{})){
    if(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=rowCount||Number(key)>=10000)throw Error('Invalid hidden row');
    rowData[key]={hd:1};
   }
   const selected=file.filter_select;let officeFilter;
   if(selected){
    const r=selected.row,c=selected.column;
    if(!Array.isArray(r)||r.length!==2||!Array.isArray(c)||c.length!==2
     ||![...r,...c].every(Number.isInteger)||r[0]<0||r[1]<r[0]||r[1]>=rowCount||r[1]>=10000
     ||c[0]<0||c[1]<c[0]||c[1]>=columnCount||c[1]>=256)throw Error('Invalid filter range');
    officeFilter={range:{startRow:r[0],endRow:r[1],startColumn:c[0],endColumn:c[1]},columns:[]};
   }
   sheets[id]={id,name:file.name,rowCount,columnCount,cellData:cells,rowData,...(officeFilter?{officeFilter}:{})};
  }
  if(!Object.hasOwn(sheets,active))return '#REF!';
  // Formula preview calls without coordinates still need the same reference/function limits.
  if(!Number.isInteger(row)||!Number.isInteger(column)){
   const cells=sheets[active].cellData;let r=0,c=0;
   while(cells[r]?.[c]){if(++c>=sheets[active].columnCount){c=0;r++;}if(r>=sheets[active].rowCount)return '#OFFICE_LIMIT!';}
   (cells[r]??=Object.create(null))[c]={f:formula};
  }
  const signature=JSON.stringify(sheets);
  if(signature===lastSignature)return lastError;
  let failure:string|null=null;
  try{const stats=assertFormulaGraph({schemaVersion:1,kind:'spreadsheet',workbook:{id:'engine',name:'Engine',sheetOrder:order,sheets}} as SpreadsheetContent);if(formulaGraphRequiresPreview(stats))failure='#OFFICE_LIMIT!';}
  catch(error){const code=String((error as any)?.code??'');failure=/CYCLE/.test(code)?'#CYCLE!':/LIMIT|RANGE|BOUNDS/.test(code)?'#OFFICE_LIMIT!':'#OFFICE_BLOCKED!';}
  lastSignature=signature;lastError=failure;return failure;
 }catch{return '#OFFICE_LIMIT!';}
}
