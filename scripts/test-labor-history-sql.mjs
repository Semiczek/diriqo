// Offline PostgreSQL regression, not hosted concurrency or authenticated HTTP evidence.
// Real labor migration and real capability evaluator; minimal live-compatible source/Auth schema.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const modulePath=process.env.PGLITE_MODULE || fileURLToPath(import.meta.resolve('@electric-sql/pglite'))
assert.ok(path.isAbsolute(modulePath),'PGLITE_MODULE must be an absolute path when overridden')
const {PGlite}=await import(pathToFileURL(modulePath).href)
const db=new PGlite()
const sql=name=>readFile(path.join(root,name),'utf8')
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema private;grant usage on schema public,auth,private to authenticated,service_role;grant usage on schema public,auth to anon;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table public.companies(id uuid primary key,name text not null,currency text not null default 'CZK',default_currency text,timezone text not null default 'Europe/Prague');
 create table public.profiles(id uuid primary key,auth_user_id uuid,user_id uuid,full_name text not null,is_active boolean not null default true,default_hourly_rate numeric(12,2) not null default 0,worker_type text not null default 'employee');
 create table public.company_members(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),profile_id uuid not null references public.profiles(id),role text not null default 'worker',is_active boolean not null default true,unique(company_id,profile_id));
 create table public.jobs(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),title text not null,currency text not null default 'CZK',parent_job_id uuid,price numeric(12,2) default 0);
 create table public.work_shifts(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),profile_id uuid not null references public.profiles(id),job_id uuid references public.jobs(id),shift_date date,started_at timestamptz,ended_at timestamptz,hourly_rate numeric(12,2) not null default 0,hours_override numeric(12,2),job_hours_override numeric(12,2),status text default 'planned',note text,updated_at timestamptz default now());
 create unique index work_shifts_one_running_per_worker on public.work_shifts(company_id,profile_id) where started_at is not null and ended_at is null;
 create table public.work_logs(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),profile_id uuid not null references public.profiles(id),job_id uuid references public.jobs(id),shift_id uuid references public.work_shifts(id) on delete set null,work_date date,started_at timestamptz,ended_at timestamptz,hours numeric(12,2) not null default 0,archived_at timestamptz,note text,updated_at timestamptz default now());
 create table public.job_assignments(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),profile_id uuid not null references public.profiles(id),job_id uuid not null references public.jobs(id),hourly_rate numeric(12,2) not null default 0,labor_hours numeric(12,2) not null default 0,labor_cost numeric(12,2) not null default 0,external_amount numeric(12,2),work_started_at timestamptz,work_completed_at timestamptz,archived_at timestamptz,note text,updated_at timestamptz default now(),unique(job_id,profile_id));
 create table private.company_module_rollouts(company_id uuid,product text,livemode boolean,unique(company_id,product));
 create table private.invoice_module_rollouts(company_id uuid,livemode boolean);
 create table public.company_module_entitlements(id uuid primary key,company_id uuid,product text,register_id uuid,policy_version text,origin text,state text,revoked boolean,livemode boolean,valid_from timestamptz,valid_until timestamptz,capabilities text[]);
 grant select,insert,update,delete on public.work_shifts,public.work_logs,public.job_assignments to authenticated;
 `)
 const payment=await sql('supabase/migrations/20261010091159_add_paid_module_entitlement_authority.sql')
 await db.exec(payment.match(/create function private\.module_offer_configuration_valid\([\s\S]*?\$function\$;/)[0])
 const grants=await sql('supabase/migrations/20261010202807_add_nonfinancial_test_module_grants.sql')
 await db.exec(grants.slice(grants.indexOf('create table private.company_test_module_grants ('),grants.indexOf('-- A JSON scalar')))
 await db.exec(grants.match(/create or replace function private\.evaluate_company_capability_access\([\s\S]*?\$function\$;/)[0])
 await db.exec('begin;'+await sql('supabase/migrations/20261024083058_labor_history_foundation.sql')+'commit;')
 const definitionQuery=`select p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel,p.prorettype,p.proargtypes,p.proargnames,p.prosrc
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('labor_sources_validate','labor_mutate') order by p.proname`
 const beforeDefinitions=(await db.query(definitionQuery)).rows
 assert.equal(beforeDefinitions.length,2)
 await db.exec('begin;'+await sql('supabase/migrations/20261024091643_labor_domain_conflict_status.sql')+'commit;')
 const afterDefinitions=(await db.query(definitionQuery)).rows
 assert.deepEqual(afterDefinitions,beforeDefinitions.map(row=>({...row,prosrc:row.prosrc.replaceAll("errcode='40001'","errcode='PT409'")})),
  'Only explicit labor domain SQLSTATEs change; function identity, ACL, security, search path and all other behavior are preserved')
 const reports=await db.exec(await sql('supabase/tests/labor-history.sql'))
 const result=reports.at(-1)?.rows[0]?.result
 assert.equal(result?.fixtures,'rolled_back')
 assert.equal(result?.count,99,'All lifecycle, rates, source picker and authorization checks ran')
 assert.equal(result?.cleanup_assertions,5)
 assert.equal(result?.domain_conflicts?.length,9,'All conflict branches return actual SQL errors')
 assert.ok(result.domain_conflicts.every(error=>error.code==='PT409'),'Domain conflicts never use the retryable serialization SQLSTATE')
 const {contracts,...summary}=result
 assert.equal(contracts.length,26,'Actual RPC DTO snapshots collected')
 console.log(JSON.stringify({runtime:'PGlite',realCapabilityEvaluator:true,concurrentSessions:false,...summary,contractCases:contracts.length,...(process.argv.includes('--contract-json')?{contracts}:{})},null,2))
} catch(error){console.error(JSON.stringify({message:error.message,code:error.code,where:error.where,detail:error.detail,position:error.position,internalPosition:error.internalPosition,internalQuery:error.internalQuery}));process.exitCode=1}
finally {await db.close()}
