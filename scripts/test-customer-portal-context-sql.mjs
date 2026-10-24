// Offline regression reproduces the observed hosted portal ACL/RLS failure.
// Real migration + rollback test. Auth is SQL fixture scaffolding, not HTTP proof.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
assert.ok(process.env.PGLITE_MODULE && path.isAbsolute(process.env.PGLITE_MODULE), 'Set existing absolute PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const db = new PGlite()
const sql = name => readFile(path.join(root, name), 'utf8')
try {
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema private;
    grant usage on schema public,auth,private to authenticated,service_role;
    grant usage on schema public,auth to anon;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;
    create table public.profiles(id uuid primary key,auth_user_id uuid,user_id uuid,full_name text,is_active boolean not null default true);
    create table public.companies(id uuid primary key,name text);
    create table public.company_members(id uuid primary key default gen_random_uuid(),company_id uuid references public.companies(id),profile_id uuid references public.profiles(id),role text,is_active boolean,unique(company_id,profile_id));
  `)
  const bootstrap = (await sql('supabase/bootstrap-diriqo-schema.sql')).replace(/\r\n/g, '\n')
  await db.exec(bootstrap.slice(bootstrap.indexOf('create table if not exists public.customers ('), bootstrap.indexOf('create table if not exists public.jobs (')))
  await db.exec(bootstrap.slice(bootstrap.indexOf('create table if not exists public.customer_portal_users ('), bootstrap.indexOf('create table if not exists public.invoices (')))
  await db.exec('alter table public.customer_portal_users add column full_name text;')
  for (const name of ['is_company_member', 'has_company_role', 'is_company_admin']) {
    const definition = bootstrap.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))
    assert.ok(definition, `Bootstrap function ${name}`)
    await db.exec(definition[0])
  }
  // Same two policies observed on the hosted test DB before the repair.
  // No service_role SELECT grant on either customers or portal links.
  await db.exec(`
    alter table public.customer_portal_users enable row level security;
    create policy customer_portal_users_select_company_member on public.customer_portal_users for select to authenticated using(public.is_company_member(company_id));
    create policy customer_portal_users_admin_write on public.customer_portal_users for all to authenticated using(public.is_company_admin(company_id)) with check(public.is_company_admin(company_id));
    grant all on public.customer_portal_users to authenticated;
  `)
  const policyBefore = (await db.query("select policyname,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='customer_portal_users' order by policyname")).rows
  const checks = await sql('supabase/tests/customer-portal-context.sql')
  await assert.rejects(db.exec(checks), error => error.message === 'own_active_link_proxy_read')
  assert.equal((await db.query('select count(*)::int n from public.companies')).rows[0].n, 0)
  const migration = await sql('supabase/migrations/20261024065332_restore_customer_portal_context.sql')
  await db.exec('begin;' + migration + 'commit;')
  const policyAfter = (await db.query("select policyname,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='customer_portal_users' and policyname<>'customer_portal_users_select_own_row' order by policyname")).rows
  assert.deepEqual(policyAfter, policyBefore, 'Existing member/admin policies preserved')
  await db.exec(checks)
  const result = (await db.query("select current_setting('diriqo.test_portal_self_read')::jsonb result")).rows[0].result
  assert.equal(result.count, 33); assert.equal(result.cleanup_assertions, 5)
  console.log(JSON.stringify({ mode: 'local-pglite', preFixReproduced: 'own_active_link_proxy_read', existingPoliciesPreserved: true, ...result }, null, 2))
} finally { await db.close() }
