// Local, read-only diagnostic. Arguments are user-selected XLSX paths; no data or formulas are printed.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {importXlsx,exportXlsx} from '../src/server/formats.ts';
import {validateContent} from '../src/core/validation.ts';
import {assertFormulaGraph} from '../src/core/formula-graph.ts';
import {toFortuneSheets} from '../src/core/fortune-adapter.ts';
import {guardFortuneCalculation} from '../src/core/fortune-formula-guard.ts';
import {isSpreadsheetCachedPreview} from '../src/core/spreadsheet-execution.ts';
const {Parser}=createRequire(import.meta.url)('@fortune-sheet/formula-parser');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const filename of process.argv.slice(2).filter(value=>!value.startsWith('--'))){
 const bytes=fs.readFileSync(filename),before=hash(bytes),start=performance.now();
 const imported=importXlsx(bytes),content=validateContent(imported.content),importMs=Math.round(performance.now()-start);
 const graph=assertFormulaGraph(content),sheets=Object.values(content.workbook.sheets),byName=new Map(sheets.map(s=>[s.name.toLowerCase(),s]));
 const formulaCells=sheets.flatMap(s=>Object.entries(s.cellData).flatMap(([r,row])=>Object.entries(row).filter(([,c])=>c?.f).map(([c,cell])=>({sheet:s,row:Number(r),column:Number(c),cell}))));
 const cache=new Map(),parsers=new Map(),errors={};let cachedComparisons=0,mismatches=0;
 const get=(sheet,row,column)=>{
  const cell=sheet.cellData[row]?.[column];if(!cell?.f)return cell?.v??null;
  const key=sheet.id+':'+row+':'+column;if(cache.has(key))return cache.get(key);
  const parser=parsers.get(sheet.id),result=parser.parse(cell.f.slice(1));
  if(result.error)errors[result.error]=(errors[result.error]??0)+1;
  cache.set(key,result.error??result.result);return result.error??result.result;
 };
 for(const sheet of sheets){const parser=new Parser();parsers.set(sheet.id,parser);
  const target=ref=>ref.sheetName?byName.get(ref.sheetName.toLowerCase()):sheet;
  parser.on('callCellValue',(ref,_options,done)=>done(get(target(ref),ref.row.index,ref.column.index)));
  parser.on('callRangeValue',(first,last,_options,done)=>{const values=[];for(let row=first.row.index;row<=last.row.index;row++){const line=[];for(let column=first.column.index;column<=last.column.index;column++)line.push(get(target(first),row,column));values.push(line);}done(values);});
 }
 const preview=isSpreadsheetCachedPreview(content),calculate=!preview||process.argv.includes('--calculate-preview');
 const calculationStart=performance.now();
 if(calculate)for(const item of formulaCells){const value=get(item.sheet,item.row,item.column);if(item.cell.v!==null&&item.cell.v!==undefined){cachedComparisons++;const equal=typeof value==='number'&&typeof item.cell.v==='number'?Math.abs(value-item.cell.v)<=Math.max(1,Math.abs(item.cell.v))*1e-8:value===item.cell.v;if(!equal)mismatches++;}}
 const calculationMs=Math.round(performance.now()-calculationStart);
 // Exercise the exact runtime guard with the same dense data representation as Fortune.
 const files=toFortuneSheets(content);for(const file of files){file.data=[];for(const entry of file.celldata)(file.data[entry.r]??=[])[entry.c]=entry.v;}
 const ctx={currentSheetId:files[0].id,luckysheetfile:files},guardStart=performance.now();let guardErrors=0;
 if(calculate&&!preview)for(const item of formulaCells)if(guardFortuneCalculation(ctx,item.cell.f,item.row,item.column,item.sheet.id)!==null)guardErrors++;
 const previewEngineBlocked=preview&&formulaCells.length?guardFortuneCalculation(ctx,formulaCells[0].cell.f,formulaCells[0].row,formulaCells[0].column,formulaCells[0].sheet.id)==='#OFFICE_LIMIT!':null;
 const guardMs=Math.round(performance.now()-guardStart);
 const roundtrip=validateContent(importXlsx(exportXlsx(content).bytes).content);
 const formulas=wb=>Object.values(wb.workbook.sheets).map(s=>Object.entries(s.cellData).flatMap(([r,row])=>Object.entries(row).filter(([,c])=>c?.f).map(([c,cell])=>[r,c,cell.f,cell.v])));
 if(JSON.stringify(formulas(content))!==JSON.stringify(formulas(roundtrip)))throw Error('Formula roundtrip mismatch');
 if(hash(fs.readFileSync(filename))!==before)throw Error('Source file changed');
 console.log(JSON.stringify({file:path.basename(filename),sha256:before,sourceUnchanged:true,sheets:sheets.length,bytes:Buffer.byteLength(JSON.stringify(content)),graph,preview,calculate,previewEngineBlocked,importMs,calculationMs,guardMs,guardErrors,formulaEngineErrors:errors,cachedComparisons,cachedMismatches:mismatches,formulaRoundtrip:true,warnings:imported.warnings.length}));
 if(guardErrors||Object.keys(errors).length||preview&&!previewEngineBlocked)process.exitCode=1;
}