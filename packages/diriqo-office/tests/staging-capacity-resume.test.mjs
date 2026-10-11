// Injected local orchestration tests; never evidence of a live staging/database run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {capacityDocument,capacityHash,capacityBytes,capacityTitle,capacitySave,capacityRestore,prepareCapacityResume,reconcileCapacityResume,retryCapacityCheckpointRename} from '../scripts/staging-capacity-resume.mjs';
const allowed={projectRef:'amuhcvnvubsrvsfclqtg',runId:'cde1e6d7-6c93-4afc-af45-669db020e2a8',fileId:'59a37684-63ab-4dc5-8e5b-db46bed5512f',companyId:'212bf46d-d10d-458e-98f3-ce0540d57d85'};
const actors={ownerA:{tenantId:allowed.companyId},editorA:{tenantId:allowed.companyId},readerA:{tenantId:allowed.companyId},ownerB:{tenantId:'00000000-0000-4000-8000-000000000002'}};
const fixture=()=>({schemaVersion:1,host:'hub',...allowed,status:'FAIL',productionTouched:false,logicalHistoryBytes:999,
 checks:[{label:'Revision 2 company and exact saved content',passed:true}],
 requests:[{op:'save',label:'ownerA',tenantId:allowed.companyId,fileId:allowed.fileId,status:0,errorCode:'TRANSPORT_TIMEOUT'}]});
const prepare=report=>prepareCapacityResume(report,'hub',{projectRef:allowed.projectRef},actors);
function backend(report,{head=2,alterCurrent=()=>{},alterPage=()=>{},alterVersion=()=>{},timeout=false}={}){
 const calls=[];let revision=head;
 const content=rev=>capacityDocument(report.runId,rev===73?1:rev);
 const file=()=>({id:report.fileId,tenantId:report.companyId,kind:'document',title:capacityTitle(report.runId),revision,content:content(revision)});
 async function request(actor,body){
  calls.push({actor,...body,...(body.content?{contentHash:capacityHash(body.content),content:undefined}:{})});
  if(body.op==='read'){const current=file();alterCurrent(current);return{file:current};}
  if(body.op==='listVersions'){
   const last=body.beforeRevision?body.beforeRevision-1:revision;
   const list=Array.from({length:last},(_,index)=>({revision:last-index,title:capacityTitle(report.runId)}));
   const rows=list.slice(0,body.limit),page={versionSummaries:rows,nextCursor:list.length>rows.length?String(rows.at(-1).revision):null};alterPage(page);return page;
  }
  if(body.op==='readVersion'){const version={revision:body.revision,title:capacityTitle(report.runId),content:content(body.revision)};alterVersion(version);return{version};}
  if(['save','restore'].includes(body.op)){
   const pending=report.pendingOperation;assert.equal(actor,pending.actor);assert.equal(body.idempotencyKey,pending.idempotencyKey);assert.equal(body.expectedRevision,pending.expectedRevision);
   if(timeout)throw Error('TRANSPORT_TIMEOUT');
   if(revision===pending.expectedRevision)revision=pending.revision;else assert.equal(revision,pending.revision);
   return{file:file()};
  }
  throw Error('Unexpected op '+body.op);
 }
 return{request,calls,revision:()=>revision};
}
const reconcile=(report,b)=>reconcileCapacityResume({report,request:b.request,check:(label,ok)=>assert.equal(ok,true,label),checkpoint:async()=>{}});

