import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateTarget} from './staging-target.mjs';
import {createStagingTransport} from './staging-transport.mjs';
const host=process.argv[2];
assert.ok(['hub','diriqo'].includes(host)&&process.argv.length===3,'Usage: node scripts/staging-host-edges.mjs hub|diriqo');
const target=validateTarget(JSON.parse(await readFile('reports/staging-targets.json','utf8')),host);
const config=JSON.parse(await readFile('.staging/'+host+'.credentials.json','utf8'));
assert.equal(config.schemaVersion,1);assert.equal(config.projectRef,target.projectRef);
const seed=JSON.parse(await readFile('.staging/'+host+'.seed.json','utf8'));
assert.equal(seed.schemaVersion,1);assert.equal(seed.host,host);assert.equal(seed.projectRef,target.projectRef);
assert.equal(seed.companies.A,config.actors.ownerA.tenantId);assert.equal(seed.companies.B,config.actors.ownerB.tenantId);
assert.notEqual(seed.companies.A,seed.companies.B);
const entityManifest=JSON.parse(await readFile('.staging/'+host+'.entities.json','utf8'));
assert.equal(entityManifest.projectRef,target.projectRef,'ENTITY_PROJECT_MISMATCH');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
for(const group of ['A','B'])for(const key of ['jobId','customerId'])assert.match(entityManifest.entities?.[group]?.[key]??'',UUID,'ENTITY_ID_INVALID');
assert.notEqual(entityManifest.entities.A.jobId,entityManifest.entities.B.jobId);
assert.notEqual(entityManifest.entities.A.customerId,entityManifest.entities.B.customerId);
const transport=createStagingTransport({target,publishableKey:config.publishableKey});
const report={host,projectRef:target.projectRef,startedAt:new Date().toISOString(),checks:[],status:'RUNNING'};
const check=(label,ok)=>{report.checks.push({label,passed:ok===true});assert.equal(ok,true,label);};
try{
 const actors={};for(const name of ['ownerA','readerA','ownerB'])actors[name]=await transport.login({...config.actors[name],label:name});
 const A=actors.ownerA.tenantId;
 const entities={job:{own:entityManifest.entities.A.jobId,foreign:entityManifest.entities.B.jobId},customer:{own:entityManifest.entities.A.customerId,foreign:entityManifest.entities.B.customerId}};
 const created=await transport.request(actors.ownerA,{op:'create',kind:'document',title:'Staging authorized links',content:{schemaVersion:1,kind:'document',doc:{type:'doc',content:[{type:'paragraph'}]},page:{marginMm:20,header:'',footer:''}},idempotencyKey:randomUUID()});
 check('link fixture created',created.status===200);let revision=1;const id=created.data.file.id;
 for(const [type,e]of Object.entries(entities)){
  const link={op:'link',id,expectedRevision:revision,type,entityId:e.own,idempotencyKey:randomUUID()};
  const reader=await transport.request(actors.readerA,link);check(type+' reader link denied',reader.errorCode==='FORBIDDEN');
  const foreign=await transport.request(actors.ownerA,{...link,entityId:e.foreign,idempotencyKey:randomUUID()});check(type+' foreign entity denied',foreign.status>=400&&foreign.errorCode==='NOT_FOUND');
  const own=await transport.request(actors.ownerA,link);check(type+' own entity linked',own.status===200&&own.data.file.link.id===e.own&&own.data.file.link.type===type&&own.data.file.revision===++revision);
 }
 for(const [name,actor]of Object.entries(actors)){
  for(const table of ['tenant_state','settings_events']){
   const r=await fetch(target.origin+'/rest/v1/'+table+'?select=*',{headers:{apikey:config.publishableKey,Authorization:'Bearer '+actor.accessToken,'Accept-Profile':'office_private'},redirect:'error',signal:AbortSignal.timeout(15000)});
   const body=await r.json();check(name+' direct '+table+' inaccessible',r.status>=400&&!Array.isArray(body));
  }
  const foreign=actor.tenantId===A?actors.ownerB.tenantId:A;
  const r=await fetch(target.origin+'/rest/v1/office_settings?select=company_id,enabled&company_id=eq.'+foreign,{headers:{apikey:config.publishableKey,Authorization:'Bearer '+actor.accessToken},redirect:'error',signal:AbortSignal.timeout(15000)});
  const body=await r.json();check(name+' foreign Office settings hidden',r.status===200&&Array.isArray(body)&&body.length===0);
  const update=await fetch(target.origin+'/rest/v1/office_settings?company_id=eq.'+actor.tenantId,{method:'PATCH',headers:{apikey:config.publishableKey,Authorization:'Bearer '+actor.accessToken,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({enabled:false}),redirect:'error',signal:AbortSignal.timeout(15000)});
  const updated=await update.json();check(name+' direct settings update denied',update.status>=400&&!Array.isArray(updated));
  check(name+' module stays enabled',(await transport.request(actor,{op:'list'})).status===200);
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error.message).slice(0,160);process.exitCode=1;}
report.finishedAt=new Date().toISOString();await writeFile('reports/staging-'+host+'-edges.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error}));
