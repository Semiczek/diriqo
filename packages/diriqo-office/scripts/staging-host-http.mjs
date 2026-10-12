import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateTarget} from './staging-target.mjs';
import {validatePublicHostTarget} from './staging-public-target.mjs';
import {createDiriqoHostSession} from './staging-diriqo-host-session.mjs';
import {createHubHostSession} from './staging-hub-host-session.mjs';
import {createStagingTransport,validateCredentials} from './staging-transport.mjs';
import {importOfficeFile,documentToText,exportXlsx} from '../dist/server.js';
const host=process.argv[2];
const publicMode=process.argv[3]==='--public';
assert.ok(['hub','diriqo'].includes(host)&&(process.argv.length===3||(process.argv.length===4&&publicMode)),'Usage: node scripts/staging-host-http.mjs hub|diriqo [--public]');
const stagingManifest=JSON.parse(await readFile('reports/staging-targets.json','utf8'));
const target=validateTarget(stagingManifest,host);
// Validate the deployment before reading credentials or constructing any auth client.
const publicTarget=publicMode?validatePublicHostTarget(JSON.parse(await readFile('reports/public-staging-targets.json','utf8')),stagingManifest,host):undefined;
const config=JSON.parse(await readFile('.staging/'+host+'.credentials.json','utf8'));
assert.equal(config.schemaVersion,1);assert.equal(config.projectRef,target.projectRef);
// Constructor validates the public key and staging binding without making a request.
createStagingTransport({target,publishableKey:config.publishableKey});
for(const [label,actor] of Object.entries(config.actors))validateCredentials({...actor,label});
const baseOrigin=publicTarget?.origin??(host==='hub'?'http://127.0.0.1:4331':'http://127.0.0.1:4332');
const loginPath=host==='hub'?'/login':'/sign-in';
const report={host,projectRef:target.projectRef,baseOrigin,publicTarget,scope:(publicMode?'Reviewed READY public Vercel staging deployment of actual ':'Local production build of actual ')+(host==='hub'?'JSPD Hub':'Diriqo')+' host, real isolated Supabase branch, fresh actual SSR auth cookies',startedAt:new Date().toISOString(),status:'RUNNING',checks:[],files:[]};
const check=(label,ok)=>{report.checks.push({label,passed:ok===true});assert.equal(ok,true,label);};
const session=()=>host==='hub'
 ?createHubHostSession({baseOrigin,expectedProjectRef:target.projectRef,supabaseUrl:target.origin,publicKey:config.publishableKey,publicTarget})
 :createDiriqoHostSession({baseOrigin,expectedProjectRef:target.projectRef,publicTarget});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const denied=(r,code)=>r.status>=400&&!r.json?.base64&&(!code||r.json?.error?.startsWith(code));
