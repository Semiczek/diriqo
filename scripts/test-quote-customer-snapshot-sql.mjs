// Offline PostgreSQL: real quote schema, capability evaluator, migration and assertions.
// Simplified Auth/entitlement infrastructure; not hosted multi-session lock proof.
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
 create table public.companies(id uuid primary key,name text,logo_url text);
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
 const runtime=await sql('supabase/patch-diriqo-quotes-runtime.sql')
 await db.exec([...runtime.matchAll(/alter table public\.quotes add column if not exists[^;]+;/g)].map(x=>x[0]).join('\n'))
 await db.exec('alter table public.quotes add column share_token_scope text,add column share_token_expires_at timestamptz,add column share_token_revoked_at timestamptz;')
 const payment=await sql('supabase/migrations/20261010091159_add_paid_module_entitlement_authority.sql')
 await db.exec(payment.match(/create function private\.module_offer_configuration_valid\([\s\S]*?\$function\$;/)[0])
 const grants=await sql('supabase/migrations/20261010202807_add_nonfinancial_test_module_grants.sql')
 await db.exec(grants.slice(grants.indexOf('create table private.company_test_module_grants ('),grants.indexOf('-- A JSON scalar')))
 await db.exec(grants.match(/create or replace function private\.evaluate_company_capability_access\([\s\S]*?\$function\$;/)[0])
 await db.exec(await sql('supabase/migrations/20260509133000_add_company_logo_to_public_offers.sql'))
 await db.exec('grant select,insert,update,delete on public.quotes,public.customers to authenticated;')
 // Seed actual pre-migration records, including a draft which could have been sent earlier.
 const fixtures=(await db.query(`with company as(insert into public.companies values(gen_random_uuid(),'Before migration',null) returning id),
 customer as(insert into public.customers(company_id,name,billing_street) select id,'Current name','Current street' from company returning id,company_id)
 insert into public.quotes(company_id,customer_id,title,status,share_token)
 select company_id,id,'Existing '||s,s,case when s='sent' then repeat('a',48) else null end from customer cross join unnest(array['draft','sent']) s
 returning id,company_id,customer_id`)).rows
 await db.exec('begin;'+await sql('supabase/migrations/20261021062831_protect_quote_customer_identity.sql')+'commit;')
 const old=(await db.query('select customer_identity_state,customer_snapshot,customer_snapshot_captured_at from public.quotes')).rows
 assert.equal(old.length,2)
 assert.ok(old.every(q=>q.customer_identity_state==='legacy_unknown' && q.customer_snapshot===null && q.customer_snapshot_captured_at===null))
 assert.equal((await db.query("select customer_name from public.get_public_offer_by_token(repeat('a',48))")).rows[0].customer_name,null)
 await db.query('delete from public.quotes where company_id=$1',[fixtures[0].company_id])
 await db.query('delete from public.customers where company_id=$1',[fixtures[0].company_id])
 await db.query('delete from public.companies where id=$1',[fixtures[0].company_id])
 const reports=await db.exec(await sql('supabase/tests/quote-customer-snapshot.sql'))
 const result=reports.at(-1)?.rows[0]?.result
 assert.equal(result?.fixtures,'rolled_back'); assert.ok(result?.count>=40)
 console.log(JSON.stringify({runtime:'PGlite',migration_assertions:3,...result},null,2))
} catch(error) {console.error(JSON.stringify({message:error.message,code:error.code,where:error.where,detail:error.detail}));process.exitCode=1}
finally {await db.close()}
