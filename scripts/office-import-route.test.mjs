// Native multipart, installed worker, Diriqo authorization and real service validation.
// Only the database RPC boundary is simulated; no database or network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import vm from 'node:vm';
import * as office from '@diriqo/office/server';

const host=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(resolve(host,'package.json')),ts=require('typescript');
const A='00000000-0000-4000-8000-000000001001',B='00000000-0000-4000-8000-000000001002';
const ORIGIN='https://office.invalid',PARENT='folder-test',KEY='import-retry-fixed';
const privateMarker='PRIVATE-filename-content-token';

function harness({role='manager',authenticated=true,enabled=true,workerFailure,persistFailure}={}){
 const events=[],writes=[],logs=[],parsed=[],rpcWrites=[];
 const actorContext={companyId:A,companyName:'Synthetic company A',profileId:'profile-a',role};
 const supabase={
  auth:{getUser:async()=>{events.push('auth');return{data:{user:authenticated?{id:'auth-a'}:null},error:null};}},
  from(table){
   if(table==='profiles')return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:'profile-a',auth_user_id:'auth-a',user_id:'auth-a'},error:null})};
   assert.equal(table,'office_settings','The test must never read document or business data');
   events.push('settings');
   return{select(columns){assert.equal(columns,'enabled');return this;},eq(key,value){assert.equal(key,'company_id');assert.equal(value,A);return this;},maybeSingle:async()=>({data:{enabled},error:null})};
  },
  async rpc(name,args){
   events.push('rpc');assert.equal(name,'office_request');
   assert.deepEqual(Object.keys(args).sort(),['p_company_id','p_principal','p_request']);
   assert.equal(args.p_company_id,A);assert.equal(args.p_principal,'human');
   const input=args.p_request;assert.equal(input.op,'import');
   assert.deepEqual(Object.keys(input).sort(),['content','idempotencyKey','op','original','parentId','title']);
   assert.deepEqual(Object.keys(input.original).sort(),['base64','mime','name','sha256','size']);
   const original=Buffer.from(input.original.base64,'base64');
   assert.equal(input.original.size,original.length);assert.equal(input.original.sha256,createHash('sha256').update(original).digest('hex'));
   rpcWrites.push(structuredClone(args));
   return{data:{file:{id:'saved-file',title:input.title,tenantId:args.p_company_id,revision:1,kind:input.content.kind}},error:null};
  },
 };
 class Service extends office.SupabaseOfficeService{
  constructor(client){assert.equal(client,supabase);super(client);events.push('service');}
  async import(actor,input){
   events.push('persist');
   if(persistFailure)throw persistFailure;
   // Do not bypass validation: parser output can still contain a formula that
   // the editing engine cannot safely execute. The real service must decide.
   const result=await super.import(actor,input);
   writes.push({actor:structuredClone(actor),input:structuredClone(input)});
   return result;
  }
 }
 const mocks={
  'server-only':{},
  'next/server':{NextResponse:{json:(body,options)=>new Response(JSON.stringify(body),options)}},
  'next/headers':{cookies:async()=>({get:key=>key==='active_company_id'?{value:A}:undefined})},
  '@/lib/active-company':{getActiveCompanyContext:async()=>{events.push('active');return actorContext;}},
  '@/lib/supabase-server':{createSupabaseServerClient:async()=>{events.push('client');return supabase;}},
  '@diriqo/office/server':{
   ...office,SupabaseOfficeService:Service,
   assertOfficeRequestOrigin(request,origin){events.push('origin');return office.assertOfficeRequestOrigin(request,origin);},
   async readBoundedOfficeMultipart(request,max){events.push('multipart');return office.readBoundedOfficeMultipart(request,max);},
   async importOfficeFileBounded(name,bytes,worker){
    events.push('worker');assert.equal(fileURLToPath(worker),resolve(host,'node_modules/@diriqo/office/dist/import-worker.js'));
    if(workerFailure)throw workerFailure;
    const result=await office.importOfficeFileBounded(name,bytes,worker);parsed.push(result);return result;
   },
  },
 };
 const globals={Error,Set,Map,URL,Request,Response,File,FormData,Headers,Uint8Array,Buffer,TextEncoder,TextDecoder,
  crypto:{randomUUID},process:{cwd:()=>host,env:{OFFICE_PUBLIC_ORIGIN:ORIGIN}},
  console:{warn:(...args)=>logs.push(args),log(){throw Error('Unexpected route log');},error(){throw Error('Unexpected route error log');}},
 };
 const cache=new Map();
 function load(filename){
  if(cache.has(filename))return cache.get(filename).exports;
  const testModule={exports:{}};cache.set(filename,testModule);
  const output=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const localRequire=id=>{
   if(Object.hasOwn(mocks,id))return mocks[id];
   if(id.startsWith('node:'))return require(id);
   const base=id.startsWith('@/')?resolve(host,id.slice(2)):id.startsWith('.')?resolve(dirname(filename),id):null;
   if(!base)throw Error('Unexpected module '+id);
   const path=[base,base+'.ts'].find(existsSync);assert.ok(path,'Missing '+base);return load(path);
  };
  vm.runInNewContext('(function(require,module,exports){'+output+'\n})',globals,{filename})(localRequire,testModule,testModule.exports);
  return testModule.exports;
 }
 return{...load(resolve(host,'app/api/office/files/route.ts')),events,writes,logs,parsed,rpcWrites};
}

