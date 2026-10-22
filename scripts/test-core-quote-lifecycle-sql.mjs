// Offline quote lifecycle regression. Real Core migrations, minimal
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
  await db.exec('begin;'+await sql('supabase/migrations/20261021075759_atomic_core_calculation_save.sql')+'commit;')
  await db.exec(bootstrap.slice(bootstrap.indexOf('create table if not exists public.customer_contacts ('), bootstrap.indexOf('create table if not exists public.job_assignments (')))
  await db.exec(bootstrap.slice(bootstrap.indexOf('create table if not exists public.quotes ('), bootstrap.indexOf('create table if not exists public.job_photos (')))
  const runtime=await sql('supabase/patch-diriqo-quotes-runtime.sql')
  await db.exec([...runtime.matchAll(/alter table public\.quotes add column if not exists[^;]+;/g)].map(x=>x[0]).join('\n'))
  await db.exec(`alter table public.quotes drop column discount_amount,drop column customer_note,drop column internal_note,drop column first_viewed_at,drop column last_viewed_at,drop column view_count;
   alter table public.quotes drop constraint quotes_source_calculation_id_fkey;
   alter table public.quote_items alter column company_id set not null;
   alter table public.quote_items add column vat_rate numeric(5,2) not null default 21;
   alter table public.quotes add column share_token_scope text default 'quote_public_offer',add column share_token_expires_at timestamptz,add column share_token_revoked_at timestamptz;
   alter table public.quotes enable row level security;alter table public.quote_items enable row level security;
   create policy quotes_member on public.quotes for select to authenticated using(public.fixture_member(company_id,true));
   create policy legacy_broad_items_read on public.quote_items for select to authenticated using(true);
   grant all on public.jobs,public.quotes,public.quote_items to authenticated;
   grant usage on schema private to authenticated;
   create table public.offer_events(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),quote_id uuid references public.quotes(id) on delete cascade,event_type text not null,visitor_id text,created_at timestamptz not null default now());
   create table public.customer_portal_users(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),customer_id uuid not null references public.customers(id),auth_user_id uuid references auth.users(id),is_active boolean not null default true,email text not null);
  `)
  await db.exec(bootstrap.match(/create or replace function public\.has_company_role\([\s\S]*?\$\$;/)[0])
  await db.exec(await sql('supabase/patch-job-flow-commands.sql'))
  const authority=await sql('supabase/migrations/20261010193801_add_module_capability_authority.sql')
  await db.exec(authority.match(/create function private\.guard_core_job_creation\([\s\S]*?for each row execute function private\.guard_core_job_creation\(\);/)[0])
  await db.exec('begin;'+await sql('supabase/migrations/20261019081209_atomic_core_quote_conversion.sql')+'commit;')
  await db.exec(await sql('supabase/migrations/20260509133000_add_company_logo_to_public_offers.sql'))
  const oldPublic=await sql('supabase/migrations/20260413090000_secure_public_offer_rpc.sql')
  await db.exec(oldPublic.match(/create or replace function public\.get_public_offer_items_by_token\([\s\S]*?\$\$;/)[0])
  // Nonempty pre-migration baseline, including a completed old C01 receipt.
  await db.exec(`
   insert into auth.users(id,email,raw_user_meta_data) values('e1200000-0000-4000-8000-000000000001','legacy-quote@example.invalid','{}'),('e1200000-0000-4000-8000-000000000006','legacy-portal@example.invalid','{}');
   insert into public.profiles(id,auth_user_id,user_id,full_name,is_active) values('e1200000-0000-4000-8000-000000000002','e1200000-0000-4000-8000-000000000001','e1200000-0000-4000-8000-000000000001','Legacy owner',true);
   insert into public.companies(id,name) values('e1200000-0000-4000-8000-000000000003','Legacy supplier');
   insert into public.company_members(company_id,profile_id,role,is_active) values('e1200000-0000-4000-8000-000000000003','e1200000-0000-4000-8000-000000000002','company_admin',true);
   insert into public.customers(id,company_id,name,billing_street) values('e1200000-0000-4000-8000-000000000004','e1200000-0000-4000-8000-000000000003','Legacy customer','Never inferred old street');
   insert into public.customer_portal_users(company_id,customer_id,auth_user_id,email,is_active) values('e1200000-0000-4000-8000-000000000003','e1200000-0000-4000-8000-000000000004','e1200000-0000-4000-8000-000000000006','legacy-portal@example.invalid',true);
   insert into public.calculations(id,company_id,customer_id,title) values('e1200000-0000-4000-8000-000000000005','e1200000-0000-4000-8000-000000000003','e1200000-0000-4000-8000-000000000004','Ambiguous old source');
   insert into public.quotes(id,company_id,customer_id,title,currency,subtotal_price,total_price,total_amount,share_token,share_enabled) values
    ('e1200000-0000-4000-8000-000000000011','e1200000-0000-4000-8000-000000000003','e1200000-0000-4000-8000-000000000004','Old converted quote','CZK',42,42,42,'legacy-converted-token',true),
    ('e1200000-0000-4000-8000-000000000012','e1200000-0000-4000-8000-000000000003','e1200000-0000-4000-8000-000000000004','Old EUR quote','EUR',5,5,5,'legacy-edit-token',true);
   insert into public.quotes(id,company_id,source_calculation_id,title) values
    ('e1200000-0000-4000-8000-000000000013','e1200000-0000-4000-8000-000000000003','e1200000-0000-4000-8000-000000000005','Ambiguous A'),
    ('e1200000-0000-4000-8000-000000000014','e1200000-0000-4000-8000-000000000003','e1200000-0000-4000-8000-000000000005','Ambiguous B');
   insert into public.quote_items(company_id,quote_id,name,quantity,unit_price,vat_rate) values
    ('e1200000-0000-4000-8000-000000000003','e1200000-0000-4000-8000-000000000011','Legacy line',1,42,0),
    ('e1200000-0000-4000-8000-000000000003','e1200000-0000-4000-8000-000000000012','Legacy generated total',1,5,21);
  `)
  await db.exec('begin;'+await sql('supabase/migrations/20261021062831_protect_quote_customer_identity.sql')+'commit;')
  const legacyCompany='e1200000-0000-4000-8000-000000000003', legacyQuote='e1200000-0000-4000-8000-000000000011', legacyEdit='e1200000-0000-4000-8000-000000000012',legacyOperation='e1200000-0000-4000-8000-000000000015'
  const legacyPlan={title:'Legacy converted job',description:null,address:null,start_at:'2026-10-22T08:00:00Z',end_at:'2026-10-23T18:00:00Z',split_days:[{label:'One day',start_at:'2026-10-22T08:00:00Z',end_at:'2026-10-22T18:00:00Z'}]}
  await db.exec(`select set_config('request.jwt.claim.sub','e1200000-0000-4000-8000-000000000001',false);set role authenticated;`)
  const legacyConversion=(await db.query('select public.convert_core_quote_to_job_atomic($1,$2,$3,$4::jsonb) result',[legacyCompany,legacyQuote,legacyOperation,JSON.stringify(legacyPlan)])).rows[0].result
  await db.exec('reset role')
  const legacyState=async()=> (await db.query(`select jsonb_build_object(
   'quotes',(select jsonb_agg(to_jsonb(q) - array['revision','draft_open','pricing_mode','discount_amount','customer_note','internal_note','source_calculation_revision','current_version_id','accepted_version_id','archived_at'] order by id) from public.quotes q where company_id=$1),
   'items',(select jsonb_agg(to_jsonb(i) order by id) from public.quote_items i where company_id=$1),
   'jobs',(select jsonb_agg(to_jsonb(j)-'source_quote_version_id' order by id) from public.jobs j where company_id=$1),
   'receipts',(select jsonb_agg(to_jsonb(r)-'version_id' order by quote_id) from private.core_quote_conversions r where company_id=$1),
   'requests',(select jsonb_agg(to_jsonb(r)-array['version_id','actor_id'] order by operation_id) from private.core_quote_conversion_requests r where company_id=$1)) result`,[legacyCompany])).rows[0].result
  const legacyBefore=await legacyState()
  await db.exec('begin;'+await sql('supabase/migrations/20261022033222_atomic_core_quote_lifecycle.sql')+'commit;')
  const legacyTests=[]
  // Reproduce the real hosted failure against the production-like generated column.
  // The failed UPDATE and its preliminary open are rolled back before the repair.
  await db.exec('begin;set local role authenticated')
  await db.query("select set_config('request.jwt.claim.sub','e1200000-0000-4000-8000-000000000001',true)")
  await db.query('select public.open_core_quote_revision_atomic($1,$2,null,1,gen_random_uuid())',[legacyCompany,legacyEdit])
  const generatedDraft=(await db.query('select public.get_core_quote_workspace($1,$2) result',[legacyCompany,legacyEdit])).rows[0].result.draft
  await assert.rejects(db.query('select public.update_core_quote_draft_atomic($1,$2,2,gen_random_uuid(),$3::jsonb)',[legacyCompany,legacyEdit,JSON.stringify({...generatedDraft,pricing_mode:'net',discount_amount:'0.00'})]),e=>e.code==='428C9')
  await db.exec('rollback')
  assert.deepEqual(await legacyState(),legacyBefore);legacyTests.push('hosted_generated_insert_failure_reproduced_and_rolled_back')
  await db.exec('begin;'+await sql('supabase/migrations/20261022052955_respect_generated_quote_item_totals.sql')+'commit;')
  assert.deepEqual(await legacyState(),legacyBefore);legacyTests.push('generated_column_followup_preserves_original_rows')
  await db.exec('begin;'+await sql('supabase/migrations/20261022053147_preserve_public_quote_response_retry.sql')+'commit;')
  assert.deepEqual(await legacyState(),legacyBefore);legacyTests.push('original_business_rows_and_receipts_unchanged')
  const oldRead=(await db.query("select public.get_public_core_quote_version('legacy-edit-token') result")).rows[0].result
  assert.equal(oldRead.kind,'legacy');assert.equal(oldRead.publishedAt,null);assert.equal(oldRead.document.version_id,null);assert.equal(oldRead.document.version_number,null);legacyTests.push('legacy_not_claimed_as_issued_history')
  assert.equal(oldRead.document.customer_identity_state,'legacy_unknown');assert.deepEqual(oldRead.document.customer,{name:null});assert.equal(oldRead.document.pricing_mode,null);assert.equal(oldRead.document.discount_amount,null);assert.equal(oldRead.document.items[0].total_price,'5.00');legacyTests.push('unknown_identity_pricing_and_generated_total_preserved')
  await db.exec(`select set_config('request.jwt.claim.sub','e1200000-0000-4000-8000-000000000006',false);set role authenticated`)
  const portalList=(await db.query('select public.list_portal_core_quote_versions($1,$2) result',[legacyCompany,'e1200000-0000-4000-8000-000000000004'])).rows[0].result
  assert.equal(portalList.length,2);assert.ok(portalList.every(x=>x.kind==='legacy'&&x.document.version_id===null));legacyTests.push('portal_keeps_legacy_publications_but_not_unpublished_drafts')
  const portalLegacy=(await db.query('select public.get_portal_core_quote_version($1,$2,$3,null) result',[legacyCompany,'e1200000-0000-4000-8000-000000000004',legacyEdit])).rows[0].result
  assert.deepEqual(portalLegacy,portalList.find(x=>x.document.quote_id===legacyEdit));legacyTests.push('portal_explicit_null_is_exact_legacy_document')
  await assert.rejects(db.query('select public.get_portal_core_quote_version($1,$2,$3,null)',[legacyCompany,'e1200000-0000-4000-8000-000000000099',legacyEdit]),e=>e.code==='42501');legacyTests.push('legacy_portal_customer_boundary')
  await assert.rejects(db.query('select public.respond_portal_core_quote_version($1,$2,$3,null,gen_random_uuid(),$4::jsonb)',[legacyCompany,'e1200000-0000-4000-8000-000000000004',legacyEdit,JSON.stringify({decision:'accepted',evidence:'Cannot accept an unknown legacy version'})]),e=>e.code==='P0002');legacyTests.push('legacy_portal_cannot_assert_acceptance')
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','e1200000-0000-4000-8000-000000000001',false);set role authenticated`)
  const replay=(await db.query('select public.convert_core_quote_to_job_atomic($1,$2,$3,$4::jsonb) result',[legacyCompany,legacyQuote,legacyOperation,JSON.stringify(legacyPlan)])).rows[0].result
  assert.deepEqual(replay,{...legacyConversion,created:false});legacyTests.push('original_c01_receipt_replay_unchanged')
  await assert.rejects(db.query('select public.convert_core_quote_to_job_atomic($1,$2,gen_random_uuid(),$3::jsonb)',[legacyCompany,legacyQuote,JSON.stringify(legacyPlan)]),e=>e.code==='PT409'&&e.message==='CORE_QUOTE_VERSION_REQUIRED');legacyTests.push('legacy_no_new_operation_alias')
  await assert.rejects(db.query('select public.create_core_quote_from_calculation_atomic($1,$2,1,gen_random_uuid())',[legacyCompany,'e1200000-0000-4000-8000-000000000005']),e=>e.code==='PT409'&&e.message==='CORE_QUOTE_LEGACY_AMBIGUOUS');legacyTests.push('ambiguous_legacy_source_not_guessed')
  await db.query('select public.open_core_quote_revision_atomic($1,$2,null,1,gen_random_uuid())',[legacyCompany,legacyEdit]);legacyTests.push('legacy_explicit_open_before_first_modern_version')
  let draft=(await db.query('select public.get_core_quote_workspace($1,$2) result',[legacyCompany,legacyEdit])).rows[0].result.draft
  assert.equal(draft.pricing_mode,null);assert.equal(draft.discount_amount,null);assert.equal(draft.currency,'EUR');legacyTests.push('legacy_open_does_not_guess_net_discount_or_currency')
  draft={...draft,pricing_mode:'net',discount_amount:'0.00'}
  await db.query('select public.update_core_quote_draft_atomic($1,$2,2,gen_random_uuid(),$3::jsonb)',[legacyCompany,legacyEdit,JSON.stringify(draft)])
  const publication=(await db.query('select public.publish_core_quote_version_atomic($1,$2,3,gen_random_uuid()) result',[legacyCompany,legacyEdit])).rows[0].result
  const modern=(await db.query('select public.get_core_quote_version($1,$2,$3) result',[legacyCompany,legacyEdit,publication.versionId])).rows[0].result
  assert.equal(modern.document.currency,'EUR');assert.equal(modern.document.customer_identity_state,'legacy_unknown');assert.equal(modern.document.customer.name,null);legacyTests.push('modern_revision_preserves_unknown_customer_and_eur')
  const beforeLegacyAttempt=(await db.query('select public.get_core_quote_workspace($1,$2) result',[legacyCompany,legacyEdit])).rows[0].result
  await assert.rejects(db.query('select public.open_core_quote_revision_atomic($1,$2,null,4,gen_random_uuid())',[legacyCompany,legacyEdit]),e=>e.code==='PT409'&&e.message==='CORE_QUOTE_VERSION_CONFLICT')
  assert.deepEqual((await db.query('select public.get_core_quote_workspace($1,$2) result',[legacyCompany,legacyEdit])).rows[0].result,beforeLegacyAttempt);legacyTests.push('legacy_open_after_modern_fails_without_change')
  await db.exec('reset role')
  await db.query('update public.companies set name=$1 where id=$2',['New company identity',legacyCompany]);await db.query('update public.customers set name=$1,billing_street=$2 where company_id=$3',['New customer identity','New address',legacyCompany])
  assert.deepEqual((await db.query("select public.get_public_core_quote_version('legacy-edit-token') result")).rows[0].result,oldRead);legacyTests.push('legacy_token_stays_pinned_after_new_version_and_company_edit')
  await db.exec('set role authenticated')
  await db.query('select public.revoke_core_quote_publication_atomic($1,$2,null,4,gen_random_uuid())',[legacyCompany,legacyEdit])
  assert.equal((await db.query("select public.get_public_core_quote_version('legacy-edit-token') result")).rows[0].result,null)
  assert.equal((await db.query('select public.get_public_core_quote_version($1) result',[publication.shareToken])).rows[0].result.document.version_id,publication.versionId)
  legacyTests.push('legacy_revocation_does_not_revoke_modern_token')
  assert.ok((await db.query('select public.get_core_quote_workspace($1,$2) result',[legacyCompany,legacyEdit])).rows[0].result.legacy.revokedAt);legacyTests.push('legacy_revocation_marker_visible_after_reload')
  assert.equal((await db.query('select public.get_core_quote_version($1,$2,null) result',[legacyCompany,legacyEdit])).rows[0].result.kind,'legacy');legacyTests.push('revoked_legacy_retains_authorized_history')
  await db.exec('reset role')
  // Only the database owner can create a narrowly scoped permit for this tombstone fixture.
  await db.exec('begin')
  await db.query('insert into private.core_quote_write_permits values($1,$2,pg_current_xact_id())',[legacyCompany,legacyQuote])
  await db.query('delete from public.quotes where id=$1',[legacyQuote])
  await db.query('delete from private.core_quote_write_permits where quote_id=$1',[legacyQuote])
  await db.exec('commit;set role authenticated')
  await assert.rejects(db.query('select public.convert_core_quote_to_job_atomic($1,$2,$3,$4::jsonb)',[legacyCompany,legacyQuote,legacyOperation,JSON.stringify(legacyPlan)]),e=>e.code==='PT409'&&e.message==='CORE_QUOTE_RESULT_MISSING');legacyTests.push('owner_only_tombstone_never_recreates_tree')
  await db.exec('reset role')

  const reports=await db.exec(await sql('supabase/tests/core-quote-lifecycle.sql'))
  const result=reports.at(-1)?.rows[0]?.result
  assert.equal(result?.fixtures,'rolled_back')
  assert.equal(result.count,115);assert.equal(result.cleanup_assertions,5)
  console.log(JSON.stringify({runtime:'PGlite',...result,legacy_migration_count:legacyTests.length,legacy_migration_tests:legacyTests},null,2))
} catch(error) {console.error(JSON.stringify({message:error.message,code:error.code,where:error.where,detail:error.detail,position:error.position}));process.exitCode=1}
finally {await db.close()}
