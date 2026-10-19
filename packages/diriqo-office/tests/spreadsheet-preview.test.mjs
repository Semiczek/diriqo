import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {OfficeService} from '../src/server/service.ts';import {SupabaseOfficeService} from '../src/server/supabase-service.ts';import {MemoryStore} from '../src/server/store.ts';
import {blankSpreadsheet} from '../src/core/templates.ts';import {validateContent,validateRequest} from '../src/core/validation.ts';
import {CACHED_PREVIEW_MODE,isSpreadsheetCachedPreview} from '../src/core/spreadsheet-execution.ts';
import {exportXlsx,importXlsx} from '../src/server/formats.ts';import {guardFortuneCalculation} from '../src/core/fortune-formula-guard.ts';
const actor={tenantId:'preview-test',actorId:'owner',role:'owner',enabled:true,principal:'human'};
const snapshot=()=>{const book=blankSpreadsheet();book.workbook.officeCalculationMode=CACHED_PREVIEW_MODE;book.workbook.sheets['sheet-1'].cellData={0:{0:{f:'=IF(1=1,"saved",0)',v:'saved',t:1}}};return book;};

test('snapshot metadata is validated and survives storage, copy and original download',async()=>{
 const service=new OfficeService(new MemoryStore()),book=snapshot(),original=exportXlsx(book).bytes;
 const {file}=await service.import(actor,{title:'Synthetic',content:book,original:{name:'synthetic.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes:original},idempotencyKey:randomUUID()});
 const read=await service.request(actor,{op:'read',id:file.id});assert.equal(isSpreadsheetCachedPreview(read.file.content),true);
 const copied=await service.request(actor,{op:'copy',id:file.id,title:'Copy',idempotencyKey:randomUUID()});assert.deepEqual(copied.file.content,book);assert.deepEqual(Buffer.from((await service.original(actor,copied.file.id)).bytes),original);
 const changed=blankSpreadsheet();for(const op of ['save','propose','approve','restore']){
  const request={op,id:file.id,expectedRevision:1,idempotencyKey:randomUUID(),...(op==='save'||op==='propose'?{content:changed}:{}),...(op==='propose'?{summary:'No change'}:{}),...(op==='approve'?{proposalId:'pending'}:{}),...(op==='restore'?{revision:1}:{})};
  await assert.rejects(service.request(actor,request),error=>error.code==='SPREADSHEET_PREVIEW_ONLY');
 }
 assert.deepEqual((await service.request(actor,{op:'read',id:file.id})).file.content,book);
 assert.equal((await service.request(actor,{op:'versions',id:file.id})).versions.length,1);
 const invalid=snapshot();invalid.workbook.officeCalculationMode='interactive';assert.throws(()=>validateContent(invalid),error=>error.code==='INVALID_CONTENT');
});

test('host RPC adapter rejects edits even when caller removes snapshot metadata',async()=>{
 const calls=[];const service=new SupabaseOfficeService({rpc:async(_name,args)=>{calls.push(args);return {error:null,data:{file:{id:'file-1',content:snapshot(),revision:1}}};}});
 await assert.rejects(service.request(actor,{op:'save',id:'file-1',expectedRevision:1,content:blankSpreadsheet(),idempotencyKey:randomUUID()}),error=>error.code==='SPREADSHEET_PREVIEW_ONLY');
 assert.deepEqual(calls.map(x=>x.p_request.op),['read']);assert.equal(calls[0].p_company_id,actor.tenantId);
});

test('direct oversized drafts are rejected while import remains a persistent cached snapshot',()=>{
 const book=blankSpreadsheet(),sheet=book.workbook.sheets['sheet-1'];sheet.rowCount=3000;sheet.cellData={};
 for(let row=0;row<2001;row++)sheet.cellData[row]={0:{f:'=1+1',v:2,t:2}};
 assert.equal(isSpreadsheetCachedPreview(book),true);assert.throws(()=>validateRequest({op:'save',id:'file-1',expectedRevision:1,content:book,idempotencyKey:randomUUID()}),error=>error.code==='SPREADSHEET_PREVIEW_ONLY');
 const imported=importXlsx(exportXlsx(book).bytes).content;assert.equal(imported.workbook.officeCalculationMode,CACHED_PREVIEW_MODE);
 const restored=importXlsx(exportXlsx(imported).bytes).content;assert.equal(isSpreadsheetCachedPreview(restored),true);assert.equal(Object.keys(restored.workbook.sheets[restored.workbook.sheetOrder[0]].cellData).length,2001);
});

test('runtime still refuses an expensive criteria graph even below the formula-count cap',()=>{
 const file={id:'main',name:'Main',row:10000,column:26,data:[],calcChain:[]};
 for(let row=0;row<201;row++){file.data[row]=[{f:'=COUNTIF(B1:B1000,"A")'}];file.calcChain.push({r:row,c:0,id:'main'});}
 assert.equal(guardFortuneCalculation({currentSheetId:'main',luckysheetfile:[file]},file.data[0][0].f,0,0,'main'),'#OFFICE_LIMIT!');
});