const doc={schemaVersion:1,kind:'document',page:{marginMm:20,header:'',footer:''},doc:{type:'doc',content:[{type:'heading',attrs:{level:1},content:[{type:'text',text:'Nabídka'}]},{type:'paragraph',content:[{type:'text',text:'Žluťoučký kůň'}]}]}};
const sheet={schemaVersion:1,kind:'spreadsheet',workbook:{id:'book',name:'Kalkulace',styles:{},sheetOrder:['one'],sheets:{one:{id:'one',name:'Kalkulace',rowCount:1000,columnCount:26,cellData:{0:{0:{v:'Materiál',t:1},1:{v:125,t:2}},1:{0:{v:'Práce',t:1},1:{v:75,t:2}}},mergeData:[]}}}};
const fileFor=format=>{const exported=office.exportOfficeFile(['xls','xlsx'].includes(format)?sheet:doc,'Test uploadu',format);return{name:exported.name,mime:exported.mime,bytes:Buffer.from(exported.base64,'base64')};};
// Minimal stored ZIP fixtures keep route regressions independent of new deps.
function storedZip(entries){
 const locals=[],centrals=[];let offset=0;
 for(const [filename,value]of Object.entries(entries)){
  const name=Buffer.from(filename),bytes=Buffer.from(value);let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  crc=(crc^0xffffffff)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);
  local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
  locals.push(local,name,bytes);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  centrals.push(central,name);offset+=local.length+name.length+bytes.length;
 }
 const directory=Buffer.concat(centrals),end=Buffer.alloc(22),count=Object.keys(entries).length;
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,directory,end]);
}
function request(file,{tenant=A,origin=ORIGIN,hostHeader='office.invalid',parent=PARENT,key=KEY,headers={},extraFields={}}={}){
 const form=new FormData();form.set('file',new File([file.bytes],file.name,{type:file.mime}));
 if(parent!==null)form.set('parentId',parent);if(key!==null)form.set('idempotencyKey',key);
 for(const [name,value]of Object.entries(extraFields))form.set(name,value);
 return new Request(ORIGIN+'/api/office/files',{method:'POST',headers:{origin,host:hostHeader,'sec-fetch-site':'same-origin','x-office-tenant':tenant,...headers},body:form});
}
const text=node=>node.text??(node.content??[]).map(text).join('');
function rejectionLog(h,body,phase){
 assert.equal(h.logs.length,1);assert.equal(h.logs[0][0],'office_upload_rejected');
 const logged=h.logs[0][1];assert.deepEqual(Object.keys(logged).sort(),['code','phase','requestId']);
 assert.equal(logged.code,body.error);assert.equal(logged.phase,phase);assert.equal(logged.requestId,body.requestId);
 assert.match(logged.requestId,/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i);
 assert.ok(!JSON.stringify(h.logs).includes(privateMarker));assert.ok(!JSON.stringify(h.logs).includes(A));
}