try{
 const sessions={};
 for(const label of ['ownerA','editorA','readerA','ownerB']){
  sessions[label]=session();await sessions[label].login(config.actors[label]);check(label+' real host login',true);
  if(host==='hub'){
   const selected=await sessions[label].selectCompany(config.actors[label].tenantId);
   check(label+' active membership and company cookie',selected.status===200&&selected.companyId===config.actors[label].tenantId);
  }else if(label.startsWith('owner')){
   await sessions[label].selectCompany(config.actors[label].tenantId);
   const r=await sessions[label].request('/api/active-company');
   check(label+' active company',r.status===200&&r.json?.companyId===config.actors[label].tenantId);
  }
  const r=await sessions[label].request('/office');
  check(label+' Office server page',r.status===200&&r.contentType.startsWith('text/html')&&r.htmlBytes>500);
 }
 const A=config.actors.ownerA.tenantId,B=config.actors.ownerB.tenantId;
 for(const name of ['letter.docx','formula-demo.xlsx']){
  const bytes=await readFile('fixtures/'+name),key=randomUUID();
  const args={tenantId:A,name,mime:'application/octet-stream',bytes,idempotencyKey:key};
  const uploaded=await sessions.ownerA.upload(args);
  if(uploaded.status!==200)report.uploadFailure={status:uploaded.status,error:uploaded.json?.error,locationPath:uploaded.locationPath};
  check(name+' worker upload',uploaded.status===200&&typeof uploaded.json?.file?.id==='string');
  const id=uploaded.json.file.id;report.files.push({name,id,originalSha256:hash(bytes),warnings:uploaded.json.warnings});
  const duplicate=await sessions.ownerA.upload(args);
  check(name+' idempotent upload',duplicate.status===200&&duplicate.json?.file?.id===id);
  const original=await sessions.ownerA.exportFile({tenantId:A,id,format:'original'});
  check(name+' unchanged original',original.status===200&&hash(Buffer.from(original.json.base64,'base64'))===hash(bytes));
  const ext=name.split('.').pop(),exported=await sessions.ownerA.exportFile({tenantId:A,id,format:ext});
  check(name+' export',exported.status===200&&typeof exported.json?.base64==='string');
  const roundtrip=await importOfficeFile(exported.json.name,new Uint8Array(Buffer.from(exported.json.base64,'base64')));
  if(ext==='docx'){
   check(name+' DOCX content retained',roundtrip.content.kind==='document'&&documentToText(roundtrip.content).includes('Jednoduchý dopis'));
   const pdf=await sessions.ownerA.exportFile({tenantId:A,id,format:'pdf'});
   const pdfBytes=Buffer.from(pdf.json?.base64??'','base64');
   check(name+' actual host PDF download',pdf.status===200&&pdf.json?.mime==='application/pdf'&&pdf.json?.name?.endsWith('.pdf')&&pdfBytes.length>1000&&pdfBytes.subarray(0,8).toString()==='%PDF-1.4'&&pdfBytes.subarray(-32).toString().includes('%%EOF'));
  }
  else{
   const w=roundtrip.content.workbook;
   check(name+' XLSX two sheets retained',roundtrip.content.kind==='spreadsheet'&&w.sheetOrder.length===2);
   check(name+' SUM formula retained',Object.values(w.sheets).some(s=>s.cellData?.[0]?.[2]?.f==='=SUM(A1:B1)'));
  }
  check(name+' reader export',(await sessions.readerA.exportFile({tenantId:A,id,format:ext})).status===200);
  check(name+' editor export',(await sessions.editorA.exportFile({tenantId:A,id,format:ext})).status===200);
  check(name+' other tenant cannot export',denied(await sessions.ownerB.exportFile({tenantId:B,id,format:ext})));
  check(name+' wrong tenant header',denied(await sessions.ownerA.exportFile({tenantId:B,id,format:ext}),'OFFICE_TENANT_CHANGED'));
  check(name+' reader cannot upload',denied(await sessions.readerA.upload({...args,idempotencyKey:randomUUID()}),'OFFICE_FORBIDDEN'));
  check(name+' cross origin blocked',denied(await sessions.ownerA.upload({...args,originHeader:'https://invalid.example',idempotencyKey:randomUUID()}),publicMode?'OFFICE_STAGING_ORIGIN':'OFFICE_FORBIDDEN'));
  check(name+' cross site blocked',denied(await sessions.ownerA.upload({...args,fetchSite:'cross-site',idempotencyKey:randomUUID()}),'OFFICE_FORBIDDEN'));
  check(name+' invalid format export blocked',denied(await sessions.ownerA.exportFile({tenantId:A,id,format:'exe'})));
  const anon=await session().exportFile({tenantId:A,id,format:'original'});
  check(name+' anonymous redirected without content',anon.status===307&&(anon.locationPath===loginPath||anon.locationPath?.startsWith(loginPath+'?'))&&!anon.json?.base64);
 }
 const bad=await sessions.ownerA.upload({tenantId:A,name:'forged.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:Buffer.from('<script>alert(1)</script>'),idempotencyKey:randomUUID()});
 check('forged DOCX signature rejected',denied(bad,'OFFICE_FORMAT'));
 const csvBytes=Buffer.from('Code;Value\r\n00123;=1+1\r\n00124;20'),csvArgs={tenantId:A,name:'staging-retry.csv',mime:'text/csv',bytes:csvBytes,idempotencyKey:randomUUID()};
 const csv=await sessions.ownerA.upload(csvArgs);check('CSV upload',csv.status===200&&typeof csv.json?.file?.id==='string');
 const csvRetry=await sessions.ownerA.upload(csvArgs);check('CSV independent worker retry',csvRetry.status===200&&csvRetry.json?.file?.id===csv.json.file.id);
 const csvConflict=await sessions.ownerA.upload({...csvArgs,bytes:Buffer.from('Code;Value\r\n00123;changed')});
 check('CSV changed bytes same key rejected',denied(csvConflict,'OFFICE_IDEMPOTENCY_CONFLICT'));
 const csvExport=await sessions.ownerA.exportFile({tenantId:A,id:csv.json.file.id,format:'csv'});
 const csvText=Buffer.from(csvExport.json.base64,'base64').toString();
 check('CSV leading zero and formula neutralization',csvExport.status===200&&csvText.includes('00123')&&csvText.includes("'=1+1"));
 const cellData={};for(let r=0;r<2500;r++){cellData[r]={};for(let c=0;c<8;c++)cellData[r][c]={v:r*8+c,t:2};}
 const large={schemaVersion:1,kind:'spreadsheet',workbook:{id:'staging-large',name:'Staging 20000 cells',sheetOrder:['large'],styles:{},sheets:{large:{id:'large',name:'Large',rowCount:2500,columnCount:26,cellData}}}};
 const largeBytes=exportXlsx(large).bytes,largeStart=Date.now();
 const largeUploaded=await sessions.ownerA.upload({tenantId:A,name:'staging-20000-cells.xlsx',mime:'application/octet-stream',bytes:largeBytes,idempotencyKey:randomUUID()});
 check('20000 populated cells actual worker upload',largeUploaded.status===200&&typeof largeUploaded.json?.file?.id==='string');
 const largeExport=await sessions.ownerA.exportFile({tenantId:A,id:largeUploaded.json.file.id,format:'xlsx'});
 check('20000 populated cells actual host export',largeExport.status===200&&typeof largeExport.json?.base64==='string');
 const largeParsed=await importOfficeFile('large.xlsx',new Uint8Array(Buffer.from(largeExport.json.base64,'base64')));
 const cells=largeParsed.content.workbook.sheets[largeParsed.content.workbook.sheetOrder[0]].cellData;
 check('20000 cell count and last value preserved',Object.values(cells).reduce((n,row)=>n+Object.keys(row).length,0)===20000&&cells[2499][7].v===19999);
 report.largeWorkbook={populatedCells:20000,uploadExportReimportMs:Date.now()-largeStart,inputBytes:largeBytes.length,scope:'single representative server processing test; not a full performance benchmark'};
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error.message).slice(0,180);process.exitCode=1;}
report.finishedAt=new Date().toISOString();await writeFile(publicMode?'reports/public-staging-'+host+'-http.json':'reports/staging-'+host+'-host-http.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error,files:report.files.map(({name,id})=>({name,id}))}));
