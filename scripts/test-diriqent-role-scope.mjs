// Isolated, in-memory PostgreSQL verification. No database URL, credentials,
// network requests or provider calls are used. Close the WASM runtime on exit.
// Install the pinned test-only runtime separately (not in application deps):
// npm install --prefix work/validation-deps --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.9
// Run: node scripts/test-diriqent-role-scope.mjs
// Boundary: real Diriqent migrations/RPCs/RLS/ledger; minimal auth, Core tables
// and module-entitlement fixture. This does not prove deployed Supabase behavior.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtime = path.join(root, 'work/validation-deps/node_modules/@electric-sql/pglite/dist/index.js')
const { PGlite } = await import(pathToFileURL(runtime).href)
const db = new PGlite()
const sql = (relativePath) => readFile(path.join(root, relativePath), 'utf8')

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private; create schema storage;
    grant usage on schema public,auth,private to authenticated,service_role;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create table public.profiles(id uuid primary key,auth_user_id uuid,user_id uuid,full_name text);
    create table public.companies(id uuid primary key,name text);
    create table public.company_members(id uuid primary key default gen_random_uuid(),company_id uuid,profile_id uuid,role text,is_active boolean,unique(company_id,profile_id));
    create table public.customers(id uuid primary key,company_id uuid,name text);
    create table public.jobs(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,title text,description text,address text,price numeric,currency text,status text,work_state text,billing_state text,billing_status text,is_paid boolean,is_internal boolean,start_at timestamptz,end_at timestamptz,scheduled_start timestamptz,scheduled_end timestamptz,archived_at timestamptz,updated_at timestamptz default now());
    create table public.job_assignments(company_id uuid,job_id uuid,profile_id uuid,archived_at timestamptz);
    create table public.work_shifts(id uuid primary key default gen_random_uuid(),company_id uuid,profile_id uuid,job_id uuid,shift_date date,started_at timestamptz,ended_at timestamptz,status text,hours_override numeric,job_hours_override numeric,created_at timestamptz default now());
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table private.company_module_rollouts(company_id uuid,product text,livemode boolean);
    create table private.company_test_module_grants(id uuid default gen_random_uuid(),company_id uuid,product text,source_ref text,reason text,valid_from timestamptz,valid_until timestamptz,history_until timestamptz,capabilities text[],revoked_at timestamptz,revocation_reason text,livemode boolean default false);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',nullif(current_setting('request.jwt.claim.sub',true),''))::uuid;
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role';
    $$;
    create function public.current_profile_id() returns uuid language sql stable security definer set search_path='' as $$
      select id from public.profiles where auth_user_id=auth.uid() or user_id=auth.uid() limit 1;
    $$;
    create function public.has_company_role(c uuid,roles text[]) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.company_members where company_id=c and profile_id=public.current_profile_id() and is_active and role=any(roles));
    $$;
    create function private.module_has_entitlement(c uuid,p text,cap text default null,r uuid default null) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from private.company_test_module_grants g where g.company_id=c and g.product=p and g.revoked_at is null and g.valid_from<=now() and g.valid_until>now() and (cap is null or cap=any(g.capabilities)));
    $$;
    create function private.require_module_entitlement(c uuid,p text,cap text default null,r uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
    begin
      if not public.has_company_role(c,array['super_admin','company_admin','manager','worker']) then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
      if not private.module_has_entitlement(c,p,cap,r) then raise exception 'MODULE_REQUIRED' using errcode='42501'; end if;
      return public.current_profile_id();
    end $$;
    create function private.require_module_access(c uuid,p text,cap text default null,r uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
    declare actor uuid;
    begin
      actor:=private.require_module_entitlement(c,p,cap,r);
      if not public.has_company_role(c,array['super_admin','company_admin','manager']) then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
      return actor;
    end $$;
    create function private.module_can_read(c uuid,p text,managers_only boolean default true,r uuid default null) returns boolean language sql stable security definer set search_path='' as $$
      select public.has_company_role(c,case when managers_only then array['super_admin','company_admin','manager'] else array['super_admin','company_admin','manager','worker'] end) and private.module_has_entitlement(c,p,null,r);
    $$;
  `)
  await db.exec(await sql('supabase/migrations/20261011160607_functional_diriqent.sql'))
  await db.exec(await sql('supabase/migrations/20261011164407_functional_diriqent_integrity.sql'))
  // Seed ambiguous historical data before adding access_scope, to exercise the
  // actual migration backfill rather than creating already-classified records.
  await db.exec(`
    insert into public.companies(id,name) values('11111111-1111-4111-8111-111111111111','Legacy test');
    insert into public.profiles(id,full_name) values('22222222-2222-4222-8222-222222222222','Legacy author');
    insert into public.diriqent_conversations(id,company_id,profile_id,title,requires_manager) values
     ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Legacy private title',true),
     ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Legacy worker title',false);
    insert into public.diriqent_operations(id,company_id,profile_id,conversation_id,kind,prompt,fingerprint,requires_manager,state,reserved_units,result) values
     ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','chat','Preserve admin original','legacy',true,'completed',100,'{"answer":"Preserve private result"}'),
     ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','chat','Preserve worker original','legacy',false,'completed',100,'{"answer":"Preserve worker result"}');
  `)
  await db.exec(await sql('supabase/migrations/20261013185010_diriqent_role_scopes.sql'))
  const legacy = await db.query('select requires_manager,access_scope,prompt,result from public.diriqent_operations order by requires_manager desc')
  assert.equal(legacy.rows[0].access_scope, 'company_admin')
  assert.equal(legacy.rows[1].access_scope, 'worker')
  assert.equal(legacy.rows[0].result.answer, 'Preserve private result')
  assert.equal(legacy.rows[1].prompt, 'Preserve worker original')
  const legacyTitles = await db.query('select title,access_scope from public.diriqent_conversations order by requires_manager desc')
  assert.equal(legacyTitles.rows[0].access_scope, 'company_admin')
  assert.equal(legacyTitles.rows[1].title, 'Legacy worker title')
  console.log('PASS: 6 legacy backfill/data-preservation assertions')

  await db.exec(await sql('supabase/migrations/20261014041318_diriqent_work_quotes.sql'))
  for (const file of ['tests/diriqent-integration.sql', 'tests/diriqent-role-scope.sql', 'tests/diriqent-work-quotes.sql']) {
    const results = await db.exec(await sql(file))
    console.log(`PASS: ${file}`, JSON.stringify(results.at(-1).rows[0].result))
  }
} finally {
  await db.close()
}
