/** One synthetic non-platform manager with two memberships, exclusively for tab-switch tests. */
import {readFile,writeFile,access} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateTarget} from './staging-target.mjs';
const host=process.argv[2];
assert.equal(process.argv[3],'--execute');
const target=validateTarget(JSON.parse(await readFile('reports/staging-targets.json','utf8')),host);
const admin=JSON.parse(await readFile(`.staging/${host}.admin.json`,'utf8'));
const plan=JSON.parse(await readFile(`.staging/${host}.seed.json`,'utf8'));
assert.equal(admin.projectRef,target.projectRef);assert.equal(plan.projectRef,target.projectRef);
const claims=JSON.parse(Buffer.from(admin.secretKey.split('.')[1],'base64url').toString());
assert.equal(claims.ref,target.projectRef);assert.equal(claims.role,'service_role');
try { await access(`.staging/${host}.dual.json`); throw Error('Dual account already provisioned'); } catch(e) { if(e.code!=='ENOENT')throw e; }
const email=`office-${host}.${plan.runTag}.dual@office-staging.invalid`,password=randomBytes(32).toString('base64url');
const response=await fetch(target.origin+'/auth/v1/admin/users',{method:'POST',redirect:'error',headers:{apikey:admin.secretKey,Authorization:'Bearer '+admin.secretKey,'Content-Type':'application/json'},body:JSON.stringify({email,password,email_confirm:true,user_metadata:{full_name:'Synthetic Office dual-company manager'},app_metadata:{}}),signal:AbortSignal.timeout(20000)});
const user=await response.json();assert.ok(response.ok&&user.email===email&&/^[a-f0-9-]{36}$/.test(user.id),'Synthetic Auth creation failed');
const record={projectRef:target.projectRef,publishableKey:admin.publishableKey,email,password,userId:user.id,profileId:randomUUID(),tenantId:plan.companies.A,companyIds:plan.companies,principal:'human'};
await writeFile(`.staging/${host}.dual.json`,JSON.stringify(record,null,2)+'\n');
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
const sql=`BEGIN;\nINSERT INTO public.profiles(id,user_id,auth_user_id,full_name,email) VALUES (${[record.profileId,user.id,user.id,'Synthetic Office dual-company manager',email].map(q).join(',')});\n${Object.values(plan.companies).map(id=>`INSERT INTO public.company_members(company_id,profile_id,role,is_active) VALUES (${q(id)},${q(record.profileId)},'manager',true);`).join('\n')}\nCOMMIT;`;
await writeFile(`.staging/${host}.dual.sql`,sql);
console.log(JSON.stringify({host,projectRef:target.projectRef,userId:user.id,profileId:record.profileId,role:'manager',platformPrivileges:false,membershipsPrepared:2}));
