-- OWNER-ONLY OPERATION; separate from the schema migration.
-- Explicit user-approved scope: Diriqo Demo s.r.o. only.
-- No Stripe calls, orders, paid entitlements, credits or provider events.
-- POS register UUID below is ONLY a test licence scope, not a provisioned device.
-- Idempotent: rerunning this source does not extend or replace an existing grant.
-- The schema and rollback regression tests must pass before executing COMMIT.
begin;
do $activation$
declare
  v_company constant uuid := '10000000-0000-4000-8000-000000000001';
  v_source constant text := 'manual-test:demo-all-modules:2026-10-10';
  v_register constant uuid := 'd3110000-0000-4000-8000-000000000001';
  v_from timestamptz := clock_timestamp();
  v_row record;
  v_existing private.company_test_module_grants%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('test-module-activation:'||v_company::text,0));
  if not exists(select 1 from public.companies where id=v_company and name='Diriqo Demo s.r.o.') then
    raise exception 'DEMO_TEST_COMPANY_MISMATCH';
  end if;
  if exists(select 1 from public.company_module_entitlements where company_id=v_company and livemode) then
    raise exception 'DEMO_TEST_LIVE_ENTITLEMENT_CONFLICT';
  end if;
  for v_row in select * from (values
      ('diriqo_core',array['core.jobs.create','core.jobs.update','core.jobs.close','core.customers.manage','core.workers.manage','core.rates.manage','core.time.record','core.time.approve','core.quotes.create','core.calendar.manage','core.absences.request','core.absences.approve','core.advances.request','core.advances.pay','core.files.upload','core.handover.confirm','core.costs.record','core.economics.read','core.history.read','core.history.export']::text[]),
      ('inventory',array['inventory.receipt.post','inventory.movement.post','inventory.ocr.request','inventory.history.read','inventory.history.export']::text[]),
      ('invoicing',array['invoicing.invoice.issue','invoicing.ocr.request','invoicing.payment.settle','invoicing.history.read','invoicing.history.export']::text[]),
      ('smart_quotes',array['smart_quotes.template.manage','smart_quotes.ocr.request','smart_quotes.history.read','smart_quotes.history.export']::text[]),
      ('fleet',array['fleet.vehicle.manage','fleet.trip.record','fleet.history.read','fleet.history.export']::text[]),
      ('ai_assistant',array['ai_assistant.conversation.run','ai_assistant.history.read','ai_assistant.history.export']::text[]),
      ('pos',array['pos.sale.create','pos.sale.settle','pos.catalog.manage','pos.shift.close','pos.shift.manage','pos.offline_cash.sell','pos.open_account.manage','pos.kitchen.send','pos.history.read','pos.history.export']::text[])
    ) desired(product,capabilities)
  loop
    insert into private.company_test_module_grants(
      company_id,product,register_id,source_ref,reason,valid_from,valid_until,history_until,capabilities
    ) values (
      v_company,v_row.product,case when v_row.product='pos' then v_register else null end,
      v_source,'User requested all modules for this demo company without any payment. POS scope is a licence placeholder; unfinished applications and AI/OCR budgets are not supplied.',
      v_from,v_from+interval '720 hours',v_from+interval '720 hours',v_row.capabilities
    ) on conflict (company_id,source_ref,product,register_id) do nothing;
    select * into strict v_existing from private.company_test_module_grants
      where company_id=v_company and source_ref=v_source and product=v_row.product
        and register_id is not distinct from case when v_row.product='pos' then v_register else null end;
    if v_existing.origin<>'manual_grant' or v_existing.livemode or v_existing.state<>'active'
      or v_existing.policy_version<>'diriqo-capabilities-v0.1'
      or v_existing.capabilities is distinct from v_row.capabilities
      or v_existing.revoked_at is not null then
      raise exception 'DEMO_TEST_GRANT_REPLAY_CONFLICT';
    end if;
  end loop;
  if (select count(*) from private.company_test_module_grants where company_id=v_company and source_ref=v_source)<>7 then
    raise exception 'DEMO_TEST_GRANT_COUNT_INVALID';
  end if;
  insert into private.company_module_rollouts(company_id,product,livemode)
    select v_company,product,false from unnest(array['diriqo_core','inventory','invoicing','smart_quotes','fleet']) product
    on conflict (company_id,product) do nothing;
  if (select count(*) from private.company_module_rollouts where company_id=v_company and not livemode
    and product in ('diriqo_core','inventory','invoicing','smart_quotes','fleet'))<>5 then
    raise exception 'DEMO_TEST_ROLLOUT_INVALID';
  end if;
end;
$activation$;
select product,register_id,origin,livemode,valid_from,valid_until,cardinality(capabilities) as capability_count,revoked_at
from private.company_test_module_grants
where company_id='10000000-0000-4000-8000-000000000001'
  and source_ref='manual-test:demo-all-modules:2026-10-10'
order by product;
commit;
