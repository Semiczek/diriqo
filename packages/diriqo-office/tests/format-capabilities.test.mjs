import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {OFFICE_DOCUMENT_EXPORT_FORMATS,OFFICE_SPREADSHEET_EXPORT_FORMATS,OFFICE_IMPORT_FORMATS,OFFICE_IMPORT_ONLY_FORMATS,OFFICE_IMPORT_EXTENSIONS,isOfficeExportAuditFormat,isOfficeDownloadFormat} from '../src/core/formats.ts';
import {validateExportAuditFormat} from '../src/core/validation.ts';
import {blankDocument} from '../src/core/templates.ts';
import {OfficeService} from '../src/server/service.ts';
import {SupabaseOfficeService} from '../src/server/supabase-service.ts';
import {MemoryStore} from '../src/server/store.ts';
import {getOfficeMessages} from '../src/client/locales.ts';

const actor={tenantId:'alpha',actorId:'alice',role:'owner',enabled:true,principal:'human'};

test('format capabilities distinguish binary DOC text recovery from genuine export targets',()=>{
 assert.deepEqual(OFFICE_IMPORT_ONLY_FORMATS,['doc']);
 for(const format of ['odt','doc','ods','xls','tsv'])assert.ok(OFFICE_IMPORT_FORMATS.includes(format));
 assert.ok(OFFICE_DOCUMENT_EXPORT_FORMATS.includes('odt'));
 for(const format of ['ods','xls','tsv'])assert.ok(OFFICE_SPREADSHEET_EXPORT_FORMATS.includes(format));
 assert.equal(isOfficeExportAuditFormat('doc'),false);
 assert.equal(isOfficeDownloadFormat('doc'),false);
 assert.equal(isOfficeDownloadFormat('original'),true);
 assert.equal(isOfficeExportAuditFormat('original'),false);
 assert.equal(isOfficeExportAuditFormat('print'),true);
 assert.ok(OFFICE_IMPORT_EXTENSIONS.split(',').includes('.htm'));
 for(const value of ['DOCX','xlsm','docm','pdf','exe',null,{},42]){
  if(value!=='pdf')assert.equal(isOfficeExportAuditFormat(value),false);
  if(typeof value==='string')assert.equal(OFFICE_IMPORT_EXTENSIONS.split(',').includes('.'+value),false);
 }
 for(const value of ['doc','exe',null,{},42])assert.throws(()=>validateExportAuditFormat(value),error=>error.code==='UNSUPPORTED_FORMAT');
});

test('new export audit formats preserve file and tenant guards and do not overwrite originals',async()=>{
 const store=new MemoryStore(),service=new OfficeService(store),original=Buffer.from('immutable original');
 const {file}=await service.import(actor,{title:'Imported',content:blankDocument(),original:{name:'source.txt',mime:'text/plain',bytes:original},idempotencyKey:randomUUID()});
 for(const format of ['odt','ods','xls','tsv']){
  await service.recordExport(actor,file.id,format);
  await assert.rejects(service.recordExport({...actor,tenantId:'beta'},file.id,format),error=>error.code==='NOT_FOUND');
  await assert.rejects(service.recordExport({...actor,enabled:false},file.id,format),error=>error.code==='MODULE_DISABLED');
 }
 await assert.rejects(service.recordExport(actor,file.id,'doc'),error=>error.code==='UNSUPPORTED_FORMAT');
 assert.deepEqual(Buffer.from((await service.original(actor,file.id)).bytes),original);
 const exports=await store.transaction(actor.tenantId,state=>state.audit.filter(event=>event.operation==='export'));
 assert.deepEqual(exports.map(event=>event.details.format),['odt','ods','xls','tsv']);
 assert.ok(exports.every(event=>event.actorId===actor.actorId&&event.fileId===file.id));
});

test('Supabase export audit passes only the verified format with the existing actor company scope',async()=>{
 const calls=[],service=new SupabaseOfficeService({async rpc(name,args){calls.push({name,args});return {data:{},error:null};}});
 for(const format of ['odt','ods','xls','tsv'])await service.recordExport(actor,'file-1',format);
 assert.deepEqual(calls.map(call=>call.args.p_request.format),['odt','ods','xls','tsv']);
 assert.ok(calls.every(call=>call.name==='office_request'&&call.args.p_company_id==='alpha'&&call.args.p_principal==='human'&&call.args.p_request.id==='file-1'));
 await assert.rejects(service.recordExport(actor,'file-1','doc'),error=>error.code==='UNSUPPORTED_FORMAT');
 await assert.rejects(service.recordExport({...actor,enabled:false},'file-1','ods'),error=>error.code==='MODULE_DISABLED');
 assert.equal(calls.length,4);
});

test('all supported UI languages explain conversion limits and DOC import-only recovery',()=>{
 for(const locale of ['cs','sk','en','de','pl','tr','sq']){
  const messages=getOfficeMessages(locale);
  assert.ok(messages.importCompatibility.length>50,locale);
  assert.match(messages.legacyDocNote,/DOC/);assert.match(messages.legacyDocNote,/DOCX/);assert.match(messages.legacyDocNote,/ODT/);
  assert.match(messages.xlsValuesOnly,/XLS \(.+\)/);assert.match(messages.xlsExportNote,/XLSX/);assert.match(messages.xlsExportNote,/ODS/);
 }
 assert.match(getOfficeMessages('en').legacyDocNote,/text import only, without formatting or images/);
 assert.match(getOfficeMessages('en').xlsExportNote,/last calculated values without formulas/);
});
