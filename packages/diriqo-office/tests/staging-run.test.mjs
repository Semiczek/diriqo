import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateStagingConfig,parseArguments,executeStaging} from '../scripts/staging-run.mjs';

const target={host:'hub',projectRef:'abcdefghijklmnopqrst',parentRef:'yrxfozthravgbbcqklzy',origin:'https://abcdefghijklmnopqrst.supabase.co'};
function config(){
 const a=randomUUID(),b=randomUUID();
 return {schemaVersion:1,projectRef:target.projectRef,publishableKey:'sb_publishable_test_only_fixture',actors:Object.fromEntries(
  ['ownerA','editorA','readerA','ownerB','editorB','readerB','aiA'].map(name=>[name,{
   email:'office-'+name.toLowerCase()+'@office-staging.invalid',password:'local-test-password-never-used',userId:randomUUID(),tenantId:name.endsWith('B')?b:a,principal:name==='aiA'?'ai':'human'
  }]))};
}
test('staging config binds seven distinct synthetic identities to exactly two companies',()=>{
 assert.equal(validateStagingConfig(config(),target).schemaVersion,1);
 for(const mutate of [
  value=>{value.projectRef='another-staging';},
  value=>{value.actors.editorA.userId=value.actors.ownerA.userId;},
  value=>{value.actors.ownerB.tenantId=value.actors.ownerA.tenantId;},
  value=>{value.actors.readerA.tenantId=value.actors.ownerB.tenantId;},
  value=>{value.actors.aiA.principal='human';},
  value=>{value.actors.ownerA.email='real@example.com';},
  value=>{value.actors.ownerA.password='short';},
  value=>{value.serviceRoleKey='forbidden';},
  value=>{value.actors.ownerA.accessToken='forbidden';},
 ]){const value=config();mutate(value);assert.throws(()=>validateStagingConfig(value,target),/^Error: STAGING_/);}
});
test('CLI defaults to no network and rejects arbitrary URLs, hosts and unbounded rounds',()=>{
 assert.deepEqual(parseArguments(['--host','hub']),{host:'hub',execute:false,raceRounds:3,help:false});
 assert.equal(parseArguments(['--host','diriqo','--execute','--race-rounds','5']).execute,true);
 for(const args of [[],['--host','prod'],['--url','https://example.com'],['--host','hub','--race-rounds','6'],['--host','hub','--execute','--execute']])assert.throws(()=>parseArguments(args));
});
test('a failed real login never starts any RPC and report omits secrets',async()=>{
 const input=config();let calls=0;const snapshots=[];
 const result=await executeStaging({target,config:input,transportFactory:()=>({
  login:async()=>{throw Error('Provider leaked '+input.actors.ownerA.password);},
  request:async()=>{calls++;throw Error('must not happen');}
 }),onProgress:async report=>snapshots.push(structuredClone(report))});
 assert.equal(calls,0);assert.equal(result.status,'FAIL');assert.equal(result.acceptanceReady,false);
 assert.equal(result.failure,'STAGING_SCENARIO_FAILED');assert.equal(result.actors.length,0);
 assert.equal(JSON.stringify(snapshots).includes(input.actors.ownerA.password),false);
 assert.equal(JSON.stringify(snapshots).includes(input.publishableKey),false);
});
test('all identities are authenticated before suite writes; provider errors stay out of evidence',async()=>{
 const input=config();const order=[];
 const result=await executeStaging({target,config:input,transportFactory:()=>({
  login:async actor=>{order.push(actor.label);return {label:actor.label,userId:actor.userId,tenantId:actor.tenantId,principal:actor.principal,accessToken:'private-token'};},
  request:async()=>{order.push('request');throw Error('provider private-token');}
 })});
 assert.equal(order.slice(0,7).join(','),'ownerA,editorA,readerA,ownerB,editorB,readerB,aiA');
 assert.equal(order[7],'request');assert.equal(result.status,'FAIL');assert.equal(result.requestCount,1);
 assert.equal(JSON.stringify(result).includes('private-token'),false);
 assert.equal(result.actors.length,7);assert.ok(result.finishedAt);
});
