/** Explicit synthetic capacity / tenant test against the two reviewed disposable branches.
 * No provisioning, production access, SQL, admin credentials or automatic deletion.
 * Each request stays below 3 MiB; history intentionally exceeds the former 64 MiB tenant cap.
 */
import {readFile,writeFile,open,unlink,rename} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateTarget} from './staging-target.mjs';
import {validateStagingConfig} from './staging-run.mjs';
import {createStagingTransport} from './staging-transport.mjs';
import {capacityDocument,capacitySave,capacityRestore,prepareCapacityResume,reconcileCapacityResume,verifyCapacityHistory,validateCapacityFile,retryCapacityCheckpointRename} from './staging-capacity-resume.mjs';

const host=process.argv[2];
assert.ok(['hub','diriqo'].includes(host)&&['--execute','--resume'].includes(process.argv[3])&&process.argv.length===4,
 'Usage: staging-normalized-capacity.mjs [hub|diriqo] [--execute|--resume]');
const resume=process.argv[3]==='--resume';
const target=validateTarget(JSON.parse(await readFile('reports/staging-targets.json','utf8')),host);
assert.ok(['amuhcvnvubsrvsfclqtg','pkjzoplczxqqmmstnqgy'].includes(target.projectRef));
assert.ok(Date.now()<Date.parse('2026-10-12T17:00:00Z'),'Authorized staging window expired');
const config=validateStagingConfig(JSON.parse(await readFile(`.staging/${host}.credentials.json`,'utf8')),target);
const reportPath=`reports/staging-${host}-normalized-capacity.json`;
const original=resume?await readFile(reportPath,'utf8'):null;
if(!resume)await assert.rejects(readFile(reportPath),error=>error.code==='ENOENT','Existing report must not be overwritten; explicit --resume is required');
const report=resume?JSON.parse(original):{schemaVersion:1,host,projectRef:target.projectRef,runId:randomUUID(),startedAt:new Date().toISOString(),
 status:'RUNNING',productionTouched:false,checks:[],requests:[],fileId:null,logicalHistoryBytes:0,
 scope:'Real authenticated staging RPC. Logical immutable JSON history >64 MiB; no assertion of unlimited disk or production capacity.'};