test('legacy timeout resumes exact original author, key and expectedRevision',()=>{
 const report=prepare(fixture());assert.equal(report.savedRevision,2);assert.deepEqual(report.pendingOperation,capacitySave(report,3));
 assert.equal(report.runId,allowed.runId);assert.equal(report.fileId,allowed.fileId);assert.equal(report.status,'FAIL');
});
test('resume rejects wrong run, document, tenant, project, successful reports and semantic failures',()=>{
 for(const patch of [{runId:'00000000-0000-4000-8000-000000000099'},{fileId:'00000000-0000-4000-8000-000000000099'},{companyId:actors.ownerB.tenantId},{projectRef:'wfcpfraxiuhuglnuaxqj'},{status:'PASS'},{checks:[{label:'Wrong hash',passed:false}]},{requests:[{status:500,errorCode:'HTTP_ERROR'}]}])assert.throws(()=>prepare({...fixture(),...patch}));
 assert.throws(()=>prepareCapacityResume(fixture(),'diriqo',{projectRef:allowed.projectRef},actors));
 assert.throws(()=>prepareCapacityResume(fixture(),'hub',{projectRef:allowed.projectRef},{...actors,readerA:actors.ownerB}));
});
test('checkpoint cannot substitute a new idempotency key, writer or revision',()=>{
 for(const patch of [{idempotencyKey:'fresh-key'},{actor:'editorA'},{expectedRevision:3},{revision:4}]){
  const report=prepare(fixture());report.pendingOperation={...report.pendingOperation,...patch};assert.throws(()=>prepare(report));
 }
});
test('uncommitted timeout is applied once after every existing history hash was verified',async()=>{
 const report=prepare(fixture()),b=backend(report);const current=await reconcile(report,b);
 assert.equal(current.revision,3);assert.equal(report.savedRevision,3);assert.equal(report.pendingOperation,null);
 assert.equal(report.reconciliations[0].committedBeforeReplay,false);
 assert.equal(report.logicalHistoryBytes,[1,2,3].reduce((sum,n)=>sum+capacityBytes(capacityDocument(report.runId,n)),0));
 const write=b.calls.findIndex(c=>c.op==='save');assert.equal(b.calls.slice(0,write).filter(c=>c.op==='readVersion').length,2);
 assert.equal(b.calls.filter(c=>c.op==='save').length,1);assert.equal(b.calls.some(c=>c.op==='create'),false);
});
test('already committed timed-out save replays the same receipt and never creates revision 4',async()=>{
 const report=prepare(fixture()),b=backend(report,{head:3});await reconcile(report,b);
 assert.equal(b.revision(),3);assert.equal(report.reconciliations[0].committedBeforeReplay,true);
 assert.equal(report.verifiedHistory.length,3);assert.equal(b.calls.filter(c=>c.op==='save').length,1);
 assert.equal(report.logicalHistoryBytes,[1,2,3].reduce((sum,n)=>sum+capacityBytes(capacityDocument(report.runId,n)),0));
});
test('foreign or changed document and unexpected intervening revision cause no write',async()=>{
 for(const options of [{alterCurrent:f=>{f.tenantId=actors.ownerB.tenantId;}},{alterCurrent:f=>{f.title='Human document';}},{alterCurrent:f=>{f.content.doc.content[0].content[0].text='Changed';}},{head:4}]){
  const report=prepare(fixture()),b=backend(report,options);await assert.rejects(reconcile(report,b));assert.equal(b.calls.some(c=>c.op==='save'),false);
 }
});
test('history gaps, foreign metadata, corrupted content and invalid pagination reject before any replay',async()=>{
 for(const options of [{alterPage:p=>{p.versionSummaries.pop();}},{alterPage:p=>{p.versionSummaries[0].title='Other';}},{alterPage:p=>{p.nextCursor='999';}},{alterVersion:v=>{v.content.doc.content[0].content[0].text='Corrupt';}}]){
  const report=prepare(fixture()),b=backend(report,options);await assert.rejects(reconcile(report,b));assert.equal(b.calls.some(c=>c.op==='save'),false);
 }
});
test('a second transport failure stops immediately and retains the original pending operation',async()=>{
 const report=prepare(fixture()),pending=structuredClone(report.pendingOperation),b=backend(report,{timeout:true});
 await assert.rejects(reconcile(report,b),/TRANSPORT_TIMEOUT/);assert.deepEqual(report.pendingOperation,pending);assert.equal(report.savedRevision,2);
 assert.equal(b.calls.filter(c=>c.op==='save').length,1);
});
test('resume during a read recomputes history bytes and performs no write',async()=>{
 const report=prepare(fixture());report.pendingOperation=null;report.requests.push({op:'readVersion',status:0,errorCode:'TRANSPORT_TIMEOUT'});prepare(report);
 const b=backend(report);await reconcile(report,b);assert.equal(b.calls.some(c=>c.op==='save'),false);assert.equal(report.logicalHistoryBytes,capacityBytes(capacityDocument(report.runId,1))+capacityBytes(capacityDocument(report.runId,2)));
});
test('committed restore timeout is replayed with its fixed key and retains all 73 versions',async()=>{
 const report=prepare(fixture());report.savedRevision=72;report.pendingOperation=capacityRestore(report);report.requests.push({op:'restore',status:0,errorCode:'TRANSPORT_TIMEOUT'});prepare(report);
 const b=backend(report,{head:73});await reconcile(report,b);
 assert.equal(b.revision(),73);assert.equal(report.verifiedHistory.length,73);assert.equal(report.savedRevision,73);
 assert.equal(b.calls.filter(c=>c.op==='restore').length,1);assert.equal(report.reconciliations[0].committedBeforeReplay,true);
 assert.ok(report.logicalHistoryBytes>64*1024*1024);
});
test('both specifically authorized interrupted run fixtures retain their original revision keys',()=>{
 for(const host of ['hub','diriqo']){
  const report=fixture();report.host=host;
  if(host==='diriqo')Object.assign(report,{projectRef:'pkjzoplczxqqmmstnqgy',runId:'62b78d3e-b0e5-4e35-aecd-f4fc43b69735',fileId:'d4d709eb-7e6c-4c1d-b0e2-39c61d5a1777',companyId:'3d94f383-09a2-4420-908e-424df34adb29'});
  const last=host==='hub'?28:10;
  report.checks=Array.from({length:last-1},(_,i)=>({label:`Revision ${i+2} company and exact saved content`,passed:true}));
  report.requests=[{op:'save',status:0,errorCode:'TRANSPORT_TIMEOUT',label:'ownerA',fileId:report.fileId,tenantId:report.companyId}];
  const tenantActors={ownerA:{tenantId:report.companyId},editorA:{tenantId:report.companyId},readerA:{tenantId:report.companyId},ownerB:actors.ownerB};
  prepareCapacityResume(report,host,{projectRef:report.projectRef},tenantActors);
  assert.equal(report.pendingOperation.revision,last+1);assert.equal(report.pendingOperation.idempotencyKey,'capacity-'+report.runId+'-'+(last+1));
 }
});


