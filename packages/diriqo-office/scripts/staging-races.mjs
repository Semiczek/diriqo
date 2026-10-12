/**
 * Dependency-free concurrency scenarios for the guarded staging orchestrator.
 * This module accepts no URL, JWT, environment configuration or network target.
 * Only the supplied request(actor, body) may perform network I/O.
 *
 * request must send each invocation as a separate REST request using that actor's
 * JWT and tenantId, enforce its own timeout, and return {data,status,errorCode}.
 * It must not serialize requests or retry failed mutations internally.
 * check(label, boolean) may be synchronous or asynchronous.
 *
 * Test documents are created only when runRaceTests is explicitly called.
 * Nothing is deleted automatically. Returned file IDs identify these fixtures.
 * A Promise barrier synchronizes client dispatch; server request overlap still
 * depends on network scheduling. This is not proof of a particular lock schedule.
 */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

function document(text){
 return {schemaVersion:1,kind:'document',page:{marginMm:20,header:'',footer:''},
  doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]}};
}
function success(result){
 return Number.isInteger(result?.status)&&result.status>=200&&result.status<300
  &&!result.errorCode&&result.data!==null&&result.data!==undefined;
}
function summary(call){
 return {actor:call.actor,status:call.result?.status??0,errorCode:call.result?.errorCode??null,
  fileId:call.result?.data?.file?.id??null,revision:call.result?.data?.file?.revision??null};
}

