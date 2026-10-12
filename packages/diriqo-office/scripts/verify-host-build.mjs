/** Local-only compiled Next/worker smoke. No credentials, data or remote database. */
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const host=process.argv[2];if(!['hub','diriqo'].includes(host))throw Error('Expected hub or diriqo');
const root=path.resolve('integrations',host),port=host==='hub'?4331:4332,base=`http://127.0.0.1:${port}`;
const report={host,checkedAt:new Date().toISOString(),checks:[],limitations:['No signed Supabase account or live database is used. Authenticated editor/host flow still needs staging.']};
const check=(label,condition)=>{assert.ok(condition,label);report.checks.push(label);};
const nftPath=path.join(root,'.next/server/app/api/office/files/route.js.nft.json');
const nft=JSON.parse(await readFile(nftPath,'utf8'));
const traced=nft.files.map(p=>path.resolve(path.dirname(nftPath),p));
const packageRoot=path.join(root,'node_modules/@diriqo/office');
for(const rel of ['dist/import-worker.js','package.json','dist/import-worker.js.LEGAL.txt','THIRD_PARTY_LICENSES.md','ASSET_LICENSES.md'])check('Trace includes '+rel,traced.includes(path.join(packageRoot,rel)));
const evidence=JSON.parse(await readFile(path.join(packageRoot,'licenses/evidence.json'),'utf8'));
for(const p of evidence.packages)for(const f of p.files)assert.ok(traced.includes(path.join(packageRoot,f.path)),'Missing traced notice '+f.path);
check('All reviewed third-party notices retained',true);
for(const file of traced.filter(p=>p.startsWith(packageRoot+path.sep)))await access(file);
check('All traced Office files exist',true);
const metadata=JSON.parse(await readFile(packageRoot+'/package.json','utf8'));check('Worker retains ESM package boundary',metadata.type==='module');
const {importOfficeFileBounded}=await import(pathToFileURL(path.join(packageRoot,'dist/server.js')).href);
const manifest=JSON.parse(await readFile(root+'/.next/server/app-paths-manifest.json','utf8'));
for(const route of ['/office/page','/office/settings/page','/api/office/files/route'])check('Compiled route '+route,typeof manifest[route]==='string');
for(const [name,kind]of [['letter.docx','document'],['formula-demo.xlsx','spreadsheet']]){
 const bytes=new Uint8Array(await readFile(path.resolve('fixtures',name)));
 const result=await importOfficeFileBounded(name,bytes,pathToFileURL(path.join(packageRoot,'dist/import-worker.js')));
 check('Deployed worker imports '+name,result.content.kind===kind);
}
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,windowsHide:true,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=2048',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_ANON_KEY:'office-local-build-placeholder',SUPABASE_SERVICE_ROLE_KEY:'office-local-build-placeholder'},stdio:['ignore','pipe','pipe']});
let log='',startError;child.stdout.on('data',d=>{log+=d});child.stderr.on('data',d=>{log+=d});child.on('error',e=>{startError=e});
try{
 let ready=false;
 for(let n=0;n<60;n++){if(startError)throw startError;if(child.exitCode!==null)throw Error('Next exited: '+log);try{await fetch(base+'/login',{redirect:'manual',signal:AbortSignal.timeout(500)});ready=true;break}catch{}await new Promise(r=>setTimeout(r,250));}
 check('Compiled Next server starts',ready);
 for(const route of ['/office','/office/settings','/api/office/files?id=foreign&format=docx']){
  const response=await fetch(base+route,{redirect:'manual',signal:AbortSignal.timeout(10000)});
  const location=response.headers.get('location')??'';
  check('Unauthenticated request denied: '+route,[301,302,303,307,308,401,403].includes(response.status));
  if(response.status<400)check('Redirect leads to sign-in: '+route,/login|sign-in/.test(location));
 }
 check('No compiled module/worker crash',!/ERR_MODULE_NOT_FOUND|Cannot find module|ReferenceError|SyntaxError/.test(log));
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error);process.exitCode=1;}
finally{child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else{child.once('exit',resolve);setTimeout(resolve,3000).unref();}});await writeFile(`reports/${host}-next-runtime.log`,log);await writeFile(`reports/${host}-next-runtime.json`,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
