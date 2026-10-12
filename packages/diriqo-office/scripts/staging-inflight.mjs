/**
 * Isolated Diriqo staging proof. No migrations, provisioning, SQL or service keys.
 * Root coordinates a temporary tenant_state row lock and separately records
 * sanitized pg_stat_activity/pg_locks evidence. HTTP overlap alone is not DB proof.
 */
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {isDeepStrictEqual} from 'node:util';
import {validateTarget} from './staging-target.mjs';
import {createStagingTransport,validateCredentials} from './staging-transport.mjs';
import {validateStagingConfig} from './staging-run.mjs';

const FIXTURE='.staging/diriqo.inflight.json';
const REPORT='reports/staging-diriqo-inflight.json';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requireValue=(condition,code)=>{if(!condition)throw new Error(code);};
const ok=result=>result?.status>=200&&result.status<300&&!result.errorCode&&result.data!=null;
const doc=(runId,suffix)=>({schemaVersion:1,kind:'document',page:{marginMm:20,header:'',footer:''},
 doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Office staging in-flight '+runId+' / '+suffix}]}]}});
const initial=fixture=>doc(fixture.runId,'initial');
const saved=fixture=>doc(fixture.runId,'saved before disable');
const rejected=fixture=>doc(fixture.runId,'must never persist');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeCode=error=>/^(?:STAGING_|AUTH_|TRANSPORT_)[A-Z_]+$/.test(error?.message??'')?error.message:'STAGING_INFLIGHT_FAILED';

async function jsonFile(path){
 const bytes=await readFile(path);requireValue(bytes.length<=128*1024,'STAGING_CONFIG_TOO_LARGE');
 return JSON.parse(bytes.toString('utf8'));
}
export function validateInflightFixture(fixture,target,owner,operator){
 const keys=['schemaVersion','host','projectRef','runId','tenantId','ownerUserId','operatorUserId','fileId','createdAt'];
 requireValue(fixture&&typeof fixture==='object'&&!Array.isArray(fixture)
  &&Object.keys(fixture).length===keys.length&&Object.keys(fixture).every(key=>keys.includes(key))
  &&fixture.schemaVersion===1&&fixture.host==='diriqo'&&fixture.projectRef===target.projectRef,'STAGING_INFLIGHT_FIXTURE_INVALID');
 for(const key of ['runId','tenantId','ownerUserId','operatorUserId','fileId'])
  requireValue(typeof fixture[key]==='string'&&UUID.test(fixture[key]),'STAGING_INFLIGHT_FIXTURE_INVALID');
 requireValue(fixture.tenantId===owner.tenantId&&fixture.ownerUserId===owner.userId
  &&fixture.operatorUserId===operator.userId&&operator.principal==='human'
  &&owner.principal==='human'&&owner.userId!==operator.userId,'STAGING_INFLIGHT_FIXTURE_BINDING_FAILED');
 const age=Date.now()-Date.parse(fixture.createdAt);
 requireValue(typeof fixture.createdAt==='string'&&Number.isFinite(age)&&age>=-300000&&age<=86400000,'STAGING_INFLIGHT_FIXTURE_EXPIRED');
 return fixture;
}

/** request uses the owner's verified JWT. setEnabled uses a separate verified human operator JWT. */
export async function runInflightScenario({fixture,request,setEnabled,sleep=delay,onProgress=async()=>{}}){
 requireValue(typeof request==='function'&&typeof setEnabled==='function'&&typeof sleep==='function','STAGING_INFLIGHT_CALLBACK_INVALID');
 const report={schemaVersion:1,runId:fixture.runId,host:'diriqo',projectRef:fixture.projectRef,
  tenantId:fixture.tenantId,fileId:fixture.fileId,startedAt:new Date().toISOString(),finishedAt:null,
  status:'RUNNING',checks:[],intervals:[],moduleState:'EXPECTED_ENABLED_FROM_PREPARATION',productionTouched:false,
  databaseOverlapVerified:false,
  databaseEvidenceRequired:'Separate sanitized pg_stat_activity/pg_locks observation: office_request waiting for tenant row; office_set_enabled waiting for that save; no JWT or raw query output.'};
 const pending=[];
 let restoreRequired=false;
 const check=(label,condition)=>{report.checks.push({label,passed:condition===true});requireValue(condition===true,'STAGING_INFLIGHT_ASSERTION_FAILED');};
 async function timed(op,task){
  const startedMs=performance.now(),startedAt=new Date().toISOString();
  try{return await task();}
  finally{const finishedMs=performance.now();report.intervals.push({op,startedAt,finishedAt:new Date().toISOString(),startedMs,finishedMs,elapsedMs:Math.round(finishedMs-startedMs)});}
 }
 try{
  // No baseline RPC here: read ALSO takes tenant_state FOR UPDATE and would
  // consume the externally held lock before the save. prepare verified revision 1.
  // CAS and exact history/content assertions below detect an altered fixture.
  restoreRequired=true;
  const savePromise=timed('save',()=>request({op:'save',id:fixture.fileId,expectedRevision:1,
   content:saved(fixture),idempotencyKey:'inflight-save-'+fixture.runId}));
  pending.push(savePromise);
  const disablePromise=(async()=>{
   await sleep(600);
   return timed('disable',()=>setEnabled(false));
  })();
  pending.push(disablePromise);
  // Always settle BOTH, including the delayed disable, before any cleanup.
  const [saveResult,disableResult]=await Promise.allSettled(pending);
  check('both independent authenticated requests completed',saveResult.status==='fulfilled'&&disableResult.status==='fulfilled');
  const saveResponse=saveResult.value,disableResponse=disableResult.value;
  check('in-flight save succeeded at revision 2',ok(saveResponse)&&saveResponse.data.file?.id===fixture.fileId
   &&saveResponse.data.file.tenantId===fixture.tenantId&&saveResponse.data.file.revision===2);
  check('save response preserves accepted content',isDeepStrictEqual(saveResponse.data.file.content,saved(fixture)));
  check('operator disable succeeded',disableResponse?.status===200&&disableResponse.data===false);
  report.moduleState='DISABLED';
  const saveInterval=report.intervals.find(item=>item.op==='save'),disableInterval=report.intervals.find(item=>item.op==='disable');
  check('save and disable HTTP intervals overlap',Boolean(saveInterval&&disableInterval)
   &&saveInterval.startedMs<disableInterval.finishedMs&&disableInterval.startedMs<saveInterval.finishedMs);
  // Client response order is not asserted: packets may arrive out of DB commit order.
  const deniedRead=await request({op:'read',id:fixture.fileId});
  check('read after completed disable is blocked',!ok(deniedRead)&&deniedRead.errorCode==='MODULE_DISABLED');
  const deniedSave=await request({op:'save',id:fixture.fileId,expectedRevision:2,
   content:rejected(fixture),idempotencyKey:'inflight-disabled-'+fixture.runId});
  check('new save after completed disable is blocked',!ok(deniedSave)&&deniedSave.errorCode==='MODULE_DISABLED');
 }catch(error){report.status='FAIL';report.failure=safeCode(error);}
 finally{
  await Promise.allSettled(pending);
  if(restoreRequired){
   try{
    const enabled=await timed('re-enable',()=>setEnabled(true));
    check('operator re-enabled module after all outstanding requests settled',enabled?.status===200&&enabled.data===true);
    report.moduleState='ENABLED';
    const current=await request({op:'read',id:fixture.fileId});
    check('current saved document survives disable/re-enable',ok(current)&&current.data.file?.id===fixture.fileId
     &&current.data.file.tenantId===fixture.tenantId&&current.data.file.revision===2
     &&isDeepStrictEqual(current.data.file.content,saved(fixture)));
    const versions=await request({op:'versions',id:fixture.fileId});
    check('exactly revisions 1 and 2 remain',ok(versions)&&Array.isArray(versions.data.versions)
     &&isDeepStrictEqual(versions.data.versions.map(item=>item.revision),[1,2]));
    check('original revision remains unchanged',isDeepStrictEqual(versions.data.versions[0].content,initial(fixture)));
    check('blocked save added no version or content',isDeepStrictEqual(versions.data.versions[1].content,saved(fixture)));
   }catch(error){
    if(report.moduleState!=='ENABLED')report.moduleState='UNKNOWN_REENABLE_FAILED';
    report.status='FAIL';report.cleanupFailure=safeCode(error);
   }
  }
  if(report.status==='RUNNING')report.status='HTTP_SCENARIO_PASS_DB_EVIDENCE_REQUIRED';
  report.finishedAt=new Date().toISOString();
  report.assertions={passed:report.checks.filter(item=>item.passed).length,failed:report.checks.filter(item=>!item.passed).length};
  await onProgress(report);
 }
 return report;
}

/** Only this exact authenticated RPC is permitted; no path/URL parameters. */
function moduleSetter(target,key,operator,tenantId,onRequest){
 return async enabled=>{
  requireValue(typeof enabled==='boolean','STAGING_INFLIGHT_FLAG_INVALID');
  const url=target.origin+'/rest/v1/rpc/office_set_enabled';
  const startedAt=new Date().toISOString(),started=performance.now();
  let status=0;
  try{
   const response=await fetch(url,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+operator.accessToken,
    'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({p_company_id:tenantId,p_enabled:enabled}),
    redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)});
   status=response.status;
   requireValue(!response.redirected&&(!response.url||response.url===url),'STAGING_INFLIGHT_REDIRECT_BLOCKED');
   requireValue(/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')&&response.body,'STAGING_INFLIGHT_RESPONSE_INVALID');
   const reader=response.body.getReader(),chunks=[];let bytes=0;
   try{
    for(;;){
     const part=await reader.read();if(part.done)break;
     bytes+=part.value.byteLength;
     if(bytes>16384){await reader.cancel();throw new Error('STAGING_INFLIGHT_RESPONSE_TOO_LARGE');}
     chunks.push(part.value);
    }
   }finally{reader.releaseLock();}
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
   // Never propagate an upstream error body, which may contain sensitive details.
   return {status,data:status===200&&typeof value==='boolean'?value:null};
  }finally{onRequest({label:'operator',op:enabled?'office-enable':'office-disable',tenantId,status,startedAt,elapsedMs:Math.round(performance.now()-started)});}
 };
}

async function main(){
 const args=process.argv.slice(2);
 requireValue(args.length===1&&['prepare','run'].includes(args[0]),'STAGING_INFLIGHT_PHASE_REQUIRED');
 const phase=args[0];
 const target=validateTarget(await jsonFile('reports/staging-targets.json'),'diriqo');
 const config=validateStagingConfig(await jsonFile('.staging/diriqo.credentials.json'),target);
 const operatorConfig=await jsonFile('.staging/diriqo.operator.json');
 requireValue(operatorConfig.projectRef===target.projectRef&&operatorConfig.principal==='human'
  &&!Object.values(config.actors).some(actor=>actor.userId.toLowerCase()===String(operatorConfig.userId).toLowerCase()),'STAGING_INFLIGHT_OPERATOR_INVALID');
 validateCredentials({...operatorConfig,label:'operator'});
 if(phase==='prepare'){
  try{await access(FIXTURE);throw new Error('STAGING_INFLIGHT_FIXTURE_ALREADY_EXISTS');}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const requests=[];
 const transport=createStagingTransport({target,publishableKey:config.publishableKey,onRequest:event=>requests.push(event)});
 const owner=await transport.login({...config.actors.ownerA,label:'ownerA'});
 const operator=await transport.login({...operatorConfig,label:'operator'});
 const request=body=>transport.request(owner,body);
 if(phase==='prepare'){
  const runId=randomUUID(),metadata={schemaVersion:1,host:'diriqo',projectRef:target.projectRef,runId,
   tenantId:owner.tenantId,ownerUserId:owner.userId,operatorUserId:operator.userId,fileId:'',createdAt:new Date().toISOString()};
  const created=await request({op:'create',kind:'document',title:'Office staging in-flight '+runId,
   content:initial(metadata),idempotencyKey:'inflight-create-'+runId});
  requireValue(ok(created)&&typeof created.data.file?.id==='string','STAGING_INFLIGHT_PREPARE_FAILED');
  metadata.fileId=created.data.file.id;
  // Record returned ID before secondary assertions, preserving fixture ownership after failures.
  await writeFile(FIXTURE,JSON.stringify(metadata,null,2)+'\n',{flag:'wx',mode:0o600});
  validateInflightFixture(metadata,target,owner,operator);
  requireValue(created.data.file.tenantId===owner.tenantId&&created.data.file.revision===1
   &&isDeepStrictEqual(created.data.file.content,initial(metadata)),'STAGING_INFLIGHT_PREPARE_INVALID');
  console.log(JSON.stringify({status:'PREPARED',projectRef:target.projectRef,tenantId:metadata.tenantId,fileId:metadata.fileId,fixture:FIXTURE}));
  return;
 }
 const fixture=validateInflightFixture(await jsonFile(FIXTURE),target,owner,operator);
 const hashes={};
 for(const file of ['scripts/staging-inflight.mjs','scripts/staging-transport.mjs','database/office-core.sql','database/office-diriqo-adapter.sql'])
  hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
 const setEnabled=moduleSetter(target,config.publishableKey,operator,owner.tenantId,event=>requests.push(event));
 const report=await runInflightScenario({fixture,request,setEnabled,onProgress:async report=>{
  const bytes=JSON.stringify({...report,requests,sourceHashes:hashes},null,2)+'\n';
  await writeFile('reports/staging-diriqo-inflight-'+fixture.runId+'.json',bytes);
  await writeFile(REPORT,bytes);
 }});
 console.log(JSON.stringify({status:report.status,report:REPORT,assertions:report.assertions,moduleState:report.moduleState,databaseOverlapVerified:false}));
 if(report.status==='FAIL')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{
 console.error('STAGING_INFLIGHT_BLOCKED: inspect the local fixture/target/report. No production fallback or automatic fixture deletion.');
 process.exitCode=1;
});
