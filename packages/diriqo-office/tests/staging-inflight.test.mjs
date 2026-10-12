import test from 'node:test';
import assert from 'node:assert/strict';
import {runInflightScenario,validateInflightFixture} from '../scripts/staging-inflight.mjs';

const fixture={schemaVersion:1,host:'diriqo',projectRef:'abcdefghijklmnopqrst',
 runId:'00000000-0000-4000-8000-000000000001',tenantId:'00000000-0000-4000-8000-000000000002',
 ownerUserId:'00000000-0000-4000-8000-000000000003',operatorUserId:'00000000-0000-4000-8000-000000000004',
 fileId:'00000000-0000-4000-8000-000000000005',createdAt:new Date().toISOString()};
const doc=suffix=>({schemaVersion:1,kind:'document',page:{marginMm:20,header:'',footer:''},
 doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Office staging in-flight '+fixture.runId+' / '+suffix}]}]}});
const success=data=>({status:200,errorCode:null,data});
function setup({throwDisable=false,failReenable=false}={}){
 let enabled=true,revision=1,content=doc('initial'),releaseSave,releaseDisable;
 const events=[],history=[{revision:1,content:structuredClone(content)}];
 const saveGate=new Promise(resolve=>{releaseSave=resolve;});
 const disableGate=new Promise(resolve=>{releaseDisable=resolve;});
 const request=async body=>{
  events.push('request-'+body.op);
  if(!enabled)return {status:400,errorCode:'MODULE_DISABLED',data:null};
  if(body.op==='save'){
   events.push('save-start');await saveGate;
   revision=2;content=structuredClone(body.content);history.push({revision,content:structuredClone(content)});
   events.push('save-complete');releaseDisable();
   return success({file:{id:fixture.fileId,tenantId:fixture.tenantId,revision,content}});
  }
  if(body.op==='versions')return success({versions:history});
  return success({file:{id:fixture.fileId,tenantId:fixture.tenantId,revision,content}});
 };
 const setEnabled=async value=>{
  if(!value){
   events.push('disable-start');
   setImmediate(releaseSave);
   await disableGate;
   enabled=false;events.push('disable-complete');
   if(throwDisable)throw new Error('secret provider message');
   return {status:200,data:false};
  }
  events.push('enable');
  if(failReenable)throw new Error('secret provider message');
  enabled=true;return {status:200,data:true};
 };
 return {request,setEnabled,events};
}
test('first Office request is save; disable overlap preserves exactly two revisions',async()=>{
 const context=setup();
 const report=await runInflightScenario({fixture,...context,sleep:async()=>{}});
 assert.equal(report.status,'HTTP_SCENARIO_PASS_DB_EVIDENCE_REQUIRED');
 assert.equal(report.moduleState,'ENABLED');assert.equal(report.databaseOverlapVerified,false);
 assert.equal(report.assertions.failed,0);
 assert.deepEqual(context.events.slice(0,5),['request-save','save-start','disable-start','save-complete','disable-complete']);
 assert.equal(context.events.filter(item=>item==='request-save').length,2);
 assert.ok(context.events.indexOf('enable')>context.events.indexOf('disable-complete'));
});
test('failed check still waits for delayed disable and restores the module',async()=>{
 const context=setup({throwDisable:true});
 const report=await runInflightScenario({fixture,...context,sleep:async()=>{}});
 assert.equal(report.status,'FAIL');assert.equal(report.moduleState,'ENABLED');
 assert.ok(context.events.indexOf('enable')>context.events.indexOf('disable-complete'));
 assert.equal(JSON.stringify(report).includes('secret'),false);
});
test('failed cleanup is explicit and does not claim module restored',async()=>{
 const context=setup({failReenable:true});
 const report=await runInflightScenario({fixture,...context,sleep:async()=>{}});
 assert.equal(report.status,'FAIL');assert.equal(report.moduleState,'UNKNOWN_REENABLE_FAILED');
 assert.equal(JSON.stringify(report).includes('secret'),false);
});
test('fixture must bind exact target and distinct authenticated identities',()=>{
 const target={projectRef:fixture.projectRef};
 const owner={userId:fixture.ownerUserId,tenantId:fixture.tenantId,principal:'human'};
 const operator={userId:fixture.operatorUserId,principal:'human'};
 assert.equal(validateInflightFixture(fixture,target,owner,operator),fixture);
 assert.throws(()=>validateInflightFixture({...fixture,url:'https://other.invalid'},target,owner,operator));
 assert.throws(()=>validateInflightFixture(fixture,{projectRef:'zyxwvutsrqponmlkjihgf'},owner,operator));
 assert.throws(()=>validateInflightFixture(fixture,target,owner,{...operator,userId:owner.userId}));
});
