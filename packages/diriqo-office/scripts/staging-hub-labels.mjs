/** Read-only label RPC checks on the one authorized public Hub staging branch. */
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {validateTarget} from './staging-target.mjs';
import {createStagingTransport} from './staging-transport.mjs';
import {assertNoReportSecrets} from './package-source.mjs';
assert.deepEqual(process.argv.slice(2),['--execute'],'Usage: node scripts/staging-hub-labels.mjs --execute');
const manifest=JSON.parse(await readFile('reports/staging-targets.json','utf8'));
const target=validateTarget(manifest,'hub');
assert.equal(target.projectRef,'amuhcvnvubsrvsfclqtg','Only the approved public Hub staging branch is allowed');
const config=JSON.parse(await readFile('.staging/hub.credentials.json','utf8'));
assert.equal(config.schemaVersion,1);assert.equal(config.projectRef,target.projectRef);
const transport=createStagingTransport({target,publishableKey:config.publishableKey});
const report={host:'hub',projectRef:target.projectRef,startedAt:new Date().toISOString(),scope:'Actual staging Auth JWT + Office read-only company label RPC; no document, company, membership or module mutations.',checks:[],status:'RUNNING'};
const check=(label,ok)=>{report.checks.push({label,passed:ok===true});assert.equal(ok,true,label)};
const actors={};
async function labels(actor,companyId,ids){
 const current=validateTarget(manifest,'hub');assert.equal(current.projectRef,target.projectRef);
 assert.ok(ids.length<=101&&ids.every(id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)));
 const headers={apikey:config.publishableKey,Accept:'application/json','Content-Type':'application/json'};
 if(actor){assert.ok(Object.isFrozen(actor)&&Object.values(actors).includes(actor));headers.Authorization='Bearer '+actor.accessToken;}
 const url=target.origin+'/rest/v1/rpc/office_company_labels';
 let response;try{response=await fetch(url,{method:'POST',headers,body:JSON.stringify({p_company_id:companyId,p_company_ids:ids}),redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000)});}catch{throw Error('LABELS_TRANSPORT_FAILED')}
 assert.equal(response.url,url);assert.equal(response.redirected,false);
 assert.match(response.headers.get('content-type')??'',/^application\/json/);
 const reader=response.body.getReader(),chunks=[];let count=0;
 try{while(true){const part=await reader.read();if(part.done)break;count+=part.value.length;if(count>65536){await reader.cancel();throw Error('LABELS_RESPONSE_LIMIT')}chunks.push(part.value)}}finally{reader.releaseLock()}
 const data=JSON.parse(Buffer.concat(chunks,count).toString('utf8'));
 let errorCode=null;
 if(response.status>=400){
  if(data?.code==='P0001'&&typeof data.message==='string'){try{const parsed=JSON.parse(data.message);if(/^[A-Z_]{1,60}$/.test(parsed.code))errorCode=parsed.code}catch{}}
  return {status:response.status,rows:null,errorCode};
 }
 assert.ok(Array.isArray(data));
 for(const row of data)assert.ok(row&&Object.keys(row).sort().join(',')==='company_id,name'&&typeof row.company_id==='string'&&typeof row.name==='string');
 return {status:response.status,rows:data,errorCode:null};
}
try{
 for(const label of ['editorA','readerA','ownerB']){actors[label]=await transport.login({...config.actors[label],label});check(label+' actual authenticated staging identity',true)}
 const A=actors.editorA.tenantId,B=actors.ownerB.tenantId;assert.notEqual(A,B);assert.equal(actors.readerA.tenantId,A);
 for(const label of ['editorA','readerA']){
  const result=await labels(actors[label],A,[A,B]);
  check(label+' receives only own enabled company name',result.status===200&&result.rows.length===1&&result.rows[0].company_id===A&&result.rows[0].name.trim().length>0&&result.rows[0].name!==A);
  const foreign=await labels(actors[label],B,[A,B]);check(label+' foreign current tenant denied',foreign.status>=400&&foreign.rows===null&&foreign.errorCode==='FORBIDDEN');
 }
 const other=await labels(actors.ownerB,B,[A,B]);check('other tenant receives only its own name',other.status===200&&other.rows.length===1&&other.rows[0].company_id===B&&other.rows[0].name.trim().length>0&&other.rows[0].name!==B);
 const absent=await labels(actors.editorA,A,['ffffffff-ffff-4fff-8fff-ffffffffffff']);check('unknown private company ID stays absent',absent.status===200&&absent.rows.length===0);
 const anonymous=await labels(null,A,[A,B]);check('anonymous label RPC denied',anonymous.status>=400&&anonymous.rows===null);
 const excessive=await labels(actors.editorA,A,Array(101).fill(A));check('excessive request rejected without labels',excessive.status>=400&&excessive.rows===null&&excessive.errorCode==='INVALID_REQUEST');
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=error?.name==='AssertionError'?String(error.message).split('\n')[0].slice(0,160):(/^(?:LABELS_|STAGING_|AUTH_)[A-Z_]+$/.test(error?.message??'')?error.message:'LABELS_TEST_FAILED');process.exitCode=1}
report.finishedAt=new Date().toISOString();
const file='reports/public-staging-hub-labels.json',bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');assertNoReportSecrets(file,bytes,{report:true});await writeFile(file,bytes);
console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error}));
