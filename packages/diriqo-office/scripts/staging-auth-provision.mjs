/** Create fresh synthetic accounts in an independently verified, empty staging branch only.
 * No invitations, password resets, production URL override or dependency installation.
 * A DB-owner preflight report and reviewed triggers are required before --execute.
 */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {validateTarget} from './staging-target.mjs';

const host=process.argv[2];
if(!['hub','diriqo'].includes(host)||process.argv.some((v,i)=>i>2&&v!=='--execute'))throw Error('Usage: node scripts/staging-auth-provision.mjs hub|diriqo [--execute]');
const manifest=JSON.parse(await readFile('reports/staging-targets.json','utf8'));
const target=validateTarget(manifest,host);
const proof=JSON.parse(await readFile(`reports/staging-${host}-empty-gate.json`,'utf8'));
if(typeof proof.checkedAt!=='string'||!Number.isFinite(Date.parse(proof.checkedAt)))throw Error('Invalid preflight timestamp');
if(proof.projectRef!==target.projectRef||proof.status!=='EMPTY_BASELINE_VERIFIED'||proof.triggersReviewed!==true
 ||Date.now()-Date.parse(proof.checkedAt)>3600000||Date.parse(proof.checkedAt)>Date.now()+300000
 ||!['auth.users','public.companies','public.profiles','public.company_members'].every(k=>proof.counts[k]===0)
 ||proof.unrestrictedVisibility!==true)throw Error('Fresh empty-branch/catalog/trigger verification required');
const admin=JSON.parse(await readFile(`.staging/${host}.admin.json`,'utf8'));
if(admin.projectRef!==target.projectRef)throw Error('Admin key project mismatch');
// Legacy keys carry a directly inspectable project claim; verify before any transmission.
const claims=JSON.parse(Buffer.from(admin.secretKey.split('.')[1]??'','base64url').toString());
if(claims.ref!==target.projectRef||claims.role!=='service_role'||claims.exp*1000<Date.now())throw Error('Admin key binding failed');
for(const suffix of ['credentials','seed','operator']){
 try{await access(`.staging/${host}.${suffix}.json`);throw Error('Provisioning already started; inspect the recorded run instead of creating duplicates');}
 catch(e){if(e.code!=='ENOENT')throw e;}
}
if(!process.argv.includes('--execute')){console.log(JSON.stringify({host,projectRef:target.projectRef,mode:'LOCAL_PREFLIGHT_ONLY',accounts:8}));process.exit(0);}
const headers={apikey:admin.secretKey,Authorization:`Bearer ${admin.secretKey}`,'Content-Type':'application/json'};
async function authRequest(path,body){
 const response=await fetch(target.origin+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
 const data=await response.json();
 if(!response.ok)throw Error(`STAGING_AUTH_HTTP_${response.status}`);
 return data;
}
const existing=await authRequest('/auth/v1/admin/users?page=1&per_page=1');
if(!Array.isArray(existing.users)||existing.users.length!==0||(existing.total??0)!==0)throw Error('Refusing non-empty staging Auth');
await mkdir('.staging',{recursive:true});
const runTag=randomBytes(5).toString('hex'),companies={A:randomUUID(),B:randomUUID()};
const plan={schemaVersion:1,host,projectRef:target.projectRef,runTag,startedAt:new Date().toISOString(),companies,users:[],status:'PROVISIONING'};
const config={schemaVersion:1,projectRef:target.projectRef,publishableKey:admin.publishableKey,actors:{}};
const labels=['ownerA','editorA','readerA','ownerB','editorB','readerB','aiA','operator'];
const save=()=>writeFile(`.staging/${host}.seed.json`,JSON.stringify(plan,null,2)+'\n');
await save();
try{
 for(const label of labels){
  const group=label.endsWith('B')?'B':'A',principal=label==='aiA'?'ai':'human';
  const email=`office-${host}.${runTag}.${label.toLowerCase()}@office-staging.invalid`,password=randomBytes(32).toString('base64url');
  const name=`Office staging ${runTag} ${label}`;
  const user=await authRequest('/auth/v1/admin/users',{email,password,email_confirm:true,user_metadata:{full_name:name},app_metadata:principal==='ai'?{office_principal:'ai'}:{}});
  if(!/^[0-9a-f-]{36}$/i.test(user.id??'')||user.email!==email||(principal==='ai'&&user.app_metadata?.office_principal!=='ai'))throw Error('STAGING_AUTH_IDENTITY_MISMATCH');
  const credential={email,password,userId:user.id,tenantId:companies[group],principal};
  const role=label==='operator'?(host==='hub'?'super_admin':'company_admin'):label.startsWith('owner')?'company_admin':label.startsWith('reader')?'worker':'manager';
  plan.users.push({label,userId:user.id,profileId:randomUUID(),name,email,group,role,principal});
  await save();
  if(label==='operator')await writeFile(`.staging/${host}.operator.json`,JSON.stringify({projectRef:target.projectRef,publishableKey:admin.publishableKey,...credential},null,2)+'\n');
  else{config.actors[label]=credential;await writeFile(`.staging/${host}.credentials.json`,JSON.stringify(config,null,2)+'\n');}
 }
 plan.status='AUTH_CREATED_SQL_SEED_PENDING';await save();
 console.log(JSON.stringify({host,projectRef:target.projectRef,status:plan.status,users:plan.users.length,runTag}));
}catch(error){plan.status='FAILED_PARTIAL';plan.error=String(error.message).slice(0,100);await save();console.error(JSON.stringify({status:plan.status,users:plan.users.length,error:plan.error}));process.exitCode=1;}
