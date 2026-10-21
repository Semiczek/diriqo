// Offline PostgreSQL. Real calculation tables and capability evaluator; minimal
// Auth/paid infrastructure is fixture scaffolding, not hosted/concurrent HTTP proof.
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
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    grant usage on schema public,auth,private to authenticated,service_role;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $f$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;
    create table public.profiles(id uuid primary key,auth_user_id uuid,user_id uuid,full_name text,is_active boolean not null default true);
    create table public.companies(id uuid primary key,name text);
    create table public.company_members(id uuid primary key default gen_random_uuid(),company_id uuid references public.companies(id),profile_id uuid references public.profiles(id),role text,is_active boolean,unique(company_id,profile_id));
    create table public.company_modules(id uuid primary key default gen_random_uuid(),company_id uuid references public.companies(id),module_key text not null,is_enabled boolean not null,unique(company_id,module_key),
      constraint company_modules_module_key_valid_v2 check(module_key=any(array['dashboard','jobs','customers','workers','shifts','finance','calendar','absences','advance_requests','quotes','invoices','kalkulace','photos','customer_portal','public_leads','email','payroll'])));
    create table private.company_module_rollouts(company_id uuid,product text,livemode boolean,unique(company_id,product));
    create table private.invoice_module_rollouts(company_id uuid,livemode boolean);
    create table public.company_module_entitlements(id uuid primary key,company_id uuid,product text,register_id uuid,policy_version text,origin text,state text,revoked boolean,livemode boolean,valid_from timestamptz,valid_until timestamptz,capabilities text[]);
  `)
  const bootstrap = (await sql('supabase/bootstrap-diriqo-schema.sql')).replace(/\r\n/g, '\n')
  await db.exec(bootstrap.slice(bootstrap.indexOf('create table if not exists public.customers ('), bootstrap.indexOf('create table if not exists public.customer_contacts (')))
  // Match the 21 Oct hosted baseline: these runtime fields were never deployed.
  const calcSchema = bootstrap.slice(bootstrap.indexOf('create table if not exists public.calculations ('), bootstrap.indexOf('create table if not exists public.quotes ('))
    .replace('  internal_note text null,\n', '').replace('  item_type text null,\n', '').replace('  note text null,\n', '')
  await db.exec(calcSchema)
  assert.equal((await db.query("select count(*)::int as count from information_schema.columns where table_schema='public' and ((table_name='calculations' and column_name='internal_note') or(table_name='calculation_items' and column_name in('item_type','vat_rate','note')))")).rows[0].count, 0, 'Offline baseline must actually lack all four runtime columns')
  const versions = await sql('supabase/migrations/20260413143000_add_calculation_versions.sql')
  await db.exec(versions.slice(0, versions.indexOf('alter table public.calculation_versions enable')))
  await db.exec(`
    alter table public.calculation_versions alter column calculation_date set not null;
    alter table public.calculation_versions alter column calculation_date set default current_date;
    alter table public.calculation_version_items alter column vat_rate type numeric(5,2);
    alter table public.calculations enable row level security;
    alter table public.calculation_items enable row level security;
    alter table public.calculation_versions enable row level security;
    alter table public.calculation_version_items enable row level security;
    create function public.fixture_member(c uuid,admin_only boolean default false) returns boolean language sql security definer set search_path='' as $f$
      select exists(select 1 from public.company_members m join public.profiles p on p.id=m.profile_id
        where m.company_id=c and m.is_active and p.auth_user_id=auth.uid()
          and(not admin_only or m.role in('company_admin','super_admin'))) $f$;
    create policy calculations_select on public.calculations for select to authenticated using(public.fixture_member(company_id));
    create policy calculations_admin_write on public.calculations for all to authenticated using(public.fixture_member(company_id,true)) with check(public.fixture_member(company_id,true));
    create policy versions_select on public.calculation_versions for select to authenticated using(public.fixture_member(company_id));
    create policy versions_admin_write on public.calculation_versions for all to authenticated using(public.fixture_member(company_id,true)) with check(public.fixture_member(company_id,true));
    grant all on public.calculations,public.calculation_items,public.calculation_versions,public.calculation_version_items to authenticated,service_role;
    grant update(title),insert(title) on public.calculations to authenticated;
  `)
  const payment = await sql('supabase/migrations/20261010091159_add_paid_module_entitlement_authority.sql')
  await db.exec(payment.match(/create function private\.module_offer_configuration_valid\([\s\S]*?\$function\$;/)[0])
  const grants = await sql('supabase/migrations/20261010202807_add_nonfinancial_test_module_grants.sql')
  await db.exec(grants.slice(grants.indexOf('create table private.company_test_module_grants ('), grants.indexOf('-- A JSON scalar')))
  await db.exec(grants.match(/create or replace function private\.evaluate_company_capability_access\([\s\S]*?\$function\$;/)[0])
  // Nonempty legacy baseline: the migration must neither reinterpret nor rewrite it.
  await db.exec(`
    insert into public.companies(id,name) values('11000000-0000-4000-8000-000000000001','Legacy preservation fixture');
    insert into public.calculations(id,company_id,title,subtotal_cost,subtotal_price,margin_amount,total_price)
      values('11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','Legacy unchanged',7,3,-4,3);
    insert into public.calculation_items(id,calculation_id,name,unit_cost,unit_price,total_cost,total_price)
      values('11000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000002','Unknown historical classification',7,3,7,3);
    insert into public.calculation_versions(calculation_id,company_id,version_number,title,status,subtotal_cost,subtotal_price,margin_amount,total_price)
      values('11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001',1,'Legacy version','draft',6,2,-4,2);
  `)
  const capture = async () => (await db.query(`select jsonb_build_object(
    'header',(select to_jsonb(c)-'revision'-'internal_note' from public.calculations c where id='11000000-0000-4000-8000-000000000002'),
    'item',(select to_jsonb(i)-'item_type'-'vat_rate'-'note' from public.calculation_items i where id='11000000-0000-4000-8000-000000000003'),
    'versions',(select jsonb_agg(to_jsonb(v)-'source_revision'-'source_snapshot' order by id) from public.calculation_versions v where calculation_id='11000000-0000-4000-8000-000000000002')
  ) as fingerprint`)).rows[0].fingerprint
  const before = await capture()
  await db.exec('begin;' + await sql('supabase/migrations/20261021075759_atomic_core_calculation_save.sql') + 'commit;')
  assert.deepEqual(await capture(), before, 'Migration must preserve nonempty legacy content exactly')
  const legacy = (await db.query("select revision::text,internal_note from public.calculations where id='11000000-0000-4000-8000-000000000002'")).rows[0]
  assert.equal(legacy.revision, '1')
  assert.equal(legacy.internal_note, null)
  const legacyItem = (await db.query("select item_type,vat_rate,note from public.calculation_items where id='11000000-0000-4000-8000-000000000003'")).rows[0]
  assert.deepEqual(legacyItem, { item_type:null, vat_rate:null, note:null })
  const reports = await db.exec(await sql('supabase/tests/core-calculation-save.sql'))
  const result = reports.at(-1)?.rows[0]?.result
  assert.equal(result?.fixtures, 'rolled_back')
  assert.ok(result?.count >= 60, 'All calculation assertions must execute')
  assert.equal(result?.cleanup_assertions, 5)
  assert.deepEqual(await capture(), before, 'Rollback fixture cannot alter unrelated legacy content')
  const paidReports = await db.exec(`
