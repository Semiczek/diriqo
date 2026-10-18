# Worker advances: preflight, 18 October 2026

Target: Diriqo test Supabase `wfcpfraxiuhuglnuaxqj` only. Read-only metadata and aggregate queries were executed before changing the local migration. No live schema, settings or financial rows were modified by this preflight.

## Observed state

| Check | Result |
| --- | --- |
| Company canonical/legacy enablement, pay-type or payday disagreement | 0 rows |
| Legacy global profile advance overrides | 0 profiles |
| Company-scoped worker settings | 6 rows, all active |
| Explicit company-scoped worker advance enable/disable overrides | 0 |
| Explicit company-scoped worker amount overrides | 0 |
| Existing payment ledger | 0 rows |
| Existing payment rows with unknown payroll month | 0 |
| Existing worker payday overrides / legacy custom profile payday | 0 / 0 |
| Company settings without a payday in either alias | 2 |

The live advance-frequency CHECK permits `anytime`, `weekly`, `monthly`, unlike the old migration file's canonical list. The new migration extends validation to `anytime`, `per_shift`, `weekly`, `biweekly`, `monthly` without rewriting existing rows. `anytime` remains readable as legacy data.

These observations are a point-in-time preflight, not a guarantee that settings remain unchanged before application. Re-run the query before applying; report and retain explicit existing choices if conflicts appear rather than overwriting them by precedence alone.

## Approved authority and period semantics

- Existing `company_payroll_settings` rows are authoritative. `advances_enabled=false` stays false; `advance_limit_amount=NULL` means no amount limit. Defaults apply only when the company row is absent.
- Active `worker_payment_settings(company_id, profile_id)` supplies scoped overrides. A NULL override inherits the company value. Global `profiles` advance overrides do not authorize or limit another company's financial operations.
- Request and payout RPCs use the same private policy resolver. Exact retries return existing evidence after fresh role checks even when new operations are disabled.
- New payment `payroll_month` is the first day of the calendar month containing the explicit `issued_at` date. It is independent of the configured payday.
- Existing non-NULL `payroll_month` is retained exactly, including historical assignment to another calendar month. Unknown or malformed legacy assignment is not inferred from dates: new payouts for that worker require reconciliation first. Reads retain the original record.
- The configurable monthly payday is a planned date in the following month, clamped to that month's last day. NULL means not configured. The shared application implementation owns this display/settings behavior; the payment ledger never calculates a transfer or payroll deduction from it.

## Re-runnable conflict and metadata query

```sql
select jsonb_build_object(
  'company_conflicts', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'company_id', s.company_id,
      'canonical_enabled', s.advances_enabled, 'legacy_enabled', s.allow_advances,
      'canonical_pay_type', s.default_pay_type, 'legacy_pay_type', s.payroll_type,
      'canonical_day', s.payday_day, 'legacy_day', s.payroll_day_of_month
    )), '[]'::jsonb)
    from public.company_payroll_settings s
    where s.advances_enabled is distinct from s.allow_advances
       or s.default_pay_type is distinct from
          case when s.payroll_type='shift' then 'after_shift' else s.payroll_type end
       or s.payday_day is distinct from s.payroll_day_of_month
       or s.payday_weekday is distinct from s.payroll_weekday
  ),
  'legacy_profile_overrides', (
    select count(*) from public.profiles
    where allow_advances_override is not null or advance_limit_amount_override is not null
  ),
  'worker_settings', (
    select jsonb_build_object('rows', count(*),
      'enabled_false', count(*) filter(where advances_enabled_override=false),
      'enabled_true', count(*) filter(where advances_enabled_override=true),
      'amount_override', count(advance_limit_amount_override),
      'inactive_rows', count(*) filter(where not is_active))
    from public.worker_payment_settings
  ),
  'ledger', (
    select jsonb_build_object('rows', count(*),
      'unknown_month', count(*) filter(where payroll_month is null))
    from public.worker_advances
  )
);
```

## Proof boundaries

The SQL regression suite is rollback-only and exercises PostgreSQL roles, RLS and complete financial-state snapshots. Local PGlite runs use an explicitly simplified baseline and a capability evaluator stub; they do not prove live grants, deployed behavior or concurrent transaction overlap. Actual authenticated HTTP races require the reviewed fixture-driven harness plus separate owner-session database lock evidence. No production financial readiness claim follows from the local checks alone.

## Worker request reauthorization barrier (prepared, not executed)

`scripts/test-worker-advance-request-reauthorization.mjs` uses an actual worker Auth account as the RPC caller and a separate synthetic company administrator only for read-only before/after financial snapshots. It deliberately does not change memberships, grants or database settings. The owner must prepare each fixture and collect the lock proof separately. Run four fresh cases: settings/revoke, company/revoke, settings/expiry, company/expiry. Both tenants must have the required synthetic names and visible request history; the new request UUID must be absent.

Hold one of these row locks in a dedicated owner connection before starting the harness. Substitute only the exact synthetic fixture company UUID. Keep the same connection open until the request backend is observed waiting; a one-shot SQL tool cannot preserve this transaction across independent calls.

```sql
begin;
-- Choose exactly one barrier for this run:
select company_id from public.company_payroll_settings
where company_id = '<synthetic-company-uuid>'::uuid for update;
-- OR:
select id from public.companies
where id = '<synthetic-company-uuid>'::uuid for update;
select pg_backend_pid() as barrier_pid, clock_timestamp() as barrier_started_at;
```

In a separate owner connection, record `pg_stat_activity` and `pg_blocking_pids(pid)` showing the authenticated worker's `request_advance_atomic` backend waiting on this exact barrier PID. Include the fixture request UUID, barrier table, observed timestamp and release timestamp in the evidence. Prove the wait before changing authorization; an error after revocation without this ordering only tests an already-revoked user.

- For revoke: after observing the wait, deactivate only this synthetic worker's membership in this synthetic company using a separate committed owner transaction. Release the barrier with `rollback`. The queued worker call must return `ADVANCE_FORBIDDEN`.
- For expiry: before the run, provide a short-lived, enforced nonfinancial test grant with no alternative active entitlement. Store its exact `valid_until` in the private fixture. Initial worker capability must be allowed with reason `test`. Observe the wait before expiry, let wall-clock time pass `valid_until`, then release the barrier with `rollback`. The queued call must return `ADVANCE_MODULE_REQUIRED`. Do not attempt grant revocation during this scenario: the first capability evaluation intentionally holds grant share locks.

Keep the wait shorter than the deployed authenticated statement timeout. A statement timeout, transport error or missing owner lock evidence is not a passing reauthorization test. The harness preserves the request UUID before the call, checks that the request remains absent, and requires identical full financial-state fingerprints in the target and control tenants through the unaffected observer account. The result's `databaseOverlapEvidence` remains `REQUIRED_SEPARATE_OWNER_LOCK_BARRIER`; its assertion result alone does not certify concurrency. Owner-managed synthetic fixtures and membership changes must be reconciled after verification.

The local final SQL run contains 75 scenario entries plus five rollback cleanup assertions, including new-request and exact-retry rejection after worker membership revocation. The in-flight lock cases above remain unexecuted until root review and authorized test migration application.
