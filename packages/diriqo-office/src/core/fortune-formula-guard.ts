import {assertFormulaGraph} from './formula-graph.ts';
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
   sheets[id]={id,name:file.name,rowCount:file.row??file.data?.length??200,columnCount:file.column??file.data?.[0]?.length??26,cellData:cells};
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
  try{assertFormulaGraph({schemaVersion:1,kind:'spreadsheet',workbook:{id:'engine',name:'Engine',sheetOrder:order,sheets}} as SpreadsheetContent);}
  catch(error){const code=String((error as any)?.code??'');failure=/CYCLE/.test(code)?'#CYCLE!':/LIMIT|RANGE|BOUNDS/.test(code)?'#OFFICE_LIMIT!':'#OFFICE_BLOCKED!';}
  lastSignature=signature;lastError=failure;return failure;
 }catch{return '#OFFICE_LIMIT!';}
}
