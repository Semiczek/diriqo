// Isolated PostgreSQL execution. No network, database URL or credentials are read.
// Supply an existing @electric-sql/pglite 0.5.9 dist/index.js via PGLITE_MODULE.
// No dependency is installed by this script or added to the application.
// Actual calendar migration + actual shared capability evaluator/test-grant
// constraints; simplified Auth/Core/paid-receipt schema. This is not hosted proof.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtime = process.env.PGLITE_MODULE
assert.ok(runtime && path.isAbsolute(runtime), 'PGLITE_MODULE must name an existing absolute PGlite module path')
const { PGlite } = await import(pathToFileURL(runtime).href)
const db = new PGlite()
const sql = (name) => readFile(path.join(root, name), 'utf8')
const migration = 'supabase/migrations/20261018194423_atomic_calendar_event_edits.sql'

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    grant usage on schema public,auth,private to authenticated,service_role;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',nullif(current_setting('request.jwt.claim.sub',true),''))::uuid;
    $$;
    create table public.profiles(id uuid primary key,auth_user_id uuid,user_id uuid,full_name text,is_active boolean not null default true);
    create table public.companies(id uuid primary key,name text);
    create table public.company_members(id uuid primary key default gen_random_uuid(),company_id uuid references public.companies(id),profile_id uuid references public.profiles(id),role text,is_active boolean,unique(company_id,profile_id));
    create table public.jobs(id uuid primary key,company_id uuid references public.companies(id),title text);
    create table public.company_modules(id uuid primary key default gen_random_uuid(),company_id uuid references public.companies(id),module_key text,is_enabled boolean not null,unique(company_id,module_key));
    create table private.company_module_rollouts(company_id uuid,product text,livemode boolean,unique(company_id,product));
    create table private.invoice_module_rollouts(company_id uuid,livemode boolean);
    create table public.company_module_entitlements(id uuid primary key,company_id uuid,product text,register_id uuid,policy_version text,origin text,state text,revoked boolean,livemode boolean,valid_from timestamptz,valid_until timestamptz,capabilities text[]);
  `)
  const bootstrap = await sql('supabase/bootstrap-diriqo-schema.sql')
  const calendarTables = bootstrap.slice(bootstrap.indexOf('create table if not exists public.calendar_events ('), bootstrap.indexOf('create table if not exists public.calculations ('))
  assert.ok(calendarTables.includes('calendar_event_assignments'))
  await db.exec(calendarTables)
  await db.exec(`alter table public.calendar_event_assignments alter column company_id set not null;
    grant all on public.calendar_events,public.calendar_event_assignments to authenticated,service_role;
    grant update(title),insert(title) on public.calendar_events to authenticated;
    alter table public.calendar_events enable row level security;
    alter table public.calendar_event_assignments enable row level security;`)
  const paymentAuthority = await sql('supabase/migrations/20261010091159_add_paid_module_entitlement_authority.sql')
  const offerValidator = paymentAuthority.match(/create function private\.module_offer_configuration_valid\([\s\S]*?\$function\$;/)?.[0]
  assert.ok(offerValidator, 'actual offer validator must be found')
  await db.exec(offerValidator)
  const testAuthority = await sql('supabase/migrations/20261010202807_add_nonfinancial_test_module_grants.sql')
  await db.exec(testAuthority.slice(testAuthority.indexOf('create table private.company_test_module_grants ('),testAuthority.indexOf('-- A JSON scalar')))
  const evaluator = testAuthority.match(/create or replace function private\.evaluate_company_capability_access\([\s\S]*?\$function\$;/)?.[0]
  assert.ok(evaluator, 'actual capability evaluator must be found')
  await db.exec(evaluator)

  // The migration itself must stop rather than rewrite an ambiguous old row.
  await db.exec(`begin;
    insert into public.companies(id,name) values('00000000-0000-0000-0000-000000000001','Preflight only');
    insert into public.calendar_events(company_id,title,start_at,starts_at)
      values('00000000-0000-0000-0000-000000000001','Conflicting aliases','2026-11-01T10:00:00Z','2026-11-01T11:00:00Z');`)
  await assert.rejects(db.exec(await sql(migration)), (error) => error.message === 'CALENDAR_ALIAS_CONFLICT')
  await db.exec('rollback')
  await db.exec(`begin; ${await sql(migration)} commit;`)
  const reports = await db.exec(await sql('supabase/tests/calendar-events.sql'))
  const result = reports.at(-1)?.rows[0]?.result
  assert.equal(result?.fixtures, 'rolled_back')
  assert.equal(result?.cleanup_assertions, 4)
  const paidReports = await db.exec(await sql('supabase/tests/calendar-events-local-paid.sql'))
  const localPaid = paidReports.at(-1)?.rows[0]?.result
  assert.equal(localPaid?.fixtures, 'rolled_back')
  assert.equal(localPaid?.cleanup_assertions, 2)
  console.log(JSON.stringify({ runtime: 'PGlite', migrationPreflightRefusal: 'PASS', ...result, localPaid }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ message: error.message, code: error.code, where: error.where, detail: error.detail }))
  process.exitCode = 1
} finally {
  await db.close()
}
