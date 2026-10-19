// Offline PGlite verification: actual inventory tables/RPCs and new migration;
// minimal Core/Auth/licence fixture. Hosted Supabase and real concurrency require separate proof.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
const runtime=process.env.PGLITE_MODULE
assert.ok(runtime&&path.isAbsolute(runtime),'PGLITE_MODULE must name an existing PGlite dist/index.js')
const {PGlite}=await import(pathToFileURL(runtime).href)
const db=new PGlite()
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8')
try{
 await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema private;create schema auth;grant usage on schema public,private,auth to authenticated;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
 create table public.profiles(id uuid primary key,auth_user_id uuid,user_id uuid,full_name text,is_active boolean not null default true);
 create table public.companies(id uuid primary key,name text);
 create table public.company_members(company_id uuid,profile_id uuid,role text,is_active boolean);
 create table public.customers(id uuid primary key default gen_random_uuid(),company_id uuid,name text,email text,phone text,address text);
 create table public.jobs(id uuid primary key,company_id uuid,title text,status text,work_state text,price numeric);
 create table private.company_module_rollouts(company_id uuid,product text,livemode boolean);
 create table private.company_test_module_grants(company_id uuid,product text,source_ref text,reason text,valid_from timestamptz,valid_until timestamptz,history_until timestamptz,capabilities text[],revoked_at timestamptz,revocation_reason text);
 create function private.require_module_access(c uuid,p text,cap text default null,r uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
 declare actor uuid;
 begin
 select pr.id into actor from public.profiles pr join public.company_members m on m.profile_id=pr.id where pr.auth_user_id=auth.uid() and pr.is_active and m.company_id=c and m.is_active and m.role in ('company_admin','super_admin','manager');
 if actor is null then raise exception 'MODULE_FORBIDDEN' using errcode='42501';end if;
 if not exists(select 1 from private.company_test_module_grants g where g.company_id=c and product=p and revoked_at is null and valid_from<=clock_timestamp() and valid_until>clock_timestamp() and cap=any(capabilities))then raise exception 'MODULE_REQUIRED' using errcode='42501';end if;
 return actor;end $$;
 create function private.evaluate_company_capability_access(c uuid,cap text,at_time timestamptz) returns jsonb language sql security definer set search_path='' as $$ select jsonb_build_object('allowed',exists(select 1 from private.company_test_module_grants where company_id=c and product='inventory' and revoked_at is null and valid_from<=at_time and valid_until>at_time and cap=any(capabilities))); $$;
 create function private.module_can_read(c uuid,p text,managers_only boolean default true,r uuid default null) returns boolean language sql security definer set search_path='' as $$ select exists(select 1 from public.profiles pr join public.company_members m on m.profile_id=pr.id where pr.auth_user_id=auth.uid() and pr.is_active and m.company_id=c and m.is_active); $$;
 `)
 const foundation=await read('supabase/migrations/20261011153903_functional_module_foundation.sql')
 await db.exec(foundation.slice(foundation.indexOf('create table public.gastro_items ('),foundation.indexOf('create function private.get_module_workspace_access')))
 await db.exec(await read('supabase/migrations/20261011153923_functional_inventory.sql'))
 const integrity=await read('supabase/migrations/20261011155351_functional_module_integrity.sql')
 await db.exec(integrity.slice(integrity.indexOf('create index inventory_lots_fifo_origin_idx')))
 await db.exec(await read('supabase/migrations/20261019070028_inventory_warehouse_workspace.sql'))
 const reports=await db.exec(await read('tests/inventory-warehouses.sql'))
 const report=reports.at(-1).rows[0].result
 assert.equal(report.fixtures,'rolled_back');assert.equal(report.count,19);assert.equal(report.cleanup_assertions,2)
 console.log(JSON.stringify({runtime:'PGlite 0.5.9',boundary:'actual inventory SQL; simplified Auth/Core/licence fixtures; no hosted database',...report},null,2))
}catch(e){console.error(JSON.stringify({message:e.message,code:e.code,where:e.where,detail:e.detail}));process.exitCode=1}finally{await db.close()}