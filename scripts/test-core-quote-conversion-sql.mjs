// Offline PostgreSQL only. Simplified Auth/paid infrastructure; real Core tables,
// shared evaluator, test grants and migration. This is not hosted concurrency proof.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
assert.ok(process.env.PGLITE_MODULE && path.isAbsolute(process.env.PGLITE_MODULE),'Set existing absolute PGLITE_MODULE')
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const db=new PGlite()
const sql=name=>readFile(path.join(root,name),'utf8')
try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema private; grant usage on schema public,auth,private to authenticated,service_role;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table public.profiles(id uuid primary key,auth_user_id uuid,user_id uuid,full_name text,is_active boolean not null default true);
 create table public.companies(id uuid primary key,name text);
 create table public.company_members(id uuid primary key default gen_random_uuid(),company_id uuid references public.companies(id),profile_id uuid references public.profiles(id),role text,is_active boolean,unique(company_id,profile_id));
 create table public.company_modules(id uuid primary key default gen_random_uuid(),company_id uuid references public.companies(id),module_key text,is_enabled boolean not null,unique(company_id,module_key));
 create table private.company_module_rollouts(company_id uuid,product text,livemode boolean,unique(company_id,product));
 create table private.invoice_module_rollouts(company_id uuid,livemode boolean);
 create table public.company_module_entitlements(id uuid primary key,company_id uuid,product text,register_id uuid,policy_version text,origin text,state text,revoked boolean,livemode boolean,valid_from timestamptz,valid_until timestamptz,capabilities text[]);
 create table public.calculations(id uuid primary key);`)
 const bootstrap=await sql('supabase/bootstrap-diriqo-schema.sql')
 await db.exec(bootstrap.slice(bootstrap.indexOf('create table if not exists public.customers ('),bootstrap.indexOf('create table if not exists public.job_assignments (')))
 await db.exec(bootstrap.slice(bootstrap.indexOf('create table if not exists public.quotes ('),bootstrap.indexOf('create table if not exists public.job_photos (')))
 await db.exec(bootstrap.match(/create or replace function public\.has_company_role\([\s\S]*?\$\$;/)[0])
 await db.exec(await sql('supabase/patch-job-flow-commands.sql'))
 const authority=await sql('supabase/migrations/20261010193801_add_module_capability_authority.sql')
 await db.exec(authority.match(/create function private\.guard_core_job_creation\([\s\S]*?for each row execute function private\.guard_core_job_creation\(\);/)[0])
 const payment=await sql('supabase/migrations/20261010091159_add_paid_module_entitlement_authority.sql')
 await db.exec(payment.match(/create function private\.module_offer_configuration_valid\([\s\S]*?\$function\$;/)[0])
 const grants=await sql('supabase/migrations/20261010202807_add_nonfinancial_test_module_grants.sql')
 await db.exec(grants.slice(grants.indexOf('create table private.company_test_module_grants ('),grants.indexOf('-- A JSON scalar')))
 await db.exec(grants.match(/create or replace function private\.evaluate_company_capability_access\([\s\S]*?\$function\$;/)[0])
 // Ordinary job routes stay writable; source guard must deny partial old-client conversion.
 await db.exec('grant select,insert,update,delete on public.jobs,public.quotes,public.customers to authenticated;')
 await db.exec('begin;'+await sql('supabase/migrations/20261019081209_atomic_core_quote_conversion.sql')+'commit;')
 const reports=await db.exec(await sql('supabase/tests/core-quote-conversion.sql'))
 const result=reports.at(-1)?.rows[0]?.result
 assert.equal(result?.fixtures,'rolled_back'); assert.ok(result?.count>=35)
 console.log(JSON.stringify({runtime:'PGlite',...result},null,2))
} catch(error) {console.error(JSON.stringify({message:error.message,code:error.code,where:error.where,detail:error.detail}));process.exitCode=1}
finally {await db.close()}