test('Windows checkpoint rename retries are bounded and never invoke a network callback',async()=>{
 let attempts=0;const delays=[];
 await retryCapacityCheckpointRename(async()=>{attempts++;if(attempts<4)throw Object.assign(Error('Locked'),{code:'EPERM'});},async delay=>delays.push(delay));
 assert.equal(attempts,4);assert.deepEqual(delays,[25,50,100]);
 attempts=0;await assert.rejects(retryCapacityCheckpointRename(async()=>{attempts++;throw Object.assign(Error('Locked'),{code:'EPERM'});},async()=>{}),/Locked/);assert.equal(attempts,8);
 attempts=0;await assert.rejects(retryCapacityCheckpointRename(async()=>{attempts++;throw Object.assign(Error('Denied'),{code:'EACCES'});},async()=>{}),/Denied/);assert.equal(attempts,1);
});
test('explicit failed local checkpoint resumes with full history reconciliation and the same pending key',async()=>{
 const report=prepare(fixture());report.requests.push({op:'save',status:200,errorCode:null});
 report.error={name:'Error',message:"EPERM: operation not permitted, rename 'C:/reports/staging-hub-normalized-capacity.json.tmp' -> 'C:/reports/staging-hub-normalized-capacity.json'"};
 prepare(report);const b=backend(report);await reconcile(report,b);assert.equal(b.revision(),3);assert.equal(b.calls.filter(c=>c.op==='save').length,1);
 for(const message of ['Permission denied','EPERM: operation not permitted, unlink file',"EPERM: operation not permitted, rename 'other.tmp' -> 'other.json'"]){const bad={...report,error:{name:'Error',message}};assert.throws(()=>prepare(bad));}
});
