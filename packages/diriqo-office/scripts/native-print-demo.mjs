// Real print renderer, using an already-installed browser in an isolated temporary profile.
// Never connects to a user browser/profile, opens internal browser pages, or uses CDP.
import {readFile,writeFile,mkdir,mkdtemp,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createPrintFixture,createPrintHtml} from './native-print-fixture.mjs';
import {exportPdf} from '../src/server/pdf.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const chrome=process.env.OFFICE_PRINT_BROWSER;
const prepareOnly=process.argv.includes('--prepare-only');
if(process.argv.slice(2).some(arg=>arg!=='--prepare-only'))throw new Error('Only --prepare-only is accepted');
if(!chrome||!['chrome.exe','msedge.exe','chromium','google-chrome'].includes(chrome.split(/[\\/]/).at(-1)))throw new Error('Set OFFICE_PRINT_BROWSER to an existing Chrome/Edge executable. This script installs nothing.');
await stat(chrome);
const destination=join(root,'output/pdf/native-print');await mkdir(destination,{recursive:true});
const temp=join(root,'tmp/pdfs');await mkdir(temp,{recursive:true});
const css=await readFile(join(root,'src/client/office.css'),'utf8');
const results=[];
for(const [name,kind,margin] of [['short','short',20],['long','long',20],['wide-margins','short',50]]){
  const fixture=createPrintFixture(kind,margin),html=createPrintHtml(fixture.content,css);
  const htmlPath=join(destination,`${name}.html`),pdfPath=join(destination,`${name}.pdf`),serverPath=join(destination,`${name}-server.pdf`);
  await writeFile(htmlPath,html);await writeFile(join(destination,`${name}-expected.json`),JSON.stringify(fixture.expected,null,2)+'\n');
  await writeFile(serverPath,exportPdf(fixture.content).bytes);
  const profile=await mkdtemp(join(temp,'office-print-profile-'));
  const args=['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync','--metrics-recording-only','--host-resolver-rules=MAP * ~NOTFOUND','--no-pdf-header-footer',`--user-data-dir=${profile}`,`--print-to-pdf=${pdfPath}`,pathToFileURL(htmlPath).href];
  if(prepareOnly){results.push({name,html:htmlPath,pdf:pdfPath,serverPdf:serverPath,htmlSha256:sha(html),marginMm:margin,arguments:args});continue;}
  await new Promise((done,fail)=>{
    const child=spawn(chrome,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let stderr='';const timer=setTimeout(()=>{child.kill();fail(new Error(`Browser print timeout: ${name}`));},60000);
    child.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-8000);});
    child.once('error',error=>{clearTimeout(timer);fail(error);});
    child.once('exit',code=>{clearTimeout(timer);if(code===0)done();else fail(new Error(`Browser print failed (${code}): ${stderr}`));});
  });
  const pdf=await readFile(pdfPath);if(!pdf.subarray(0,5).equals(Buffer.from('%PDF-')))throw new Error('Browser did not create a PDF');
  results.push({name,html:htmlPath,pdf:pdfPath,serverPdf:serverPath,bytes:pdf.length,sha256:sha(pdf),htmlSha256:sha(html),marginMm:margin});
}
const report={createdAt:new Date().toISOString(),status:prepareOnly?'PREPARED_NOT_RENDERED':'RENDERED_AWAITING_INDEPENDENT_PARSE_AND_VISUAL_CHECK',renderer:chrome,cssSha256:sha(css),source:'src/client/office.css + public documentToHtml + modeled editor/host DOM',network:'HTML CSP default-src none; resolver disabled; no remote assets or credentials',nativeDialogProved:false,physicalPrinterProved:false,results};
await writeFile(join(destination,'render-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
