// These are unit tests of the orchestrator, NOT evidence of PostgreSQL concurrency.
// Actual staging evidence must come from runRaceTests with separate authenticated REST requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {runRaceTests} from '../scripts/staging-races.mjs';

const actors={
 ownerA:{tenantId:'tenant-a',principal:'human',id:'owner-a',role:'owner'},
 editorA:{tenantId:'tenant-a',principal:'human',id:'editor-a',role:'editor'},
 ownerB:{tenantId:'tenant-b',principal:'human',id:'owner-b',role:'owner'}
};
const clone=value=>structuredClone(value);
function transport({ignoreCas=false,ignoreFingerprint=false,omitInitialVersion=false,rejectSave=false}={}){
 let id=0,active=0,maxActive=0,settledSaves=0,requests=0;
 const files=new Map(),receipts=new Map(),locks=new Map();
 async function serialized(tenant,fn){
  const previous=locks.get(tenant)||Promise.resolve();
  let release;
  const current=new Promise(resolve=>{release=resolve;});
  locks.set(tenant,current);
  await previous;
  try{return fn();}finally{release();}
 }
 const fail=errorCode=>({status:409,errorCode,data:null});
 async function request(actor,body){
  requests++;
  if(body.op==='save'){
   active++;maxActive=Math.max(maxActive,active);
   try{
    // Force an asynchronous dispatch window so tests can detect an accidentally sequential runner.
    await tick();
    if(rejectSave&&body.content.doc.content[0].content[0].text.startsWith('Owner candidate'))throw Error('simulated network failure');
    return await serialized(actor.tenantId,()=>perform(actor,body));
   }finally{active--;settledSaves++;}
  }
  return perform(actor,body);
 }
 function perform(actor,body){
  const receiptKey=actor.tenantId+':'+actor.id+':'+body.idempotencyKey;
  const fingerprint=JSON.stringify(body);
  if(body.idempotencyKey&&receipts.has(receiptKey)){
   const receipt=receipts.get(receiptKey);
   if(receipt.fingerprint!==fingerprint&&!ignoreFingerprint)return fail('IDEMPOTENCY_CONFLICT');
   return clone(receipt.response);
  }
  let data;
  if(body.op==='create'){
   const file={id:'file-'+(++id),tenantId:actor.tenantId,ownerId:actor.id,title:body.title,
    kind:body.kind,revision:1,content:clone(body.content)};
   files.set(file.id,{file,versions:[{revision:1,content:clone(body.content)}]});
   data={file:clone(file)};
  }else{
   const state=files.get(body.id);
   if(!state||state.file.tenantId!==actor.tenantId)return fail('NOT_FOUND');
   if(body.op==='permissions')data={permissions:{role:actor.role,canWrite:true,ownerId:state.file.ownerId}};
   else if(body.op==='read')data={file:clone(state.file)};
   else if(body.op==='versions')data={versions:clone(omitInitialVersion?state.versions.slice(1):state.versions)};
   else if(body.op==='save'){
    if(!ignoreCas&&body.expectedRevision!==state.file.revision)return fail('CONFLICT');
    state.file.revision++;state.file.content=clone(body.content);
    state.versions.push({revision:state.file.revision,content:clone(body.content)});
    data={file:clone(state.file)};
   }else throw Error('Unexpected test operation '+body.op);
  }
  const response={status:200,errorCode:null,data};
  if(body.idempotencyKey)receipts.set(receiptKey,{fingerprint,response:clone(response)});
  return response;
 }
 return {request,stats:()=>({requests,maxActive,settledSaves,files:files.size})};
}
test('race orchestrator waits for async checks and dispatches all four races concurrently',async()=>{
 const fake=transport();const checks=[];
 const report=await runRaceTests({request:fake.request,actors,check:async(label,passed)=>{
  await tick();checks.push({label,passed});assert.equal(passed,true,label);
 }});
 assert.equal(report.races.length,4);
 assert.equal(report.files.length,5);
 assert.equal(new Set(report.files.map(file=>file.id)).size,5);
 assert.ok(report.checks.length>=60);
 assert.deepEqual(report.checks,checks);
 assert.ok(fake.stats().maxActive>=2,'both mutation requests must start before one resolves');
 assert.equal(fake.stats().settledSaves,9,'eight race saves plus winner receipt replay');
 assert.equal(fake.stats().files,5,'runner creates only its identified fixtures and never deletes');
 assert.ok(report.finishedAt);
 assert.equal(JSON.stringify(report).includes('"principal"'),false,'opaque actors must not be serialized into evidence');
});
test('race orchestrator rejects an invalid two-company actor setup before any request',async()=>{
 const fake=transport();
 await assert.rejects(runRaceTests({request:fake.request,actors:{...actors,ownerB:{...actors.ownerB,tenantId:'tenant-a'}},check(){}}),/different tenant/);
 assert.equal(fake.stats().requests,0);
 await assert.rejects(runRaceTests({request:fake.request,actors:{...actors,editorA:{...actors.editorA,principal:'ai'}},check(){}}),/human actor/);
 assert.equal(fake.stats().requests,0);
});
test('race orchestrator cannot report success when stale writes overwrite each other',async()=>{
 const fake=transport({ignoreCas:true});
 await assert.rejects(runRaceTests({request:fake.request,actors,check(){}}),error=>{
  assert.match(error.message,/exactly one success/);
  assert.equal(error.stagingRaceReport.files.length,5);
  assert.equal(error.stagingRaceReport.races.length,1);
  assert.equal(error.stagingRaceReport.checks.at(-1).passed,false);
  return true;
 });
});
test('race orchestrator detects an idempotency implementation that ignores changed payloads',async()=>{
 const fake=transport({ignoreFingerprint:true});
 await assert.rejects(runRaceTests({request:fake.request,actors,check(){}}),error=>{
  assert.match(error.message,/different-payload-key: exactly one success/);
  assert.equal(error.stagingRaceReport.races.length,3);
  return true;
 });
});
test('race orchestrator detects missing version history',async()=>{
 const fake=transport({omitInitialVersion:true});
 await assert.rejects(runRaceTests({request:fake.request,actors,check(){}}),/exactly revisions 1 and 2/);
});
test('race orchestrator waits for both attempted saves after a transport failure',async()=>{
 const fake=transport({rejectSave:true});
 await assert.rejects(runRaceTests({request:fake.request,actors,check(){}}),error=>{
  assert.match(error.message,/transport completed/);
  assert.equal(fake.stats().settledSaves,2);
  assert.equal(error.stagingRaceReport.races[0].calls.filter(call=>call.errorCode==='TRANSPORT_ERROR').length,1);
  return true;
 });
});

