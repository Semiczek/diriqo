import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:4320';
async function login(fixture){const res=await fetch(base+'/api/session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({fixture})});assert.equal(res.status,200);return{Cookie:res.headers.get('set-cookie').split(';')[0],Origin:base,'X-Office-Tenant':fixture.startsWith('beta')?'beta':'alpha'};}
const a=await login('alpha-owner'),b=await login('beta-owner'),reader=await login('alpha-reader');
async function request(headers,value,status=200){const res=await fetch(base+'/api/office',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(value)});const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;}
const title='HTTP smoke '+new Date().toISOString();
const content={schemaVersion:1,kind:'document',doc:{type:'doc',content:[{type:'heading',attrs:{level:1},content:[{type:'text',text:'Ověření Office'}]},{type:'paragraph',content:[{type:'text',text:'Český dokument bez cloudového editoru.'}]}]},page:{marginMm:20,header:'Diriqo',footer:''}};
const created=await request(a,{op:'create',title,kind:'document',content,idempotencyKey:randomUUID()});const file=created.file;
await request(b,{op:'read',id:file.id},404);
await request(reader,{op:'save',id:file.id,expectedRevision:1,content,idempotencyKey:randomUUID()},403);
await request({...a,'X-Office-Tenant':'beta'},{op:'read',id:file.id},409);
const [one,two]=await Promise.all([request(a,{op:'rename',id:file.id,title:title+' updated',expectedRevision:1,idempotencyKey:randomUUID()}),fetch(base+'/api/office',{method:'POST',headers:{...a,'Content-Type':'application/json'},body:JSON.stringify({op:'save',id:file.id,expectedRevision:1,content,idempotencyKey:randomUUID()})})]);
assert.equal(one.file.revision,2);assert.equal(two.status,409);
const exported=await fetch(base+'/api/export?id='+file.id+'&format=docx',{headers:a}).then(r=>r.json());assert.ok(exported.base64);assert.ok(exported.warnings.length);
const original=Buffer.from(exported.base64,'base64');const form=new FormData();form.set('file',new File([original],'Smoke.docx'));form.set('idempotencyKey',randomUUID());
const importedRes=await fetch(base+'/api/import',{method:'POST',headers:a,body:form});const imported=await importedRes.json();assert.equal(importedRes.status,200,JSON.stringify(imported));
const originalOut=await fetch(base+'/api/export?id='+imported.file.id+'&format=original',{headers:a}).then(r=>r.json());assert.deepEqual(Buffer.from(originalOut.base64,'base64'),original);
const restored=await request(a,{op:'restore',id:file.id,expectedRevision:2,revision:1,idempotencyKey:randomUUID()});assert.equal(restored.file.revision,3);
const proposal=await request(a,{op:'propose',id:file.id,expectedRevision:3,content:{...content,page:{...content.page,footer:'Návrh ke schválení'}},summary:'Doplnění patičky – test schválení',idempotencyKey:randomUUID()});
const approve={op:'approve',id:file.id,expectedRevision:3,proposalId:proposal.proposal.id,idempotencyKey:randomUUID()};await request(reader,approve,403);const applied=await request(a,approve);assert.equal(applied.file.revision,4);assert.deepEqual(await request(a,approve),applied);
const report={at:new Date().toISOString(),result:'PASS',checks:['HTTP tenant isolation','reader write denied','active company mismatch denied','stale revision denied','worker DOCX import/export','immutable original bytes','restore','human approval with idempotent replay'],fileId:file.id};
await mkdir('reports',{recursive:true});await writeFile('reports/http-smoke.json',JSON.stringify(report,null,2)+'\n');console.log(report);
