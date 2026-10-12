/** Prepare reviewed synthetic host rows. Writes SQL locally; executes no network. */
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { validateTarget } from './staging-target.mjs';
const host=process.argv[2];
const target=validateTarget(JSON.parse(await readFile('reports/staging-targets.json','utf8')),host);
const plan=JSON.parse(await readFile(`.staging/${host}.seed.json`,'utf8'));
assert.equal(plan.projectRef,target.projectRef); assert.equal(plan.status,'AUTH_CREATED_SQL_SEED_PENDING');
assert.equal(plan.users.length,8);
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const sql=['BEGIN;',`DO $guard$ BEGIN IF (SELECT count(*) FROM auth.users) <> 8 OR EXISTS(SELECT 1 FROM public.companies) OR EXISTS(SELECT 1 FROM public.profiles) OR EXISTS(SELECT 1 FROM public.company_members) THEN RAISE EXCEPTION 'Unexpected staging seed state'; END IF; END $guard$;`];
for(const [group,id] of Object.entries(plan.companies))sql.push(`INSERT INTO public.companies(id,name) VALUES (${literal(id)},${literal(`Office staging ${plan.runTag} ${group}`)});`);
for(const u of plan.users){
 assert.ok(['company_admin','super_admin','manager','worker'].includes(u.role));
 assert.match(u.email,/^office-(hub|diriqo)\.[a-f0-9]+\.[a-z]+@office-staging\.invalid$/);
 sql.push(`DO $identity$ BEGIN IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=${literal(u.userId)} AND email=${literal(u.email)}) THEN RAISE EXCEPTION 'Synthetic Auth identity mismatch'; END IF; END $identity$;`);
 sql.push(`INSERT INTO public.profiles(id,user_id,auth_user_id,full_name,email) VALUES (${[u.profileId,u.userId,u.userId,u.name,u.email].map(literal).join(',')});`);
 sql.push(`INSERT INTO public.company_members(company_id,profile_id,role,is_active) VALUES (${[plan.companies[u.group],u.profileId,u.role].map(literal).join(',')},true);`);
 if(u.label==='operator'){
  sql.push(`INSERT INTO public.company_members(company_id,profile_id,role,is_active) VALUES (${[plan.companies.B,u.profileId,u.role].map(literal).join(',')},true);`);
  if(host==='diriqo')sql.push(`INSERT INTO private.platform_admin_grants(auth_user_id,reason) VALUES (${literal(u.userId)},${literal('Synthetic Office configuration operator '+plan.runTag)});`);
 }
}
const entities={projectRef:target.projectRef,entities:{}};
for(const [group,companyId] of Object.entries(plan.companies)){
 const customerId=randomUUID(),jobId=randomUUID(); entities.entities[group]={companyId,customerId,jobId};
 sql.push(`INSERT INTO public.customers(id,company_id,name) VALUES (${[customerId,companyId,'Office synthetic customer '+group].map(literal).join(',')});`);
 sql.push(`INSERT INTO public.jobs(id,company_id,customer_id,title,price) VALUES (${[jobId,companyId,customerId,'Office synthetic job '+group].map(literal).join(',')},12345);`);
}
sql.push('COMMIT;');
await writeFile(`.staging/${host}.seed.sql`,sql.join('\n')+'\n');
await writeFile(`.staging/${host}.entities.json`,JSON.stringify(entities,null,2)+'\n');
console.log(JSON.stringify({host,projectRef:target.projectRef,prepared:true,authUsers:8,companies:2,memberships:9,customers:2,jobs:2}));
