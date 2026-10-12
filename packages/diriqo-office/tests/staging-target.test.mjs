import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTarget} from '../scripts/staging-target.mjs';

const NOW=Date.parse('2026-10-11T12:00:00.000Z');
function manifest(){
 return {schemaVersion:1,hosts:{
  hub:{projectRef:'abcdefghijklmnopqrst',parentRef:'yrxfozthravgbbcqklzy',organizationId:'ljkxtwounsysoalxgsvw',
   branchId:'11111111-1111-4111-8111-111111111111',name:'office-staging-20261011',verifiedAt:new Date(NOW).toISOString()},
  diriqo:{projectRef:'zyxwvutsrqponmlkjihg',parentRef:'wfcpfraxiuhuglnuaxqj',organizationId:'uxtwbwyxadetdybttoug',
   branchId:'22222222-2222-4222-8222-222222222222',name:'office-staging-20261011',verifiedAt:new Date(NOW).toISOString()}
 }};
}
const validate=(value,host='hub')=>validateTarget(value,host,{now:NOW});
const unsafe=fn=>assert.throws(fn,error=>error.code==='UNSAFE_STAGING_TARGET');
test('staging target is derived, frozen and detached from its manifest',()=>{
 const source=manifest(),before=structuredClone(source);
 const result=validate(source);
 assert.deepEqual(result,{host:'hub',projectRef:'abcdefghijklmnopqrst',parentRef:'yrxfozthravgbbcqklzy',
  organizationId:'ljkxtwounsysoalxgsvw',branchId:'11111111-1111-4111-8111-111111111111',
  origin:'https://abcdefghijklmnopqrst.supabase.co'});
 assert.ok(Object.isFrozen(result));
 assert.deepEqual(source,before,'validation must not mutate input');
 source.hosts.hub.projectRef='aaaaaaaaaaaaaaaaaaaa';
 assert.equal(result.projectRef,'abcdefghijklmnopqrst');
 assert.throws(()=>{result.origin='https://example.test';},TypeError);
 assert.equal(validate(manifest(),'diriqo').origin,'https://zyxwvutsrqponmlkjihg.supabase.co');
});
test('production references are rejected under either host and in the unselected host',()=>{
 for(const production of ['wfcpfraxiuhuglnuaxqj','yrxfozthravgbbcqklzy']){
  for(const host of ['hub','diriqo']){
   const source=manifest();source.hosts[host].projectRef=production;
   unsafe(()=>validate(source,host));
   unsafe(()=>validate(source,host==='hub'?'diriqo':'hub'));
  }
 }
});
test('unknown hosts and malformed reference or URL payloads are rejected',()=>{
 for(const host of ['other','__proto__','Hub',null,undefined])unsafe(()=>validateTarget(manifest(),host,{now:NOW}));
 for(const ref of ['','unknown','ABCDEFGHIJKLMNOPQRST','abcdefghijklmnopqrs1','a'.repeat(21),
  'abcdefghijklmnopqrst.evil.test','https://abcdefghijklmnopqrst.supabase.co','abcdefghijklmnopqrs/','abcdefghijklmnopqrs\n']){
  const source=manifest();source.hosts.hub.projectRef=ref;unsafe(()=>validate(source));
 }
});
test('host switching requires the correct fixed parent and organization',()=>{
 for(const field of ['parentRef','organizationId']){
  const source=manifest();source.hosts.hub[field]=source.hosts.diriqo[field];unsafe(()=>validate(source));
 }
 const swapped=manifest();[swapped.hosts.hub,swapped.hosts.diriqo]=[swapped.hosts.diriqo,swapped.hosts.hub];
 unsafe(()=>validate(swapped));unsafe(()=>validate(swapped,'diriqo'));
});
test('both populated targets are validated and may not share a project reference',()=>{
 const source=manifest();source.hosts.diriqo.projectRef=source.hosts.hub.projectRef;unsafe(()=>validate(source));
 const stale=manifest();stale.hosts.diriqo.verifiedAt=new Date(NOW-86400001).toISOString();unsafe(()=>validate(stale));
 const one=manifest();delete one.hosts.diriqo;
 assert.equal(validate(one).host,'hub');unsafe(()=>validate(one,'diriqo'));
 for(const empty of [null,undefined,false,[]]){
  const invalid=manifest();invalid.hosts.diriqo=empty;unsafe(()=>validate(invalid));
 }
});
test('verification freshness permits exact boundaries and rejects older or future timestamps',()=>{
 for(const delta of [-86400000,300000]){
  const source=manifest();source.hosts.hub.verifiedAt=new Date(NOW+delta).toISOString();assert.equal(validate(source).host,'hub');
 }
 for(const delta of [-86400001,300001]){
  const source=manifest();source.hosts.hub.verifiedAt=new Date(NOW+delta).toISOString();unsafe(()=>validate(source));
 }
 const seconds=manifest();seconds.hosts.hub.verifiedAt='2026-10-11T12:00:00Z';assert.equal(validate(seconds).host,'hub');
 for(const timestamp of ['not-a-date','2026-02-30T12:00:00.000Z','2026-10-11','2026-10-11T14:00:00+02:00',NOW,null]){
  const source=manifest();source.hosts.hub.verifiedAt=timestamp;unsafe(()=>validate(source));
 }
 for(const now of [NaN,Infinity,-1,'2026-10-11',1.5])unsafe(()=>validateTarget(manifest(),'hub',{now}));
});
test('extra URL fields and other hidden configuration are rejected at every level',()=>{
 for(const field of ['origin','url','apiUrl','token']){
  const source=manifest();source.hosts.hub[field]='https://example.test';unsafe(()=>validate(source));
 }
 const rootExtra={...manifest(),origin:'https://example.test'};unsafe(()=>validate(rootExtra));
 const hostExtra=manifest();hostExtra.hosts.production={};unsafe(()=>validate(hostExtra));
 const hidden=manifest();Object.defineProperty(hidden.hosts.hub,'origin',{value:'https://example.test',enumerable:false});unsafe(()=>validate(hidden));
 const symbolic=manifest();symbolic.hosts.hub[Symbol('origin')]='https://example.test';unsafe(()=>validate(symbolic));
 const inherited=manifest();inherited.hosts.hub=Object.create(inherited.hosts.hub);unsafe(()=>validate(inherited));
 const accessor=manifest();let getterRan=false;Object.defineProperty(accessor.hosts.hub,'projectRef',{get(){getterRan=true;return 'abcdefghijklmnopqrst';},enumerable:true});
 unsafe(()=>validate(accessor));assert.equal(getterRan,false,'reject accessors without invoking them');
});
test('manifest, target, UUID and branch name shapes fail closed',()=>{
 for(const source of [null,[],{},'manifest',{schemaVersion:'1',hosts:manifest().hosts},{schemaVersion:2,hosts:manifest().hosts}])unsafe(()=>validate(source));
 for(const field of ['projectRef','parentRef','organizationId','branchId','name','verifiedAt']){
  const source=manifest();delete source.hosts.hub[field];unsafe(()=>validate(source));
 }
 for(const branchId of ['not-a-uuid','11111111111141118111111111111111','11111111-1111-4111-8111-11111111111g',123]){
  const source=manifest();source.hosts.hub.branchId=branchId;unsafe(()=>validate(source));
 }
 for(const name of ['production','OFFICE-STAGING','office-staging\nother','office-staging'+'.'.repeat(200),null]){
  const source=manifest();source.hosts.hub.name=name;unsafe(()=>validate(source));
 }
});