for(const format of ['odt','xls','docx','xlsx','txt'])test(`Office POST ${format.toUpperCase()} uses native multipart and installed worker, preserving tenant and original bytes`,async()=>{
 const h=harness(),file=fileFor(format),before=Buffer.from(file.bytes);
 const response=await h.POST(request(file,{extraFields:{companyId:B,actorId:'forged-user'}})),body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal(body.file.tenantId,A);assert.equal(body.file.id,'saved-file');assert.equal(h.writes.length,1);
 const {actor,input}=h.writes[0];assert.equal(actor.tenantId,A);assert.equal(actor.actorId,'profile-a');assert.equal(actor.role,'editor');
 assert.equal(input.title,file.name);assert.equal(input.parentId,PARENT);assert.equal(input.idempotencyKey,KEY);
 assert.equal(input.original.name,file.name);assert.equal(input.original.mime,file.mime);assert.deepEqual(Buffer.from(input.original.bytes),before);assert.deepEqual(file.bytes,before);
 assert.equal(h.parsed[0].original.sha256,createHash('sha256').update(before).digest('hex'));
 if(['xls','xlsx'].includes(format)){const s=input.content.workbook.sheets[input.content.workbook.sheetOrder[0]];assert.equal(s.cellData[0][0].v,'Materiál');assert.equal(s.cellData[1][1].v,75);}
 else assert.match(text(input.content.doc),/Žluťoučký kůň/);
 assert.equal(h.rpcWrites.length,1);assert.deepEqual(Buffer.from(h.rpcWrites[0].p_request.original.base64,'base64'),before);
 assert.deepEqual(h.events,['origin','active','client','auth','settings','multipart','worker','service','persist','rpc']);assert.equal(h.logs.length,0);
});

test('Office POST imports empty ODT forms plus historical template metadata through real service validation',async()=>{
 const mime='application/vnd.oasis.opendocument.text',officeNs='urn:oasis:names:tc:opendocument:xmlns:office:1.0';
 const template='http://127.0.0.1/template-never-fetch.ott';
 const bytes=storedZip({
  mimetype:mime,
  'META-INF/manifest.xml':`<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
  'content.xml':`<office:document-content xmlns:office="${officeNs}" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:form="urn:oasis:names:tc:opendocument:xmlns:form:1.0" office:version="1.3"><office:body><office:text><office:forms form:automatic-focus="false" form:apply-design-mode="false"/><text:h text:outline-level="1">Nabídka</text:h><text:p>Žluťoučký kůň</text:p></office:text></office:body></office:document-content>`,
  'meta.xml':`<office:document-meta xmlns:office="${officeNs}" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"><office:meta><meta:template xlink:href="${template}" xlink:type="simple" xlink:actuate="onRequest" meta:date="2026-10-13T12:00:00"/></office:meta></office:document-meta>`,
 });
 const h=harness(),before=Buffer.from(bytes),response=await h.POST(request({name:'writer-fixture.odt',mime,bytes})),body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(h.rpcWrites.length,1);assert.equal(h.writes.length,1);
 const stored=h.rpcWrites[0].p_request;assert.equal(text(stored.content.doc),'NabídkaŽluťoučký kůň');assert.equal(stored.content.doc.content[0].type,'heading');
 assert.match(body.warnings.join(' '),/template provenance metadata was omitted.*not loaded/);
 assert.ok(!JSON.stringify(stored.content).includes(template));assert.deepEqual(Buffer.from(stored.original.base64,'base64'),before);assert.deepEqual(bytes,before);
 assert.equal(h.logs.length,0);
});

test('Office POST XLSX SUBTOTAL static range survives real service validation and original encoding',async()=>{
 const content=structuredClone(sheet);content.workbook.sheets.one.cellData[2]={1:{v:200,t:2,f:'=SUBTOTAL(9,B1:B2)'}};
 const exported=office.exportOfficeFile(content,'Subtotal fixture','xlsx'),bytes=Buffer.from(exported.base64,'base64'),before=Buffer.from(bytes);
 const h=harness(),response=await h.POST(request({name:exported.name,mime:exported.mime,bytes})),body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(h.rpcWrites.length,1);assert.equal(h.writes.length,1);
 const stored=h.rpcWrites[0].p_request,book=stored.content.workbook,importedSheet=book.sheets[book.sheetOrder[0]];
 assert.equal(importedSheet.cellData[2][1].f,'=SUBTOTAL(9,B1:B2)');assert.equal(importedSheet.cellData[0][1].v,125);assert.equal(importedSheet.cellData[1][1].v,75);
 assert.equal(h.rpcWrites[0].p_company_id,A);assert.deepEqual(Buffer.from(stored.original.base64,'base64'),before);assert.deepEqual(bytes,before);assert.equal(h.logs.length,0);
});

