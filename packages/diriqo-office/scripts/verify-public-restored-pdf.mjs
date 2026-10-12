/** Read-only Office proof. Uses only an operator-reviewed READY staging manifest,
 * ordinary Auth/RPC and the actual app export route. Never reads admin credentials.
 * Login creates sessions and the app records its normal export audit event; document
 * content, revisions, settings, memberships and original files are never mutated. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateTarget} from './staging-target.mjs';
import {validatePublicHostTarget} from './staging-public-target.mjs';
import {createStagingTransport,validateCredentials} from './staging-transport.mjs';
import {createDiriqoHostSession} from './staging-diriqo-host-session.mjs';
import {createHubHostSession} from './staging-hub-host-session.mjs';
import {documentToText} from '../dist/server.js';

// Resolve a closed host enum before deriving any file path or reading credentials.
const host=process.argv[2]??'diriqo';
if(!['hub','diriqo'].includes(host)||process.argv.length>3)throw Error('Usage: node scripts/verify-public-restored-pdf.mjs hub|diriqo');
const fixture={
 diriqo:{title:'Veřejný staging – obnova a PDF',needles:['Příliš žluťoučký','12 345 Kč']},
 hub:{title:'Veřejný JSPD – obnova a panely',needles:['JSPD – původní ověřená verze.','8 765 Kč']},
}[host];
const title=fixture.title;
const output=`output/pdf/public-${host}-restored.pdf`;
const report={schemaVersion:1,host,scope:'Actual public app HTTP PDF export after browser-confirmed restore; no document writes',startedAt:new Date().toISOString(),status:'RUNNING',checks:[]};
const check=(label,ok)=>{report.checks.push({label,passed:ok===true});if(ok!==true)throw Error('PUBLIC_PDF_CHECK_FAILED: '+label);};
try{
 check('No arbitrary CLI network target override',true);
 const staging=JSON.parse(await readFile('reports/staging-targets.json','utf8'));
 const target=validateTarget(staging,host);
 const publicTarget=validatePublicHostTarget(JSON.parse(await readFile('reports/public-staging-targets.json','utf8')),staging,host);
 Object.assign(report,{projectRef:target.projectRef,origin:publicTarget.origin,deploymentId:publicTarget.deploymentId});
 // Do not print or include this private object in a report or thrown error.
 const config=JSON.parse(await readFile(`.staging/${host}.dual.json`,'utf8'));
 check('Private synthetic identity bound to allowed staging branch',config.projectRef===target.projectRef&&config.principal==='human'&&Object.values(config.companyIds??{}).includes(config.tenantId));
 const credentials=validateCredentials({...config,label:'dualManagerPdf'});
 const transport=createStagingTransport({target,publishableKey:config.publishableKey});
 const actor=await transport.login(credentials);
 const list=await transport.request(actor,{op:'list',query:title});
 check('Authorized list succeeds',list.status===200&&Array.isArray(list.data?.files));
 const candidates=list.data.files.filter(f=>f.title===title&&f.kind==='document');
 check('Exactly one expected restored document found',candidates.length===1);
 const id=candidates[0].id;
 const current=await transport.request(actor,{op:'read',id});
 check('Read current document after restore',current.status===200&&Number.isSafeInteger(current.data?.file?.revision)&&current.data.file.revision>=4&&current.data.file.tenantId===actor.tenantId&&current.data.file.content?.kind==='document');
 const revision=current.data.file.revision;
 const history=await transport.request(actor,{op:'versions',id});
 check('Authorized version history succeeds',history.status===200&&Array.isArray(history.data?.versions));
 const versions=Object.fromEntries(history.data.versions.map(v=>[v.revision,v]));
 check('Restored revision four exactly matches revision two',versions[2]?.content?.kind==='document'&&versions[4]?.content?.kind==='document'&&JSON.stringify(versions[2].content)===JSON.stringify(versions[4].content));
 check('Intervening revision three is a distinct text version',versions[3]?.content?.kind==='document'&&documentToText(versions[3].content).trim().length>0&&documentToText(versions[3].content)!==documentToText(versions[2].content));
 const replacedText=documentToText(versions[3].content).trim();
 const text=documentToText(current.data.file.content);
 check('Current content is original Czech revision',fixture.needles.every(needle=>text.includes(needle))&&!text.includes(replacedText));
 check('Fixture has no letterhead for exact parsed body comparison',!current.data.file.content.page.header&&!current.data.file.content.page.footer);
 const session=host==='hub'
  ?createHubHostSession({baseOrigin:publicTarget.origin,expectedProjectRef:target.projectRef,supabaseUrl:target.origin,publicKey:config.publishableKey,publicTarget})
  :createDiriqoHostSession({baseOrigin:publicTarget.origin,expectedProjectRef:target.projectRef,publicTarget});
 await session.login(credentials);
 // The existing Hub browser helper verifies active membership and writes only its
 // own in-memory tenant-preference cookie. No application/database mutation occurs.
 if(host==='hub')await session.selectCompany(actor.tenantId);
 const context=await session.request('/api/office/context');
 check('Fresh real host SSR session has matching tenant and profile',context.status===200&&context.json?.ok===true&&context.json.context?.tenantId===actor.tenantId&&context.json.context?.actorId===config.profileId);
 const result=await session.exportFile({tenantId:actor.tenantId,id,format:'pdf'});
 check('Actual public PDF endpoint succeeds',result.status===200&&result.json?.mime==='application/pdf'&&typeof result.json.base64==='string'&&result.cacheControl?.includes('no-store'));
 const bytes=Buffer.from(result.json.base64,'base64');
 check('PDF signature and canonical base64',bytes.length>1000&&bytes.subarray(0,8).toString()==='%PDF-1.4'&&bytes.toString('base64')===result.json.base64&&bytes.subarray(-32).toString().includes('%%EOF'));
 const after=await transport.request(actor,{op:'read',id});
 check('Export did not change document revision or content',after.status===200&&after.data?.file?.revision===revision&&JSON.stringify(after.data.file.content)===JSON.stringify(current.data.file.content));
 await mkdir('output/pdf',{recursive:true});await writeFile(output,bytes);
 Object.assign(report,{status:'PASS_HTTP_PENDING_INDEPENDENT_PARSE',fileId:id,revision,restoredHistory:{original:2,replaced:3,restored:4,exactContentMatch:true},currentTextSha256Normalized:createHash('sha256').update(text.normalize('NFC').replace(/\s/g,'')).digest('hex'),output,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),warnings:result.json.warnings});
}catch(error){
 report.status='FAIL';
 // Never echo provider bodies, credential fields or cookies.
 report.error=error instanceof Error&&/^PUBLIC_PDF_CHECK_FAILED: [A-Za-z0-9 ]+$/.test(error.message)?error.message:'PUBLIC_PDF_PROOF_FAILED';
 process.exitCode=1;
}finally{
 report.finishedAt=new Date().toISOString();await mkdir('output/pdf',{recursive:true});
 await writeFile(`output/pdf/public-${host}-restored-http.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,passed:report.checks.filter(x=>x.passed).length,output:report.output,error:report.error}));
}
