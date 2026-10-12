import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OfficeService} from '../src/server/service.ts';
import {FileStore} from '../src/server/store.ts';
import {importOfficeFile,exportOfficeFile,documentToText} from '../src/server/formats.ts';
import {alternativeOfficeFixtures,sampleText} from './fixtures/alternative-office.mjs';

const companyA={tenantId:'alpha',actorId:'alice',role:'owner',enabled:true,principal:'human'};
const companyB={...companyA,tenantId:'beta',actorId:'bob'};
const first=content=>content.workbook.sheets[content.workbook.sheetOrder[0]];
const unavailable=promise=>assert.rejects(promise,error=>error.code==='NOT_FOUND');

for(const fixture of alternativeOfficeFixtures()) test(`${fixture.name}: parse, persist, reopen and export retain original bytes and isolate companies`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'office-format-service-'));
 const path=join(directory,'state.json');
 try {
  const originalBytes=Buffer.from(fixture.bytes),originalHash=createHash('sha256').update(originalBytes).digest('hex');
  const parsed=await importOfficeFile(fixture.name,originalBytes);
  assert.equal(parsed.content.kind,fixture.kind);
  assert.deepEqual(parsed.original,{name:fixture.name,mime:fixture.mime,size:originalBytes.length,sha256:originalHash});
  assert.ok(parsed.warnings.length,'partial conversion warning reaches the upload caller');
  if(fixture.kind==='document') assert.match(documentToText(parsed.content),new RegExp(sampleText));
  else {
   const sheet=first(parsed.content);
   assert.equal(sheet.cellData[0][0].v,sampleText);
   assert.equal(sheet.cellData[1][0].v,'00123');
   if(fixture.exportFormat==='ods') assert.equal(sheet.cellData[0][3].f,'=SUM(B1:C1)');
   if(fixture.exportFormat==='xls') assert.equal(sheet.cellData[0][3].v,15);
   if(fixture.exportFormat==='tsv') {assert.equal(sheet.cellData[1][1].v,'=1+1');assert.equal(sheet.cellData[1][1].f,undefined);}
  }
  const service=new OfficeService(new FileStore(path));
  const input={title:fixture.name,content:parsed.content,original:{name:fixture.name,mime:parsed.original.mime,bytes:originalBytes},idempotencyKey:randomUUID()};
  const {file}=await service.import(companyA,input);
  const retry=await service.import(companyA,{...input,content:(await importOfficeFile(fixture.name,originalBytes)).content});
  assert.equal(retry.file.id,file.id,'reparse/retry creates only one file');
  assert.equal(file.tenantId,companyA.tenantId);assert.equal(file.ownerId,companyA.actorId);
  const edited=structuredClone(file.content);
  const change='Změna uložená zaměstnancem firmy A';
  if(edited.kind==='document') edited.doc.content.push({type:'paragraph',content:[{type:'text',text:change}]});
  else first(edited).cellData[0][0]={v:change,t:1};
  await service.request(companyA,{op:'save',id:file.id,expectedRevision:1,content:edited,idempotencyKey:randomUUID()});

  // A new service and store must reconstruct the saved data from disk.
  const reopened=new OfficeService(new FileStore(path));
  const saved=(await reopened.request(companyA,{op:'read',id:file.id})).file;
  assert.equal(saved.revision,2);assert.equal(saved.ownerId,companyA.actorId);assert.deepEqual(saved.content,edited);
  const original=await reopened.original(companyA,file.id);
  assert.equal(original.name,fixture.name);assert.equal(original.mime,fixture.mime);
  assert.deepEqual(Buffer.from(original.bytes),originalBytes);
  assert.equal(createHash('sha256').update(original.bytes).digest('hex'),originalHash);
  for(const op of ['read','versions']) await unavailable(reopened.request(companyB,{op,id:file.id}));
  await unavailable(reopened.original(companyB,file.id));
  await unavailable(reopened.recordExport(companyB,file.id,fixture.exportFormat));
  assert.deepEqual((await reopened.request(companyB,{op:'list'})).files,[]);

  await reopened.recordExport(companyA,file.id,fixture.exportFormat);
  const exported=exportOfficeFile(saved.content,saved.title,fixture.exportFormat);
  const converted=await importOfficeFile(exported.name,Buffer.from(exported.base64,'base64'));
  assert.equal(converted.content.kind,fixture.kind);
  if(fixture.kind==='document') assert.match(documentToText(converted.content),new RegExp(change));
  else assert.equal(first(converted.content).cellData[0][0].v,change);
  if(fixture.exportFormat==='xls') assert.match(exported.warnings.join(' '),/cached values only/);
  if(fixture.exportFormat==='tsv') {assert.equal(first(converted.content).cellData[1][1].v,"'=1+1");assert.equal(first(converted.content).cellData[1][1].f,undefined);}
  assert.deepEqual(Buffer.from((await reopened.original(companyA,file.id)).bytes),originalBytes,'export never overwrites the uploaded file');
  const versions=(await reopened.request(companyA,{op:'versions',id:file.id})).versions;
  assert.equal(versions.length,2);assert.deepEqual(versions[0].content,parsed.content);
  const restored=await reopened.request(companyA,{op:'restore',id:file.id,expectedRevision:2,revision:1,idempotencyKey:randomUUID()});
  assert.equal(restored.file.revision,3);assert.deepEqual(restored.file.content,parsed.content);
  assert.deepEqual(Buffer.from((await reopened.original(companyA,file.id)).bytes),originalBytes,'restoration does not change the original');
 } finally {
  // Delete only the exact synthetic state file created by this test, then its empty directory.
  await rm(path,{force:true});await rmdir(directory);
 }
});