test('Office POST XLSX unquoted Czech sheet references survive real service validation',async()=>{
 const content=structuredClone(sheet),formula='=Vícepráce!B1+Vícepráce!B2';
 content.workbook.sheets.two={...structuredClone(content.workbook.sheets.one),id:'two',name:'Vícepráce'};
 content.workbook.sheetOrder.push('two');
 content.workbook.sheets.one.name='Souhrn';content.workbook.sheets.one.cellData={0:{0:{v:200,t:2,f:formula}}};
 const exported=office.exportOfficeFile(content,'Czech sheet fixture','xlsx'),bytes=Buffer.from(exported.base64,'base64'),before=Buffer.from(bytes);
 const h=harness(),response=await h.POST(request({name:exported.name,mime:exported.mime,bytes})),body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(h.rpcWrites.length,1);assert.equal(h.writes.length,1);
 const stored=h.rpcWrites[0].p_request,book=stored.content.workbook,[summaryId,detailId]=book.sheetOrder;
 assert.equal(book.sheetOrder.length,2);assert.equal(book.sheets[summaryId].name,'Souhrn');assert.equal(book.sheets[detailId].name,'Vícepráce');
 assert.equal(book.sheets[summaryId].cellData[0][0].f,formula);assert.equal(book.sheets[detailId].cellData[0][1].v,125);assert.equal(book.sheets[detailId].cellData[1][1].v,75);
 assert.equal(h.rpcWrites[0].p_company_id,A);assert.deepEqual(Buffer.from(stored.original.base64,'base64'),before);assert.deepEqual(bytes,before);assert.equal(h.logs.length,0);
});

test('Office POST forwards retry identity unchanged and safely supplies optional defaults',async()=>{
 const h=harness(),file=fileFor('txt');
 for(let i=0;i<2;i++)assert.equal((await h.POST(request(file))).status,200);
 assert.deepEqual(h.writes.map(write=>write.input.idempotencyKey),[KEY,KEY]);
 assert.equal((await h.POST(request(file,{parent:null,key:null}))).status,200);
 assert.equal(h.writes[2].input.parentId,null);assert.match(h.writes[2].input.idempotencyKey,/^[a-f\d-]{36}$/i);
});

test('Office POST rejects origin and tenant before reading multipart or starting a worker',async()=>{
 for(const options of [{origin:'https://foreign.invalid'},{hostHeader:'foreign.invalid'},{tenant:B}]){
  const h=harness(),req=request(fileFor('txt'),options),response=await h.POST(req),body=await response.json();
  assert.equal(response.status,400);assert.equal(body.error,options.tenant?'OFFICE_TENANT_CHANGED':'OFFICE_FORBIDDEN');
  assert.equal(req.bodyUsed,false);assert.equal(h.events.includes('multipart'),false);assert.equal(h.events.includes('worker'),false);assert.equal(h.writes.length,0);assert.equal(h.logs.length,0);
  if(!options.tenant)assert.deepEqual(h.events,['origin']);
 }
});

test('Office POST real host authorization rejects readers, revoked login and disabled Office before parsing',async()=>{
 for(const options of [{role:'worker'},{role:'user'},{authenticated:false},{enabled:false}]){
  const h=harness(options),req=request(fileFor('txt')),response=await h.POST(req),body=await response.json();
  assert.equal(response.status,400);assert.equal(body.error,options.authenticated===false?'OFFICE_UNAUTHENTICATED':options.enabled===false?'OFFICE_DISABLED':'OFFICE_FORBIDDEN');
  assert.equal(req.bodyUsed,false);assert.equal(h.events.includes('multipart'),false);assert.equal(h.events.includes('worker'),false);assert.equal(h.writes.length,0);assert.equal(h.logs.length,0);
 }
});

test('Office POST malformed ODT/XLS is rejected by the real installed parser without persistence or raw logging',async()=>{
 for(const extension of ['odt','xls']){
  const h=harness(),file={name:privateMarker+'.'+extension,mime:'application/octet-stream',bytes:Buffer.from(privateMarker)};
  const response=await h.POST(request(file)),body=await response.json();
  assert.equal(response.status,422);assert.equal(body.error,'OFFICE_IMPORT_FORMAT');assert.deepEqual(Object.keys(body).sort(),['error','requestId']);
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(h.writes.length,0);assert.equal(h.events.includes('service'),false);rejectionLog(h,body,'import');
 }
});

