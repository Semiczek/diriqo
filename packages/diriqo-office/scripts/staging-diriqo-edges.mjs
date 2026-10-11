import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateTarget} from './staging-target.mjs';
import {createStagingTransport} from './staging-transport.mjs';
const target=validateTarget(JSON.parse(await readFile('reports/staging-targets.json','utf8')),'diriqo');
const config=JSON.parse(await readFile('.staging/diriqo.credentials.json','utf8'));assert.equal(config.projectRef,target.projectRef);
const transport=createStagingTransport({target,publishableKey:config.publishableKey});
const report={projectRef:target.projectRef,startedAt:new Date().toISOString(),checks:[],status:'RUNNING'};
const check=(label,ok)=>{report.checks.push({label,passed:ok===true});assert.equal(ok,true,label);};
try{
 const actors={};for(const name of ['ownerA','readerA','ownerB'])actors[name]=await transport.login({...config.actors[name],label:name});
 const A=actors.ownerA.tenantId;
 const entities={job:{own:'b0e6608c-404a-4a20-af00-90b65636e3d9',foreign:'89043a4b-f206-4157-a1aa-0b0b537a3ee7'},customer:{own:'e915b459-ef2b-4b1c-a895-2b73b8a6c794',foreign:'e3bd140a-96cb-470f-9773-5b29b62b050e'}};
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
report.finishedAt=new Date().toISOString();await writeFile('reports/staging-diriqo-edges.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error}));