if(resume)prepareCapacityResume(report,host,target,config.actors);
const transport=createStagingTransport({target,publishableKey:config.publishableKey,timeoutMs:60000,onRequest:r=>report.requests.push(r)});
const actors={};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const checkpoint=async()=>{const temporary=reportPath+'.tmp';await writeFile(temporary,JSON.stringify(report,null,2)+'\n');await retryCapacityCheckpointRename(()=>rename(temporary,reportPath));};
const check=(label,value)=>{report.checks.push({label,passed:value===true});assert.equal(value,true,label);};
async function probe(actor,body){const r=await transport.request(typeof actor==='string'?actors[actor]:actor,body);assert.ok(!r.errorCode?.startsWith('TRANSPORT_'),`${body.op}: ${r.errorCode}`);return r;}
async function request(actor,body){const r=await probe(actor,body);assert.equal(r.errorCode,null,`${body.op}: ${r.errorCode}`);assert.equal(r.status,200);return r.data;}
const revisionCount=72;
const document=revision=>capacityDocument(report.runId,revision);
const lockPath=`.staging/${host}.capacity-run.lock`,lock=await open(lockPath,'wx');
let archivePreserved=!resume;
try{
 if(resume){
  // Archive exact prior bytes before changing the active evidence. Never overwrite an archive.
  assert.equal(await readFile(reportPath,'utf8'),original,'Report changed while acquiring the exclusive run lock');
  const archive=`reports/staging-${host}-normalized-capacity-failed-${report.runId}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.json`;
  await writeFile(archive,original,{flag:'wx'});archivePreserved=true;
  report.resumptions??=[];report.resumptions.push({at:new Date().toISOString(),archive,archiveSha256:createHash('sha256').update(original).digest('hex'),previousError:report.error??null});
  delete report.error;delete report.finishedAt;
 }
 report.status='RUNNING';
 for(const label of ['ownerA','editorA','readerA','ownerB'])actors[label]=await transport.login({...config.actors[label],label});
 const initial=document(1),initialHash=hash(initial);
 check('Individual document under 3 MiB',Buffer.byteLength(JSON.stringify(initial))<3*1024*1024);
 let current=resume?await reconcileCapacityResume({report,request,check,checkpoint}):(await request('ownerA',{op:'create',title:'Synthetic capacity >64 MiB '+report.runId,kind:'document',content:initial,idempotencyKey:'capacity-'+report.runId+'-create'})).file;
 report.fileId=current.id;report.companyId=current.tenantId;
 check('Create company matches authenticated company',current.tenantId===actors.ownerA.tenantId);
 validateCapacityFile(report,current);
 if(!resume){report.logicalHistoryBytes=Buffer.byteLength(JSON.stringify(initial));report.savedRevision=1;report.pendingOperation=null;await checkpoint();}
 for(let revision=current.revision+1;revision<=revisionCount;revision++){
  const content=document(revision);
  const pending=capacitySave(report,revision);report.pendingOperation=pending;await checkpoint();
  const saved=(await request(pending.actor,{op:'save',id:current.id,expectedRevision:pending.expectedRevision,content,idempotencyKey:pending.idempotencyKey})).file;
  check(`Revision ${revision} company and exact saved content`,saved.tenantId===actors.ownerA.tenantId&&saved.revision===revision&&hash(saved.content)===hash(content));
  validateCapacityFile(report,saved);current=saved;report.savedRevision=revision;report.pendingOperation=null;report.logicalHistoryBytes+=Buffer.byteLength(JSON.stringify(content));await checkpoint();
  if(revision%6===0){await checkpoint();console.log(JSON.stringify({host,revision,logicalHistoryMiB:Math.round(report.logicalHistoryBytes/1048576)}));}
 }
 const history=await verifyCapacityHistory({report,current,request,check});await checkpoint();
 check('Persisted immutable history exceeds former 64 MiB tenant cap',report.logicalHistoryBytes>64*1024*1024);
 check('All immutable revisions available without duplicates',history.length===current.revision&&new Set(history.map(v=>v.revision)).size===current.revision&&current.revision>=revisionCount&&history[0].revision===current.revision&&history.at(-1).revision===1);
 const old=await request('readerA',{op:'readVersion',id:current.id,revision:1});
 check('Original revision exact after >64 MiB',hash(old.version.content)===initialHash);
 const legacy=await probe('readerA',{op:'versions',id:current.id});
 check('Unbounded legacy history explicitly asks for pagination',legacy.errorCode==='PAGINATION_REQUIRED');
 for(const body of [{op:'read',id:current.id},{op:'readVersion',id:current.id,revision:1},{op:'listVersions',id:current.id},{op:'listProposals',id:current.id}]){
  const denied=await probe('ownerB',body);
  check(`Foreign company denied ${body.op}`,denied.errorCode==='NOT_FOUND');
 }
 const forged=await probe({...actors.ownerB,tenantId:actors.ownerA.tenantId},{op:'readVersion',id:current.id,revision:1});
 check('Foreign JWT with forged company denied',forged.errorCode==='FORBIDDEN');
 const readonly=await probe('readerA',{op:'save',id:current.id,expectedRevision:revisionCount,content:initial,idempotencyKey:'capacity-'+report.runId+'-reader-denied'});
 check('Reader cannot save after capacity threshold',readonly.errorCode==='FORBIDDEN');
 let restored=current;
 if(current.revision===revisionCount){
  const pending=capacityRestore(report);report.pendingOperation=pending;await checkpoint();
  restored=(await request(pending.actor,{op:'restore',id:current.id,expectedRevision:pending.expectedRevision,revision:1,idempotencyKey:pending.idempotencyKey})).file;
 }
 check('Restore creates a new revision without replacing history',restored.revision===revisionCount+1&&hash(restored.content)===initialHash&&restored.tenantId===actors.ownerA.tenantId);
 validateCapacityFile(report,restored);report.savedRevision=restored.revision;report.pendingOperation=null;
 if(current.revision===revisionCount)report.logicalHistoryBytes+=Buffer.byteLength(JSON.stringify(initial));await checkpoint();
 const latest=(await request('readerA',{op:'read',id:current.id})).file;
 check('Reopened file is exact restored content',latest.revision===revisionCount+1&&hash(latest.content)===initialHash);
 const finalHistory=await request('readerA',{op:'listVersions',id:current.id,limit:2});
 check('Restore retains the prior head as a separate immutable revision',finalHistory.versionSummaries?.[0]?.revision===73&&finalHistory.versionSummaries?.[1]?.revision===72);
 report.status='PASS';
}catch(error){report.status='FAIL';report.error={name:error.name,message:String(error.message).slice(0,400)};process.exitCode=1;}
finally{try{report.finishedAt=new Date().toISOString();if(archivePreserved)await checkpoint();console.log(JSON.stringify({host,status:report.status,checks:report.checks.length,logicalHistoryBytes:report.logicalHistoryBytes,fileId:report.fileId,...(report.error?{error:report.error}:{})}));}finally{await lock.close();await unlink(lockPath);}}
