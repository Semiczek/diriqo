/** Build/start the isolated host clone against the allowlisted synthetic staging only. */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {validateTarget} from './staging-target.mjs';
const [host,mode]=process.argv.slice(2);
assert.ok(['hub','diriqo'].includes(host));assert.ok(['build','start'].includes(mode));
const target=validateTarget(JSON.parse(await readFile('reports/staging-targets.json','utf8')),host);
const admin=JSON.parse(await readFile(`.staging/${host}.admin.json`,'utf8'));
assert.equal(admin.projectRef,target.projectRef);
const claim=JSON.parse(Buffer.from(admin.secretKey.split('.')[1],'base64url').toString());
assert.equal(claim.ref,target.projectRef);assert.equal(claim.role,'service_role');
const cwd=path.resolve('integrations',host),port=host==='diriqo'?4332:4331;
assert.ok(!(await readdir(cwd)).some(name=>name.startsWith('.env')&&name!=='.env.example'),'Refusing clone with unreviewed env files');
const env={...process.env,NODE_ENV:'production',NODE_OPTIONS:'--max-old-space-size=4096',NEXT_TELEMETRY_DISABLED:'1',CIRCLE_NODE_TOTAL:'2',
 NEXT_PUBLIC_SUPABASE_URL:target.origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:admin.publishableKey,SUPABASE_URL:target.origin,SUPABASE_SERVICE_ROLE_KEY:admin.secretKey,
 DIRIQO_MODULE_BILLING_MODE:'test',OFFICE_PUBLIC_ORIGIN:`http://127.0.0.1:${port}`,NEXT_PUBLIC_APP_URL:`http://127.0.0.1:${port}`,NEXT_PUBLIC_SITE_URL:`http://127.0.0.1:${port}`};
const startedAt=new Date().toISOString();
if(mode==='start'){
 const build=JSON.parse(await readFile(`reports/staging-${host}-host-build.json`,'utf8'));
 assert.equal(build.projectRef,target.projectRef);assert.equal(build.exitCode,0);
}
const log=createWriteStream(`reports/staging-${host}-host-${mode}.log`);
const args=['node_modules/next/dist/bin/next',...(mode==='build'?['build']:['start','--hostname','127.0.0.1','--port',String(port)])];
const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{log.write(data);process.stdout.write(data)});
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});log.end();
await writeFile(`reports/staging-${host}-host-${mode}.json`,JSON.stringify({host,projectRef:target.projectRef,mode,startedAt,finishedAt:new Date().toISOString(),exitCode:code,port,scope:'Isolated local host clone with real synthetic Supabase staging; no deployment',telemetry:false},null,2)+'\n');
process.exitCode=code??1;
