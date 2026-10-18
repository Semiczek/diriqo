# Calendar C06-03 database preflight, 18 October 2026

## Read-only hosted evidence

The Supabase connector queried only schema metadata and aggregate counts in project `wfcpfraxiuhuglnuaxqj`. No customer row values, SQL mutation, fixture, migration, account change or deployment was performed by this preflight.

| Check | Observed result |
| --- | --- |
| `calendar_events` / `calendar_event_assignments` | 4 / 4 rows |
| Conflicting time aliases / partially populated time aliases | 0 / 0 |
| Missing event times / invalid end-before-start ranges | 0 / 0 |
| Conflicting event aliases / partially populated event aliases | 0 / 0 |
| Orphan assignments or wrong assignment company | 0 |
| Duplicate logical event/profile assignments | 0 |
| Event linked to a job from another company | 0 |
| RLS | Enabled on both tables; not FORCE RLS |
| Non-internal triggers or calendar-related stored functions | None |

The live event schema has `id`, `company_id`, `title`, `created_at`, `updated_at` as non-null columns, and nullable `job_id`, `description`, `location`, `start_at`, `end_at`, `starts_at`, `ends_at`. It has no revision. Assignments have non-null `id`, `company_id`, `profile_id`, `created_at`, with nullable `event_id` and `calendar_event_id`. This differs from the nullable assignment company in the repository bootstrap; the local runner explicitly uses the observed non-null column.

Event foreign keys delete with the company and set `job_id` to NULL when the job is deleted. Both assignment event aliases, the company and profile have cascading foreign keys. Assignment uniqueness is enforced separately for `(calendar_event_id,profile_id)` and for `(event_id,profile_id)` when `event_id` is present; it does not provide a single logical alias key.

Events have member SELECT and administrator ALL RLS policies. Assignments have no RLS policy. `authenticated` nevertheless has table SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER privileges; `service_role` has TRUNCATE/REFERENCES/TRIGGER. Effective column grants were inspected as well. No calendar RPC or trigger was found that must be preserved or redirected.

The root agent captured a targeted pre-migration backup at **2026-10-18 19:27:35 UTC**, containing these 4 event rows, 4 assignment rows and their schema/ACL/RLS metadata. Its private managed artifact is `artifacts/calendar/pre-migration-backup-20261018.json`, SHA-256 `f359d003580f328226577ce7e390b9568834c010d0696978148c8e7d732335d1`. This is a targeted recovery artifact, **not a complete database restore point**. Recheck its hash and obtain a fresh matching snapshot before applying the migration if intervening writes occurred. Raw contents remain private.

## Prepared migration and authority

`supabase/migrations/20261018192055_atomic_calendar_event_edits.sql` was created using `supabase migration new atomic_calendar_event_edits` (CLI 2.120.0), then edited locally. The skill-required changelog fetch was unavailable in this execution environment; current official database-function documentation was consulted through Supabase `search_docs`. No Supabase dependency or CLI version was changed.

The migration takes bounded schema locks, rejects conflicting aliases, wrong-company/orphan assignments and duplicate logical assignments, and adds revision/alias checks and a logical unique index. It performs no historical backfill or deletion. A retained assignment keeps its original ID and creation time; a normal edit may fill a missing counterpart alias. Existing conflicting aliases require an explicit reconciliation before either migration or mutation.

Only current active `company_admin`/`super_admin` members with an active profile and matching `auth.uid()` may call the four calendar RPCs. Explicit company and event parameters remain mandatory. The application additionally uses `getUser()` and its active-company guard; the database does not trust a browser cookie as authority. Ordinary active members retain the existing event-history SELECT policy. Direct assignment reads and writes are revoked; an administrator receives the assignment set through the scoped snapshot RPC. Anonymous and service-role API execution is revoked. Privileged owner maintenance remains outside these application grants.