export async function runRaceTests({request,actors,check}={}){
 if(typeof request!=='function'||typeof check!=='function')throw new TypeError('request and check functions are required.');
 for(const name of ['ownerA','editorA','ownerB']){
  if(!actors?.[name]||typeof actors[name].tenantId!=='string'||!actors[name].tenantId
   ||actors[name].principal!=='human')throw new TypeError(name+' must identify a human actor with tenantId.');
 }
 if(actors.ownerA.tenantId!==actors.editorA.tenantId||actors.ownerA.tenantId===actors.ownerB.tenantId)
  throw new TypeError('ownerA/editorA must share tenant A; ownerB must belong to a different tenant B.');

 const runId=randomUUID();
 const report={runId,startedAt:new Date().toISOString(),finishedAt:null,
  scope:'guarded staging REST, barrier-dispatched requests',files:[],races:[],checks:[]};
 let keyNumber=0;
 const key=()=> 'staging-'+runId+'-'+(++keyNumber);
 async function verify(label,condition){
  const passed=condition===true;
  report.checks.push({label,passed});
  await check(label,passed);
  if(!passed)throw new Error('Staging race assertion failed: '+label);
 }
 async function send(actor,body){
  // Clone so a transport cannot mutate a later retry's request or a peer payload.
  return await request(actors[actor],structuredClone(body));
 }
 async function create(actor,name){
  const initial=document('Staging '+runId+' / '+name+' / initial');
  const title='Office staging '+runId+' / '+name;
  const response=await send(actor,{op:'create',title,kind:'document',content:initial,idempotencyKey:key()});
  const file=response?.data?.file;
  // Record a returned ID before assertions, so a failed run still identifies its fixtures.
  if(typeof file?.id==='string')report.files.push({case:name,actor,tenantId:actors[actor].tenantId,id:file.id,title});
  await verify(name+': fixture created',success(response)&&typeof file?.id==='string'&&file.id.length>0);
  await verify(name+': initial tenant and revision',file.tenantId===actors[actor].tenantId&&file.revision===1);
  await verify(name+': initial content preserved',isDeepStrictEqual(file.content,initial));
  return {file,initial};
 }
 async function race(name,jobs){
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const pending=jobs.map(async job=>{
   await gate;
   try{return {...job,result:await send(job.actor,job.body)};}
   catch{return {...job,result:{status:0,data:null,errorCode:'TRANSPORT_ERROR'}};}
  });
  // All participants are waiting on the same gate before any request is dispatched.
  release();
  const calls=await Promise.all(pending);
  report.races.push({name,calls:calls.map(summary)});
  await verify(name+': transport completed',calls.every(call=>call.result.errorCode!=='TRANSPORT_ERROR'));
  return calls;
 }
 async function currentAndVersions(name,actor,fixture,expected){
  const read=await send(actor,{op:'read',id:fixture.file.id});
  await verify(name+': persisted revision is exactly 2',success(read)&&read.data?.file?.revision===2);
  await verify(name+': persisted tenant and file identity',read.data.file.id===fixture.file.id&&read.data.file.tenantId===actors[actor].tenantId);
  await verify(name+': persisted content equals accepted payload',isDeepStrictEqual(read.data.file.content,expected));
  const history=await send(actor,{op:'versions',id:fixture.file.id});
  await verify(name+': versions readable',success(history)&&Array.isArray(history.data?.versions));
  const versions=history.data.versions;
  await verify(name+': exactly revisions 1 and 2',isDeepStrictEqual(versions.map(version=>version.revision),[1,2]));
  await verify(name+': version 1 is immutable',isDeepStrictEqual(versions[0].content,fixture.initial));
  await verify(name+': version 2 is accepted payload',isDeepStrictEqual(versions[1].content,expected));
 }
 function save(fixture,content,idempotencyKey){
  return {op:'save',id:fixture.file.id,expectedRevision:1,content,idempotencyKey};
 }
 try{
  const cas=await create('ownerA','competing-save');
  const duplicate=await create('editorA','duplicate-key');
  const collision=await create('ownerA','different-payload-key');
  const tenantA=await create('ownerA','parallel-tenant-A');
  const tenantB=await create('ownerB','parallel-tenant-B');
  await verify('independent human identities in tenant A',typeof cas.file.ownerId==='string'
   &&typeof duplicate.file.ownerId==='string'&&cas.file.ownerId!==duplicate.file.ownerId);
  const ownerPermissions=await send('ownerA',{op:'permissions',id:cas.file.id});
  const editorPermissions=await send('editorA',{op:'permissions',id:cas.file.id});
  const ownerBPermissions=await send('ownerB',{op:'permissions',id:tenantB.file.id});
  await verify('owner A role and write permission',success(ownerPermissions)
   &&ownerPermissions.data?.permissions?.role==='owner'&&ownerPermissions.data.permissions.canWrite===true);
  await verify('editor A role and write permission',success(editorPermissions)
   &&editorPermissions.data?.permissions?.role==='editor'&&editorPermissions.data.permissions.canWrite===true);
  await verify('owner B role and write permission',success(ownerBPermissions)
   &&ownerBPermissions.data?.permissions?.role==='owner'&&ownerBPermissions.data.permissions.canWrite===true);

  const competing=await race('competing-save',[
   {actor:'ownerA',body:save(cas,document('Owner candidate '+runId),key())},
   {actor:'editorA',body:save(cas,document('Editor candidate '+runId),key())}
  ]);
  const winning=competing.filter(call=>success(call.result));
  await verify('competing-save: exactly one success',winning.length===1);
  await verify('competing-save: exactly one CONFLICT',competing.filter(call=>!success(call.result)&&call.result.errorCode==='CONFLICT').length===1);
  await verify('competing-save: winner response revision 2',winning[0].result.data?.file?.revision===2);
  await currentAndVersions('competing-save','ownerA',cas,winning[0].body.content);

  const duplicateBody=save(duplicate,document('Identical retry '+runId),key());
  const duplicates=await race('duplicate-key',[
   {actor:'editorA',body:duplicateBody},{actor:'editorA',body:duplicateBody}
  ]);
  await verify('duplicate-key: both requests succeed',duplicates.every(call=>success(call.result)));
  await verify('duplicate-key: exact response replay',isDeepStrictEqual(duplicates[0].result.data,duplicates[1].result.data));
  await currentAndVersions('duplicate-key','editorA',duplicate,duplicateBody.content);

  const collisionKey=key();
  const collisions=await race('different-payload-key',[
   {actor:'ownerA',body:save(collision,document('First key payload '+runId),collisionKey)},
   {actor:'ownerA',body:save(collision,document('Second key payload '+runId),collisionKey)}
  ]);
  const accepted=collisions.filter(call=>success(call.result));
  await verify('different-payload-key: exactly one success',accepted.length===1);
  await verify('different-payload-key: exactly one IDEMPOTENCY_CONFLICT',
   collisions.filter(call=>!success(call.result)&&call.result.errorCode==='IDEMPOTENCY_CONFLICT').length===1);
  await currentAndVersions('different-payload-key','ownerA',collision,accepted[0].body.content);
  const acceptedReplay=await send('ownerA',accepted[0].body);
  await verify('different-payload-key: winner remains replayable',success(acceptedReplay)
   &&isDeepStrictEqual(acceptedReplay.data,accepted[0].result.data));

  // Deliberately reuse the textual key across tenants to test receipt isolation too.
  const crossTenantKey=key();
  const parallel=await race('independent-tenants',[
   {actor:'ownerA',body:save(tenantA,document('Only tenant A '+runId),crossTenantKey)},
   {actor:'ownerB',body:save(tenantB,document('Only tenant B '+runId),crossTenantKey)}
  ]);
  await verify('independent-tenants: both saves succeed',parallel.every(call=>success(call.result)));
  await currentAndVersions('independent-tenants A','ownerA',tenantA,parallel[0].body.content);
  await currentAndVersions('independent-tenants B','ownerB',tenantB,parallel[1].body.content);
  for(const [actor,foreign] of [['ownerA',tenantB],['ownerB',tenantA]]){
   const response=await send(actor,{op:'read',id:foreign.file.id});
   await verify('independent-tenants: '+actor+' cannot read foreign file',!success(response)&&response.errorCode==='NOT_FOUND');
  }
  report.finishedAt=new Date().toISOString();
  return report;
 }catch(error){
  report.finishedAt=new Date().toISOString();
  const failure=error instanceof Error?error:new Error('Staging race callback failed.');
  Object.defineProperty(failure,'stagingRaceReport',{value:report,enumerable:false});
  throw failure;
 }
}