do $paid$
declare
 c uuid:=gen_random_uuid(); other_company uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
 receipt uuid:=gen_random_uuid(); op uuid:=gen_random_uuid(); uop uuid:=gen_random_uuid(); cid uuid;
 input jsonb; updated jsonb; r jsonb; q record; problem text; passed jsonb:='[]'; before_state jsonb; after_state jsonb;
 state_sql constant text:=$q$select jsonb_build_object(
 'headers',(select jsonb_agg(to_jsonb(x) order by id) from public.calculations x where company_id=$1),
 'items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.calculation_items x join public.calculations c on c.id=x.calculation_id where c.company_id=$1),
 'versions',(select jsonb_agg(to_jsonb(x) order by id) from public.calculation_versions x where company_id=$1),
 'version_items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.calculation_version_items x join public.calculation_versions v on v.id=x.calculation_version_id where v.company_id=$1),
 'requests',(select jsonb_agg(to_jsonb(x) order by operation_id) from private.core_calculation_save_requests x where company_id=$1))$q$;
begin
 begin
  insert into auth.users(id,email) values(u,'local-paid-calculation@example.invalid');
  insert into public.profiles(id,auth_user_id,user_id,full_name,is_active) values(p,u,u,'Local paid calculation',true);
  insert into public.companies(id,name) values(c,'Local paid calculation fixture'),(other_company,'Local foreign fixture');
  insert into public.company_members(company_id,profile_id,role,is_active) values(c,p,'company_admin',true);
  insert into public.company_modules(company_id,module_key,is_enabled) values(c,'quotes',true);
  insert into private.company_module_rollouts(company_id,product,livemode) values(c,'diriqo_core',true);
  insert into public.company_module_entitlements(id,company_id,product,register_id,policy_version,origin,state,revoked,livemode,valid_from,valid_until,capabilities)
   values(receipt,c,'diriqo_core',null,'diriqo-capabilities-v0.1','paid','active',false,true,now()-interval '1 hour',now()+interval '1 hour',array['core.quotes.create']);
  input:=jsonb_build_object('customer_id',null,'title','Paid branch calculation','description',null,'status','draft',
   'calculation_date','2026-10-21','internal_note',null,'currency','CZK','items',jsonb_build_array(jsonb_build_object(
   'item_type','customer','name','Customer price','description',null,'quantity','1.00','unit','ks','unit_cost','0.00','unit_price','2.00','vat_rate','0.00','note',null)));
  updated:=input||'{"title":"Paid updated"}';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',u::text,true);execute 'set local role authenticated';
  r:=public.create_core_calculation_atomic(c,op,input);cid:=(r->>'calculationId')::uuid;
  assert r->>'revision'='1' and r->>'replayed'='false','paid_create_allowed';
  r:=public.update_core_calculation_atomic(c,cid,1,uop,updated);
  assert r->>'revision'='2' and r->>'replayed'='false','paid_update_allowed';
  execute 'reset role';passed:=passed||jsonb_build_array('paid_create_allowed','paid_update_allowed');
  execute state_sql into before_state using c;
  for q in select * from(values
   ('revoked','revoked=true'),
   ('expired','valid_until=clock_timestamp()-interval ''1 second'''),
   ('future','valid_from=clock_timestamp()+interval ''1 hour'',valid_until=clock_timestamp()+interval ''2 hours'''),
   ('wrong_product','product=''inventory'''),
   ('wrong_register','register_id=gen_random_uuid()'),
   ('wrong_capability','capabilities=array[''core.jobs.create'']'),
   ('wrong_policy','policy_version=''unsupported'''),
   ('wrong_mode','livemode=false'),
   ('wrong_origin','origin=''manual_grant'''),
   ('inactive','state=''cancelled'''),
   ('wrong_company',format('company_id=%L',other_company))
  ) cases(label,mutation) loop
   update public.company_module_entitlements set company_id=c,product='diriqo_core',register_id=null,
    policy_version='diriqo-capabilities-v0.1',origin='paid',state='active',revoked=false,livemode=true,
    valid_from=now()-interval '1 hour',valid_until=now()+interval '1 hour',capabilities=array['core.quotes.create'] where id=receipt;
   execute 'update public.company_module_entitlements set '||q.mutation||' where id=$1' using receipt;
   execute 'set local role authenticated';problem:=null;
   begin perform public.create_core_calculation_atomic(c,op,input);exception when others then get stacked diagnostics problem=message_text;end;
   assert problem='CALCULATION_MODULE_REQUIRED','paid_create_replay_'||q.label;
   problem:=null;
   begin perform public.update_core_calculation_atomic(c,cid,2,gen_random_uuid(),updated);exception when others then get stacked diagnostics problem=message_text;end;
   assert problem='CALCULATION_MODULE_REQUIRED','paid_update_'||q.label;
   assert exists(select 1 from public.calculations where id=cid and revision=2),'paid_history_remains_readable';
   execute 'reset role';execute state_sql into after_state using c;
   assert before_state=after_state,'paid_rejection_complete_unchanged';
   passed:=passed||jsonb_build_array('paid_'||q.label||'_create_replay_and_update_denied');
  end loop;
  raise exception 'ROLLBACK_LOCAL_PAID_FIXTURE' using errcode='PT001';
 exception when sqlstate 'PT001' then null;end;
 assert not exists(select 1 from public.company_module_entitlements where id=receipt),'local_paid_receipt_rolled_back';
 assert not exists(select 1 from public.companies where id in(c,other_company)),'local_paid_company_rolled_back';
 perform set_config('diriqo.core_calculation_local_paid',jsonb_build_object('count',jsonb_array_length(passed),'passed',passed,
  'fixtures','rolled_back','cleanup_assertions',2,'boundary','simplified_local_receipt_schema_not_provider_provenance')::text,false);
end;
$paid$;
select current_setting('diriqo.core_calculation_local_paid')::jsonb as result;
  `)
  const localPaid = paidReports.at(-1)?.rows[0]?.result
  assert.equal(localPaid?.count, 13)
  assert.equal(localPaid?.fixtures, 'rolled_back')
  assert.equal(localPaid?.cleanup_assertions, 2)

  console.log(JSON.stringify({ runtime:'PGlite', migration_preservation_assertions:5, ...result, local_paid:localPaid }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ message:error.message, code:error.code, where:error.where, detail:error.detail }))
  process.exitCode = 1
} finally {
  await db.close()
}