Public functions are invoker wrappers around narrow private definer functions with an empty search path. Other private helpers are not executable by API roles. Create/update/delete replace the header and assignment set within one transaction. The capability is `core.calendar.manage`, using the existing legacy/paid/test evaluator plus the calendar module setting. A fresh final check follows all DML and potential waits; the selected paid/test source is locked and revalidated using current time. License expiry or module disable does not prevent the administrator from reading retained history.

`revision` is a bigint serialized as a decimal string. Header and assignment triggers also cover existing job `ON DELETE SET NULL` and profile `ON DELETE CASCADE` writers. It is an opaque monotonic token: one atomic edit can increase it several times. An actual no-op leaves the token unchanged, but still checks the expected revision and current write authority. A stale token raises `CALENDAR_STALE` / **PT409**, not retryable SQLSTATE 40001. A missing/deleted event raises `CALENDAR_NOT_FOUND` rather than reporting success. Referenced job/profile locks precede assignment locks and the header lock; assignments are locked in ID order. PostgreSQL may still abort more complex owner/FK deadlocks atomically; such errors are not evidence of a successful mutation and must not cause a blind client retry.

## Local verification and remaining proof

`scripts/test-calendar-events-sql.mjs` uses an existing **PGlite 0.5.9** runtime selected explicitly through `PGLITE_MODULE`. It makes no network call, reads no credentials and installs nothing. It executes the actual calendar migration, shared capability evaluator, test-grant constraints and immutable grant trigger, with an explicitly simplified Auth/Core/paid-receipt baseline. The calendar table baseline matches the observed aliases and non-null assignment company. This does not reproduce every hosted constraint, Auth trigger or provider setting.

Result: **66 contract cases passed**, **4 fixture cleanup assertions passed**, and the migration refused a deliberately conflicting old alias without rewriting it. Cases cover complete snapshots, header/assignment creation and editing, no-ops, stale PT409, direct DML/helper/RPC permissions, role/company isolation, inactive membership/profile, validation, late create/update/delete failure rollback, retained assignment IDs, legacy aliases, disabled/revoked/expired license behavior, final authorization after DML, job FK revision changes and profile cascade revision changes. All synthetic fixtures rolled back. The final-authorization cases inject changes inside a test-only trigger; they prove guard placement, not concurrent session behavior.

An additional **12 local paid-selection cases and 2 cleanup assertions passed** in `supabase/tests/calendar-events-local-paid.sql`. That file is explicitly restricted to the simplified local receipt table and must not run on hosted Supabase. It covers an eligible paid row and rejection of revoked, expired, not-yet-valid, wrong-product, wrong-register, wrong-capability, wrong-policy, wrong-mode, wrong-origin, inactive-state and wrong-company rows; rejected writes preserve readable history. These synthetic rows test the actual shared evaluator and calendar paid branch. They do not satisfy the real payment ledger's immutable provenance rules, prove a provider payment, or demonstrate a separate-session paid-receipt lock barrier.

Reproduce with an existing reviewed runtime:

```powershell
$env:PGLITE_MODULE = 'C:/absolute/path/to/@electric-sql/pglite/dist/index.js'
node scripts/test-calendar-events-sql.mjs
```

This is **local SQL proof only**. The migration has not been applied by this task, and no authenticated HTTP overlap or deployed UI check has run. C06-03 must not be marked complete solely from this suite. It still requires two real authenticated sessions moving the same event from one revision, one complete winner and one 409, no mixed assignment set, and two browser sessions showing the recoverable conflict while preserving the unsaved draft. Lock-wait revocation/expiry needs separate-session barriers. Paid receipt integration requires the real payment-authority baseline; the local test does not create or certify a provider payment.

Coordinate the migration and RPC application release: revoking direct writes deliberately makes older calendar writers fail closed. Before application, freeze/review the exact migration bytes, recheck live schema/counts and backup hashes, and prepare the forward-repair/read-only fallback described in `calendar-atomic-edits-20261018.md`. Do not restore an old snapshot over newer customer writes or re-enable the split non-atomic write path as a routine rollback.