test('Office POST malformed multipart fails before worker and logs only the fixed category',async()=>{
 const h=harness(),req=new Request(ORIGIN+'/api/office/files',{method:'POST',headers:{origin:ORIGIN,host:'office.invalid','x-office-tenant':A,'content-type':'multipart/form-data; boundary=missing'},body:privateMarker});
 const response=await h.POST(req),body=await response.json();assert.equal(response.status,400);assert.equal(body.error,'OFFICE_UPLOAD_INVALID');
 assert.equal(h.events.includes('worker'),false);assert.equal(h.writes.length,0);rejectionLog(h,body,'multipart');
});

test('Office POST malformed DEFLATE is a format error through the actual bounded worker, not a server outage',async()=>{
 const file=fileFor('odt');file.name=privateMarker+'.odt';file.bytes=Buffer.from(file.bytes);
 const end=file.bytes.length-22;assert.equal(file.bytes.readUInt32LE(end),0x06054b50);
 let position=file.bytes.readUInt32LE(end+16),changed=false;
 for(let i=0;i<file.bytes.readUInt16LE(end+10);i++){
  assert.equal(file.bytes.readUInt32LE(position),0x02014b50);
  const nameLength=file.bytes.readUInt16LE(position+28),extraLength=file.bytes.readUInt16LE(position+30),commentLength=file.bytes.readUInt16LE(position+32);
  const name=file.bytes.subarray(position+46,position+46+nameLength).toString();
  if(name==='content.xml'){
   assert.equal(file.bytes.readUInt16LE(position+10),8,'Fixture XML must use DEFLATE');
   const local=file.bytes.readUInt32LE(position+42),payload=local+30+file.bytes.readUInt16LE(local+26)+file.bytes.readUInt16LE(local+28);
   file.bytes[payload]=7; // BFINAL=1, reserved BTYPE=3; ZIP headers remain valid.
   changed=true;break;
  }
  position+=46+nameLength+extraLength+commentLength;
 }
 assert.equal(changed,true);
 await assert.rejects(()=>office.importOfficeFile(file.name,file.bytes),{code:'Z_DATA_ERROR'});
 const before=Buffer.from(file.bytes),h=harness(),response=await h.POST(request(file)),body=await response.json();
 assert.equal(response.status,422);assert.equal(body.error,'OFFICE_IMPORT_FORMAT');assert.deepEqual(Object.keys(body).sort(),['error','requestId']);
 assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(h.events.includes('worker'),true);assert.equal(h.events.includes('service'),false);assert.equal(h.writes.length,0);
 assert.deepEqual(file.bytes,before);rejectionLog(h,body,'import');
 assert.ok(!JSON.stringify({body,logs:h.logs}).includes('invalid block type'));
});

test('Office POST accepts only exact known zlib diagnostics after worker code loss',async()=>{
 const known=['invalid block type','invalid stored block lengths','invalid code lengths set','invalid literal/lengths set',
  'invalid distances set','invalid distance too far back','invalid distance code','invalid literal/length code','unexpected end of file'];
 for(const message of [...known,'invalid block type '+privateMarker,'prefix invalid block type','unknown compression failure']){
  const h=harness({workerFailure:new Error(message)}),response=await h.POST(request(fileFor('txt'))),body=await response.json();
  const recognized=known.includes(message);assert.equal(response.status,recognized?422:503);assert.equal(body.error,recognized?'OFFICE_IMPORT_FORMAT':'OFFICE_IMPORT_RUNTIME');
  assert.equal(h.writes.length,0);rejectionLog(h,body,'import');assert.ok(!JSON.stringify({body,logs:h.logs}).includes(message));
 }
});

test('Office POST raw worker failure is private and distinct from persistence failure',async()=>{
 const raw=new Error('Parser stack '+privateMarker+' token=secret company='+A);raw.code='ERR_MODULE_NOT_FOUND';
 const h=harness({workerFailure:raw}),response=await h.POST(request(fileFor('txt'))),body=await response.json();
 assert.equal(response.status,503);assert.equal(body.error,'OFFICE_IMPORT_RUNTIME');assert.equal(h.writes.length,0);assert.equal(h.events.includes('service'),false);rejectionLog(h,body,'import');
 const persistence=harness({persistFailure:new Error('OFFICE_FORBIDDEN '+privateMarker)}),saved=await persistence.POST(request(fileFor('txt'))),savedBody=await saved.json();
 assert.equal(saved.status,400);assert.deepEqual(savedBody,{error:'OFFICE_FORBIDDEN'});assert.equal(persistence.events.at(-1),'persist');assert.equal(persistence.writes.length,0);assert.equal(persistence.logs.length,0);
});
