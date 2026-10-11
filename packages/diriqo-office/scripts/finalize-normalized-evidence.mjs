import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Read-only by default. --write updates reports/validation.json only.
// No dependencies, network, deployment, build, private credential read or database operation.
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const args=process.argv.slice(2);
assert(args.length<=1&&args.every(x=>x==='--write'),'Usage: node scripts/finalize-normalized-evidence.mjs [--write]');
const hash=x=>createHash('sha256').update(x).digest('hex');
const text=async path=>{const b=await readFile(path);return b.toString(b[0]===255&&b[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'');};
const json=async path=>JSON.parse(await text(path));
const optional=async path=>{try{return await json(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const proof=async path=>({report:path,sha256:hash(await readFile(path))});
const checksPass=x=>Array.isArray(x?.checks)&&x.checks.length>0&&x.checks.every(c=>c.passed===true);
const hostOf=(value,host)=>Array.isArray(value?.hosts)?value.hosts.find(x=>x.host===host):value?.hosts?.[host]??value?.[host];
async function tests(path){
 const log=await text(path);
 const count=label=>{const m=[...log.matchAll(new RegExp('(?:^|\\n)[^\\n]*?\\b'+label+'\\s+(\\d+)\\s*(?=\\r?\\n|$)','g'))];assert(m.length,path+': missing '+label);return Number(m.at(-1)[1]);};
 const result={...(await proof(path)),tests:count('tests'),passed:count('pass'),failed:count('fail'),cancelled:count('cancelled'),skipped:count('skipped'),todo:count('todo')};
 assert(result.tests>0&&result.tests===result.passed&&!result.failed&&!result.cancelled&&!result.skipped&&!result.todo,path+': incomplete test run');
 return result;
}
async function sql(path){
 const x=await json(path);assert(x.hosts?.length===2&&x.hosts.every(h=>h.status==='PASS'&&h.assertions>0),path+': incomplete SQL evidence');
 for(const [file,expected]of Object.entries(x.sourceSha256??{}))assert.equal(hash(await readFile(file)),expected,path+': changed input '+file);
 return {...(await proof(path)),status:x.status??'PASS',scope:x.scope,assertions:x.hosts.reduce((n,h)=>n+h.assertions,0),
  hosts:x.hosts.map(({host,status,assertions,red,capacity})=>({host,status,assertions,...(red?{baselineReproduction:red}:{}),...(capacity?{capacity}:{})})),limitations:x.limitations??[]};
}
const run=(script,cwd=root)=>execFileSync(process.execPath,[script,'--check'],{cwd,encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
const license=run('scripts/licenses.mjs').match(/PASS: (\d+) exact packages, (\d+) reviewed font asset/);assert(license,'License check did not pass');
const shared=await tests('reports/normalized-shared-tests.log'),hostTests=await tests('reports/normalized-host-tests.log');
const postgres={
 normalizedSecurity:await sql('reports/database-normalized-security.json'),
 normalizedRegression:await sql('reports/database-normalized-regression.json'),
 receiptCommit:await sql('reports/database-receipt-commit-validation.json'),
 privateCatalog:await sql('reports/office-private-catalog.json')
};
const pos=await json('reports/office-pos-regression.json');assert.equal(pos.status,'PASS');assert(pos.total.tests>0&&pos.total.tests===pos.total.pass&&!pos.total.fail&&!pos.total.skipped);
for(const item of pos.tests)assert.equal(hash(await readFile(resolve(pos.repository,item.file))),item.sha256,'Changed POS test: '+item.file);
const packageBytes=await readFile('release/diriqo-office-0.1.0.tgz'),packageSha256=hash(packageBytes),tar=gunzipSync(packageBytes),entries=new Map();
for(let offset=0;offset+512<=tar.length;){
 const head=tar.subarray(offset,offset+512);if(head.every(x=>x===0))break;
 const field=(a,b)=>head.subarray(a,b).toString().replace(/\0.*$/s,'');
 const prefix=field(345,500),name=(prefix?prefix+'/':'')+field(0,100),size=parseInt(field(124,136).trim(),8);
 assert(name.startsWith('package/')&&Number.isSafeInteger(size)&&size>=0&&offset+512+size<=tar.length,'Invalid package entry');assert(!entries.has(name),'Duplicate package entry');
 entries.set(name,tar.subarray(offset+512,offset+512+size));offset+=512+Math.ceil(size/512)*512;
}
for(const host of ['hub','diriqo']){
 const cwd=resolve('integrations',host);assert.match(run('scripts/check-office-package.mjs',cwd),/^PASS:/);
 assert.equal(hash(await readFile(resolve(cwd,'vendor/diriqo-office-0.1.0.tgz'))),packageSha256);
 for(const [name,bytes]of entries)assert.equal(hash(await readFile(resolve(cwd,'node_modules/@diriqo/office',name.slice(8)))),hash(bytes),host+': installed mismatch '+name);
}
const printPath='output/pdf/native-print/independent-validation.json',print=await json(printPath);
assert.equal(print.status,'PASS');assert.equal(print.cssSha256,hash(await readFile('src/client/office.css')),'Changed print CSS');assert.equal(print.visualInspection.status,'PASS');
for(const item of print.results)for(const output of Object.values(item.outputs))assert.equal(hash(await readFile('output/pdf/native-print/'+output.file)),output.sha256);
for(const image of print.visualInspection.images)assert.equal(hash(await readFile('output/pdf/native-print/'+image.file)),image.sha256);
const targets=await json('reports/public-staging-targets.json'),deployments=await optional('reports/normalized-deployments.json');
const browserPath=await optional('reports/normalized-staging-browser.json')?'reports/normalized-staging-browser.json':'reports/public-staging-browser.json',browser=await optional(browserPath);
const catalogPath='reports/normalized-staging-catalog-final.json',catalog=await optional(catalogPath),hosts={};
for(const host of ['hub','diriqo']){
 const target=targets.hosts[host],rpcPath='reports/staging-'+host+'.json',rpc=await json(rpcPath),lockPath='reports/staging-'+host+'-normalized-lock-proof.json',lock=await json(lockPath);
 assert.equal(rpc.projectRef,target.projectRef);assert.equal(lock.projectRef,target.projectRef);
 assert(rpc.assertions.passed>0&&rpc.assertions.failed===0&&checksPass(rpc),host+': RPC incomplete');assert(lock.status==='PASS'&&checksPass(lock),host+': lock proof incomplete');
 const capacityPath='reports/staging-'+host+'-normalized-capacity.json',capacity=await json(capacityPath);assert.equal(capacity.projectRef,target.projectRef);
 const capacityPassed=capacity.status==='PASS'&&checksPass(capacity)&&capacity.logicalHistoryBytes>64*1024*1024;
 const sourcePath='reports/public-staging-'+host+'-source.json',source=await json(sourcePath),changed=[];
 for(const item of source.sourceFiles)if(hash(await readFile(resolve('integrations',host,item.file)))!==item.sha256)changed.push(item.file);
 const deployed=hostOf(deployments,host);
 const current=!!deployed&&deployments.status==='PASS'&&deployed.target==='staging'&&deployed.readyState==='READY'&&deployed.projectId===target.projectId&&deployed.serverSHA1Matches===true&&deployed.deploymentId===target.deploymentId&&deployed.sourceArchiveSha256===source.archiveSha256&&deployed.packageSha256===packageSha256&&!changed.length&&target.state==='READY';
 const httpPath='reports/public-staging-'+host+'-http.json',http=await optional(httpPath);
 const httpCurrent=current&&http?.status==='PASS'&&checksPass(http)&&http.publicTarget?.deploymentId===target.deploymentId&&http.projectRef===target.projectRef;
 const pdfPath='output/pdf/public-'+host+'-restored-validation.json',pdf=await optional(pdfPath);
 const pdfHttpPath='output/pdf/public-'+host+'-restored-http.json',pdfHttp=await optional(pdfHttpPath);
 const pdfOutput='output/pdf/public-'+host+'-restored.pdf';
 const pdfCurrent=current&&pdf?.status==='PASS_INDEPENDENT_PARSE'&&pdf.deploymentId===target.deploymentId&&pdf.projectRef===target.projectRef&&
  pdf.output===pdfOutput&&pdfHttp?.deploymentId===target.deploymentId&&pdfHttp.projectRef===target.projectRef&&checksPass(pdfHttp)&&
  pdfHttp.sha256===pdf.sha256&&hash(await readFile(pdfOutput))===pdf.sha256;
 const ui=hostOf(browser,host),browserCurrent=current&&ui?.deploymentId===target.deploymentId&&(ui?.status==='PASS'||browser?.status==='PASS_SCOPED'||browser?.status==='PASS');
 const remote=hostOf(catalog,host),c=remote?.checks;
 const privatePass=remote?.projectRef===target.projectRef&&c?.hold_removed===true&&c?.observer_removed===true&&c?.receipt_secure===true&&c?.settings_scoped===true&&c?.private_client_usage===false;
 hosts[host]={...target,
  rpc:{...(await proof(rpcPath)),passed:rpc.assertions.passed,failed:0,raceRounds:rpc.races.length,finishedAt:rpc.finishedAt},
  normalizedLocks:{...(await proof(lockPath)),status:lock.status,passed:lock.checks.length,blockerRelease:lock.blockerRelease},
  capacity:{...(await proof(capacityPath)),status:capacity.status,completed:capacityPassed,logicalHistoryBytes:capacity.logicalHistoryBytes,savedRevision:capacity.savedRevision,finishedAt:capacity.finishedAt??null,scope:capacity.scope},
  deployment:{status:current?'CURRENT_RUNTIME_READY':'CURRENT_RUNTIME_DEPLOYMENT_PENDING',provenance:deployments?'reports/normalized-deployments.json':null,sourceReport:sourcePath,sourceArchiveSha256:source.archiveSha256,changedAfterPackaging:changed},
  http:{report:httpPath,status:http?.status??'MISSING',passed:http?.checks?.filter(x=>x.passed).length??0,deploymentId:http?.publicTarget?.deploymentId??null,verifiedCurrentRuntime:httpCurrent},
  pdf:{report:pdfPath,httpReport:pdfHttpPath,status:pdf?.status??'MISSING',deploymentId:pdf?.deploymentId??null,sha256:pdf?.sha256??null,verifiedCurrentRuntime:pdfCurrent},
  browser:{report:browserPath,deploymentId:ui?.deploymentId??null,verifiedCurrentRuntime:browserCurrent},
  remotePrivateCatalog:{report:catalogPath,passed:privatePass,checks:c??null,advisors:remote?.advisors?.map(({name,level,count,remediation})=>({name,level,count,remediation}))??[]}
 };
}
const buildPath='reports/normalized-build-typechecks.json',build=await optional(buildPath);
const automatedComplete=!!build&&Object.values(hosts).every(x=>x.capacity.completed&&x.deployment.status==='CURRENT_RUNTIME_READY'&&x.http.verifiedCurrentRuntime&&x.pdf.verifiedCurrentRuntime&&x.remotePrivateCatalog.passed);
const complete=automatedComplete&&Object.values(hosts).every(x=>x.browser.verifiedCurrentRuntime);
const summaryStatus=complete?'NORMALIZED_STAGING_SCOPED_ACCEPTANCE_PASS':automatedComplete?'AUTOMATED_STAGING_PASS_UI_NOT_VERIFIED':'NORMALIZED_STAGING_ACCEPTANCE_IN_PROGRESS';
if(build){
 assert(build.commands?.length>0&&build.commands.every(x=>x.exitCode===0),'Build/typecheck evidence reports a failed command');
 for(const label of ['sharedBuild','sharedTypecheck','hubTypecheck','diriqoTypecheck'])assert(build.commands.some(x=>x.label===label),'Missing build/typecheck observation: '+label);
 for(const command of build.commands)if(command.packageSha256)assert.equal(command.packageSha256,packageSha256,'Build evidence belongs to another package');
}
const report={
 schemaVersion:2,checkedAt:new Date().toISOString(),
 scope:'Current shared Office and isolated host copies; authenticated synthetic staging only. Aggregation does not execute builds, database operations, network requests or browser flows.',
 status:summaryStatus,
 automatedTests:shared,hostAutomatedTests:hostTests,postgres,
 buildAndTypechecks:build?{...(await proof(buildPath)),...build}:null,
 licenseAudit:{result:'PASS',exactLockedPackages:Number(license[1]),reviewedFontAssets:Number(license[2]),unknownOrDisallowedNewPackages:0,checkedNow:true},
 artifactIdentity:{packageSha256,installedMatchesBothHosts:true,packageFiles:entries.size},
 nativePrint:{...(await proof(printPath)),status:'PASS_RENDER_PARSE_AND_VISUAL',browserVersion:print.browserVersion,cssSha256:print.cssSha256,
  cases:print.results.map(({name,outputs})=>({name,chromePages:outputs.browser.pages,serverPdfPages:outputs.server.pages})),visuallyInspectedPages:print.visualInspection.inspectedPages,nativeDialogProved:false,physicalPrinterProved:false},
 pos:{...(await proof('reports/office-pos-regression.json')),status:pos.status,...pos.total,scope:pos.scope,deviceAccess:false,limitations:pos.limitations},
 staging:{status:complete?'PASS_SCOPED':automatedComplete?'AUTOMATED_PASS_UI_NOT_VERIFIED':'IN_PROGRESS',automatedCurrentRuntimeAcceptancePassed:automatedComplete,currentRuntimeAcceptancePassed:complete,scopeAcceptancePassed:complete,unrestrictedProductionReadiness:false,browserLimitation:browser?.status==='NOT_VERIFIED'?{report:browserPath,status:browser.status,userAcknowledged:browser.userAcknowledged===true}:null,hosts,expiresAt:targets.expiresAt,budgetUsd:targets.budgetUsd,
  cleanup:{status:'SCHEDULED_NOT_YET_EXECUTED',automationId:'ukon-en-office-stagingu-po-24-hodin-ch',scheduledFor:'2026-10-12T16:55:00Z',guardDoesNotStopBilling:true}},
 securityAdvisorInterpretation:catalog?.interpretation??null,
 documentation:{storage:'docs/NORMALIZED_PERSISTENCE.md',cloudNotesOnly:'docs/EXTERNAL_STORAGE_NOTES.md',menuAndPos:'docs/OFFICE_ROLLOUT_IMPACT.md',limitations:'docs/LIMITATIONS.md',enablement:'docs/ENABLEMENT.md'},
 productionTouchedThisRun:false,gitPushPerformed:false,
 notExecuted:[...(!complete?['New deployed UI in Chrome was not visually verified; the user explicitly accepted completing the work with this limitation.']:[]),'Production deployment, migrations, module enabling or customer data access.','Native user browser print dialog acceptance and physical printer, POS, terminal or drawer operation.','Full ERP security sign-off: inherited non-Office schema/Auth advisor findings remain reported and unmodified.','Representative customer DOCX/XLSX fidelity and a complete browser/device/performance matrix.'],
 evidencePolicy:'Historical deployments retain exact identities. READY plus old HTTP/browser proof never proves latest sources. RUNNING, FAIL and timed-out capacity checks are not PASS. PGlite did not reproduce the original deferred-trigger bug. Logical JSON size is not physical disk or throughput.'
};
if(args.includes('--write'))await writeFile('reports/validation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,written:args.includes('--write'),sharedTests:shared.passed,hostTests:hostTests.passed,
 sqlAssertions:Object.fromEntries(Object.entries(postgres).map(([k,v])=>[k,v.assertions])),packageSha256,
 staging:Object.fromEntries(Object.entries(hosts).map(([k,v])=>[k,{capacity:v.capacity.status,capacityComplete:v.capacity.completed,runtime:v.deployment.status,httpCurrent:v.http.verifiedCurrentRuntime,pdfCurrent:v.pdf.verifiedCurrentRuntime,browserCurrent:v.browser.verifiedCurrentRuntime,privateCatalogPassed:v.remotePrivateCatalog.passed}]))},null,2));
