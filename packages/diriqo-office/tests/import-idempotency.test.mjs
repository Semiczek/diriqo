import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {importOfficeFile,exportXlsx} from '../src/server/formats.ts';
import {OfficeService} from '../src/server/service.ts';
import {SupabaseOfficeService} from '../src/server/supabase-service.ts';
import {MemoryStore} from '../src/server/store.ts';

const actor={tenantId:'00000000-0000-4000-8000-000000000001',
 actorId:'00000000-0000-4000-8000-000000000002',role:'owner',enabled:true,principal:'human'};
function xlsxBytes(){
 return exportXlsx({schemaVersion:1,kind:'spreadsheet',workbook:{
  id:'source-book',name:'Import regression',sheetOrder:['input','summary'],styles:{},
  sheets:{
   input:{id:'input',name:'Odhad',rowCount:1000,columnCount:26,
    cellData:{0:{0:{v:10,t:2},1:{v:20,t:2},2:{v:30,t:2,f:'=SUM(A1:B1)'}}}},
   summary:{id:'summary',name:'Souhrn',rowCount:1000,columnCount:26,
    cellData:{0:{0:{v:60,t:2,f:"='Odhad'!$C$1*2"}}}}
  }}}).bytes;
}
const cases=[
 {extension:'xlsx',bytes:xlsxBytes},
 {extension:'csv',bytes:()=>Buffer.from('Code;Value\r\n00123;10\r\n00124;20','utf8')}
];
async function inputFor(extension,bytes,key){
 // Parse afresh for EVERY upload, matching separate multipart/worker requests.
 const name='retry.'+extension;
 const imported=await importOfficeFile(name,Uint8Array.from(bytes));
 return {title:name,parentId:null,content:imported.content,
  original:{name,mime:imported.original.mime,bytes:Uint8Array.from(bytes)},idempotencyKey:key};
}
for(const {extension,bytes:makeBytes} of cases){
 test(extension+': two independently parsed uploads replay one file and preserve original/version',async()=>{
  const service=new OfficeService(new MemoryStore()),bytes=makeBytes(),key=randomUUID();
  const oneInput=await inputFor(extension,bytes,key),twoInput=await inputFor(extension,bytes,key);
  assert.notEqual(oneInput.content,twoInput.content);
  assert.deepEqual(twoInput.content,oneInput.content,'parser output must be stable across fresh executions');
  const one=await service.import(actor,oneInput),two=await service.import(actor,twoInput);
  assert.deepEqual(two,one,'retry returns the original response');
  assert.equal((await service.request(actor,{op:'list'})).files.length,1);
  const versions=(await service.request(actor,{op:'versions',id:one.file.id})).versions;
  assert.deepEqual(versions.map(version=>version.revision),[1]);
  assert.deepEqual(versions[0].content,oneInput.content);
  assert.deepEqual(Buffer.from((await service.original(actor,one.file.id)).bytes),bytes);
  // Identical imported workbook IDs are NOT a storage/deduplication key.
  const separate=await service.import(actor,await inputFor(extension,bytes,randomUUID()));
  assert.notEqual(separate.file.id,one.file.id);
  assert.equal((await service.request(actor,{op:'list'})).files.length,2);
 });
 test(extension+': same operation key still rejects changed bytes, content and metadata',async()=>{
  const service=new OfficeService(new MemoryStore()),bytes=makeBytes(),key=randomUUID();
  const input=await inputFor(extension,bytes,key);
  const accepted=await service.import(actor,input);
  const changedContent=structuredClone(input.content);
  const sheet=changedContent.workbook.sheets[changedContent.workbook.sheetOrder[0]];
  sheet.cellData[0][0].v='different parsed content';sheet.cellData[0][0].t=1;
  await assert.rejects(service.import(actor,{...input,content:changedContent}),error=>error.code==='IDEMPOTENCY_CONFLICT');
  // Keep identical parsed content while changing the original, proving that
  // receipt validation still covers source integrity independently of content IDs.
  await assert.rejects(service.import(actor,{...input,original:{...input.original,bytes:Buffer.from('different original bytes')}}),
   error=>error.code==='IDEMPOTENCY_CONFLICT');
  await assert.rejects(service.import(actor,{...input,title:'Changed title'}),
   error=>error.code==='IDEMPOTENCY_CONFLICT');
  const current=(await service.request(actor,{op:'read',id:accepted.file.id})).file;
  assert.equal(current.revision,1);assert.deepEqual(current.content,input.content);
  assert.deepEqual(Buffer.from((await service.original(actor,accepted.file.id)).bytes),bytes);
  assert.equal((await service.request(actor,{op:'list'})).files.length,1);
 });
 test(extension+': independently parsed imports produce byte-identical Supabase RPC bodies',async()=>{
  const captured=[];
  // Capture-only wire-contract test; this callback does not emulate PostgreSQL.
  const client={rpc:async(name,args)=>{captured.push({name,args:structuredClone(args)});return {data:{},error:null};}};
  const service=new SupabaseOfficeService(client),bytes=makeBytes(),key=randomUUID();
  await service.import(actor,await inputFor(extension,bytes,key));
  await service.import(actor,await inputFor(extension,bytes,key));
  assert.equal(captured.length,2);
  assert.equal(captured[0].name,'office_request');
  assert.equal(captured[0].args.p_company_id,actor.tenantId);
  assert.equal(captured[0].args.p_principal,'human');
  assert.equal(JSON.stringify(captured[0]),JSON.stringify(captured[1]),
   'PostgreSQL must receive exactly the same p_request on a retry');
  assert.equal(captured[0].args.p_request.original.base64,bytes.toString('base64'));
 });
}
