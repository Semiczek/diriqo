/** Pure/injected helpers. No network, credentials, database or filesystem access. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const CAPACITY_REVISIONS=72;
/** Retry only an idempotent local rename blocked transiently by Windows. Never retries HTTP. */
export async function retryCapacityCheckpointRename(renameOperation,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 for(let attempt=0;;attempt++){
  try{return await renameOperation();}catch(error){
   if(!['EPERM','EBUSY'].includes(error?.code)||attempt>=7)throw error;
   await wait(Math.min(25*2**attempt,500));
  }
 }
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const authorized=Object.freeze({
 hub:Object.freeze({projectRef:'amuhcvnvubsrvsfclqtg',runId:'cde1e6d7-6c93-4afc-af45-669db020e2a8',fileId:'59a37684-63ab-4dc5-8e5b-db46bed5512f',companyId:'212bf46d-d10d-458e-98f3-ce0540d57d85'}),
 diriqo:Object.freeze({projectRef:'pkjzoplczxqqmmstnqgy',runId:'62b78d3e-b0e5-4e35-aecd-f4fc43b69735',fileId:'d4d709eb-7e6c-4c1d-b0e2-39c61d5a1777',companyId:'3d94f383-09a2-4420-908e-424df34adb29'}),
});
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const capacityHash=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
export const capacityBytes=x=>Buffer.byteLength(JSON.stringify(x));
export const capacityTitle=id=>'Synthetic capacity >64 MiB '+id;
export function capacityDocument(runId,revision){
 assert.ok(uuid.test(runId)&&Number.isInteger(revision)&&revision>=1&&revision<=CAPACITY_REVISIONS);
 return {schemaVersion:1,kind:'document',page:{marginMm:20,header:'',footer:''},doc:{type:'doc',content:Array.from({length:4},(_,part)=>({type:'paragraph',content:[{type:'text',text:`Synthetic capacity ${runId} revision ${revision} part ${part}: `+createHash('sha256').update(`${runId}:${revision}:${part}`).digest('hex').repeat(4096)}]}))}};
}
const expectedContent=(report,revision)=>capacityDocument(report.runId,revision===73?1:revision);
export const capacitySave=(report,revision)=>({op:'save',actor:revision%2?'ownerA':'editorA',revision,expectedRevision:revision-1,idempotencyKey:'capacity-'+report.runId+'-'+revision});
export const capacityRestore=report=>({op:'restore',actor:'ownerA',revision:73,expectedRevision:72,idempotencyKey:'capacity-'+report.runId+'-restore-1'});
export function validateCapacityFile(report,file){
 assert.ok(file&&file.id===report.fileId&&file.tenantId===report.companyId&&file.kind==='document'&&file.title===capacityTitle(report.runId),'Not the authorized synthetic document');
 assert.ok(Number.isInteger(file.revision)&&file.revision>=1&&file.revision<=73,'Unexpected current revision');
 assert.equal(capacityHash(file.content),capacityHash(expectedContent(report,file.revision)),'Deterministic content mismatch');
}
/** Validate BEFORE any Auth request or archive modification. Hydrates legacy checkpoints. */
export function prepareCapacityResume(report,host,target,actors){
 const allowed=authorized[host];assert.ok(allowed,'Unknown host');
 assert.equal(report.schemaVersion,1);assert.equal(report.host,host);assert.equal(target.projectRef,allowed.projectRef);
 for(const key of ['projectRef','runId','fileId','companyId'])assert.equal(report[key],allowed[key],'Resume target mismatch: '+key);
 assert.equal(report.status,'FAIL','Only an interrupted failed run may resume');assert.equal(report.productionTouched,false);
 assert.ok(Array.isArray(report.checks)&&report.checks.every(item=>item.passed===true),'Semantic assertion failures cannot resume');
 assert.ok(Array.isArray(report.requests)&&report.requests.length>0);
 const last=report.requests.at(-1);
 const transportInterruption=last.status===0&&['TRANSPORT_TIMEOUT','TRANSPORT_FAILED'].includes(last.errorCode);
 const checkpointInterruption=last.status===200&&last.errorCode===null&&Number.isInteger(report.savedRevision)
  &&report.error?.name==='Error'&&/^EPERM: operation not permitted, rename '/.test(report.error?.message??'')
  &&report.error.message.includes('staging-'+host+'-normalized-capacity.json.tmp')
  &&report.error.message.includes('staging-'+host+'-normalized-capacity.json');
 assert.ok(transportInterruption||checkpointInterruption,'Recorded transport or exact local checkpoint interruption required');
 for(const label of ['ownerA','editorA','readerA'])assert.equal(actors[label]?.tenantId,allowed.companyId);
 assert.ok(uuid.test(actors.ownerB?.tenantId??'')&&actors.ownerB.tenantId!==allowed.companyId);
 if(report.savedRevision===undefined){
  const completed=report.checks.map(item=>/^Revision (\d+) company and exact saved content$/.exec(item.label)).filter(Boolean).map(match=>Number(match[1]));
  const revision=Math.max(1,...completed);
  assert.ok(revision<72&&completed.length===revision-1&&new Set(completed).size===completed.length&&completed.every(n=>n>=2&&n<=revision),'Legacy checkpoints must be contiguous');
  assert.equal(last.op,'save','Legacy reports support only the recorded save interruption');
  assert.equal(last.fileId,report.fileId);assert.equal(last.tenantId,report.companyId);
  report.savedRevision=revision;report.pendingOperation=capacitySave(report,revision+1);
  assert.equal(last.label,report.pendingOperation.actor,'Original writer must match the same receipt owner');
 }
 assert.ok(Number.isInteger(report.savedRevision)&&report.savedRevision>=1&&report.savedRevision<=73);
 const pending=report.pendingOperation;
 if(pending!=null){
  assert.ok(pending.op==='save'||pending.op==='restore');
  assert.ok(pending.op!=='save'||Number.isInteger(pending.revision)&&pending.revision>=2&&pending.revision<=72);
  const expected=pending.op==='save'?capacitySave(report,pending.revision):capacityRestore(report);
  assert.equal(capacityHash(pending),capacityHash(expected),'Pending key, actor or expectedRevision changed');
  assert.equal(pending.expectedRevision,report.savedRevision,'Pending write must follow the last confirmed revision');
 }
 return report;
}
export async function verifyCapacityHistory({report,current,request,check}){
 validateCapacityFile(report,current);
 const history=[];let beforeRevision,expected=current.revision;
 do{
  assert.ok(history.length<=73,'History pagination budget exceeded');
  const page=await request('readerA',{op:'listVersions',id:report.fileId,limit:7,...(beforeRevision?{beforeRevision}:{})});
  const rows=page.versionSummaries;
  check(`History verification before ${beforeRevision??'latest'} is bounded metadata`,Array.isArray(rows)&&rows.length>0&&rows.length<=7&&rows.every(v=>!Object.hasOwn(v,'content'))&&capacityBytes(page)<20000);
  for(const item of rows){assert.equal(item.revision,expected--,'Missing, duplicate or reordered history');assert.equal(item.title,capacityTitle(report.runId));history.push(item);}
  if(page.nextCursor!==null&&page.nextCursor!==undefined){
   assert.match(String(page.nextCursor),/^[1-9]\d*$/);const cursor=Number(page.nextCursor);
   assert.equal(cursor,rows.at(-1).revision,'Unexpected cursor');assert.ok(cursor>1&&(!beforeRevision||cursor<beforeRevision));beforeRevision=cursor;
  }else beforeRevision=undefined;
 }while(beforeRevision);
 check('Verified contiguous immutable history',expected===0&&history.length===current.revision);
 let logicalHistoryBytes=0;const verified=[];
 for(const item of history){
  const {version}=await request('readerA',{op:'readVersion',id:report.fileId,revision:item.revision});
  check(`Verified persisted revision ${item.revision} hash`,version.revision===item.revision&&version.title===capacityTitle(report.runId)&&capacityHash(version.content)===capacityHash(expectedContent(report,item.revision)));
  const size=capacityBytes(version.content);logicalHistoryBytes+=size;verified.push({revision:item.revision,bytes:size,sha256:capacityHash(version.content)});
 }
 report.logicalHistoryBytes=logicalHistoryBytes;report.verifiedHistory=verified;report.historyVerifiedAt=new Date().toISOString();return history;
}
export async function reconcileCapacityResume({report,request,check,checkpoint}){
 const pending=report.pendingOperation;
 let current=(await request('ownerA',{op:'read',id:report.fileId})).file;
 validateCapacityFile(report,current);
 assert.ok(current.revision===report.savedRevision||pending&&current.revision===pending.revision,'Unexpected intervening revision');
 await verifyCapacityHistory({report,current,request,check});await checkpoint();
 if(pending){
  const committedBeforeReplay=current.revision===pending.revision;
  const body={op:pending.op,id:report.fileId,expectedRevision:pending.expectedRevision,idempotencyKey:pending.idempotencyKey,...(pending.op==='save'?{content:capacityDocument(report.runId,pending.revision)}:{revision:1})};
  const saved=(await request(pending.actor,body)).file;validateCapacityFile(report,saved);
  check('Interrupted write reuses original key and exact revision',saved.revision===pending.revision);
  current=(await request('ownerA',{op:'read',id:report.fileId})).file;validateCapacityFile(report,current);
  check('Resumed receipt creates no extra revision',current.revision===pending.revision);
  report.reconciliations??=[];report.reconciliations.push({at:new Date().toISOString(),...pending,committedBeforeReplay});
  if(!committedBeforeReplay)report.logicalHistoryBytes+=capacityBytes(current.content);
  report.savedRevision=current.revision;report.pendingOperation=null;await checkpoint();
 }
 return current;
}
