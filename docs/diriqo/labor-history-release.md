# Labor history and job economics — release evidence

Status: **NOT DONE / TEST DATABASE APPLIED / DRAFT PR #44 / APPLICATION NOT DEPLOYED**. This report covers the additive database foundation and draft application integration on codex/diriqo-labor-history, based on 0a987c75f8272c33d24bfbd7748b2f8d78806682. PR #44 is open and draft: https://github.com/Semiczek/diriqo/pull/44. The foundation is committed as 9e969e8; the separate test-runtime audit is committed as 6cf8baa. Both reviewed migrations are applied only to authorized Diriqo test project wfcpfraxiuhuglnuaxqj. The application is not deployed. Legacy remuneration readers, further concurrency gates and authenticated user acceptance remain open. No original acceptance scenario is closed by this draft.


## Atomic assignment recovery checkpoint (2026-10-24, local only)

The root/child assignment endpoint now calls one authorized PostgreSQL
transaction for POST, PUT and DELETE. It validates the complete command,
locks workers in stable order, checks the full hierarchy/source snapshot again
after waiting, preserves archive/reset metadata, and stores the applied result
with the source changes. A later failure rolls back the entire batch.

The real job form loads source rows and their version together, persists the
exact pending command in sessionStorage before sending, and accepts only a
complete company/actor/job/operation-matching receipt. Lost or malformed responses
keep further changes blocked. Receipt lookup and exact replay retain the same
operation identity. A stale retry has an explicit safe exit: PATCH requests a
terminal cancellation serialized by the same operation lock. An already applied
operation returns its original result; an unapplied one receives a cancellation
marker that prevents a delayed original request from writing later. Cancellation
and receipt lookup still require current company-administrator authority, but
work after licence expiry or deletion of the original job.

Verified cancellation preserves the user's edits and reloads a fresh workspace
before enabling new writes. An uncertain cancellation does not discard the
original command. The page is keyed by company, actor, role and job; a
same-context refresh preserves drafts, and a changed context remounts the form.
The interface uses the established purple palette and Czech/English/German text.

Local validation at this checkpoint:

- Full application regression: **3,124/3,124 tests in 112 files PASS**, zero skips.
- The five focused API/parser/React/SQL files: **184 tests** included above;
  the final React subset contains **43 tests**.
- Mandatory actual PGlite 0.5.9 SQL: **73 checks**, **65 captured error responses**,
  **14 actual DTOs** passed through production parsers, and **6 rollback cleanup
  assertions**. The SQL/parser contract file has **18 tests**. These 73 SQL checks
  are not the original 73 product acceptance scenarios.
- SQL checks cover late failure rollback, source protection, authorization,
  stale scope and exact replay, plus both sequential cancellation orderings,
  cancellation after job deletion/expiry and mismatched command rejection.
  No genuine simultaneous multi-connection execution is claimed for PGlite.
- Full TypeScript passed. Full ESLint has zero errors and the same three existing
  navigation warnings. Next 16.4.2 production build passed (108/108 pages,
  4.5-second compilation, 5.1-second build TypeScript) with nonfunctional
  Supabase configuration. Independent scoped reviews found no remaining
  concrete issue in the recovery hook and cancellation/API outcome boundary.

New migration: `20261024120344_atomic_job_assignment_batch.sql`,
SHA-256 `b49d1867731851a97361ea2d4dafeb10aeb1aa27286257dd54464c3949de1398`.
**It has not been applied to the hosted test database. This batch is not
application-deployed.** The two previously applied migrations and their protected
test/evidence sources remain byte-identical.

Before applying/accepting this new batch, capture current schema/data preservation,
review and apply it only to the authorized Diriqo test project, then verify real
concurrent writes/cancellation, hierarchy changes and authorization loss while
waiting. Existing mobile/direct-DML grants and reversed lock acquisition remain
separate open gates. The four remuneration readers, authenticated UI flows and
complete financial acceptance still need completion. PR #44 stays draft and
unmerged. Original product acceptance remains **8 HOTOVO / 46 CASTECNE /
3 CHYBA / 11 CHYBI / 5 NEOVERENO**; no scenario is promoted by this checkpoint.

## Legacy editor and source-row checkpoint (2026-10-24)

The legacy shift editor now pins the authenticated administrator and active
company at render and action time. An approved source is protected and offers
an authorized link to its current submission, including the shift/log alias.
The labor workspace validates all link scope and opens the matching review;
a correction still requires an explicit user action and approval.

Both single and actual batch assignment routes map the database's immutable
approved-source error to HTTP 409 with a scoped review link. The client retains
its draft and refuses foreign or malformed destinations. A propagated batch
conflict opens the worker's submissions instead of guessing the affected child.
RLS-filtered zero-row mutations in the single route/editor are not successes.
An explicit reset writes zero compatible with the live NOT NULL constraint;
archiving preserves recorded hours, interval, rate and cost.

The actual worker-detail editor now handles all three entry points: Save,
reset and archive. The page supplies company/actor/worker identity; Save and
PATCH reauthorize and reject a changed company/account before writing. Save
filters the exact assignment, company, job and worker, and a zero-row update
is not success. Protected responses show only an exact validated local review
link. Foreign/malformed links are rejected, failed requests retain the draft,
and a response from an old account cannot update a remounted editor. Text is
localized in Czech, English and German. The final worker-flow slice passed
70 targeted tests and an independent static review; those tests are included
in the combined count below. No authenticated browser acceptance is claimed.

Job-detail rows no longer claim a stored legacy rate is an approved cost.
Recorded source hours distinguish missing evidence from explicit zero, and
row cost is shown as unverified with a review link. Canonical job totals are
unchanged. Blank UI input is not silently converted to zero. The batch API
also validates all POST/PUT numeric fields before writes: hourly work requires
hours/rate, fixed or invoice billing requires an external amount, explicit zero
is valid, and absent optional hourly values are omitted to preserve existing
values and respect the live NOT NULL DEFAULT 0 columns. Direct numeric overflow,
sub-cent inputs, invalid billing types and a malformed later PUT row are rejected.
The shift editor also rejects negative/nonfinite hours and reversed intervals.

Combined local application regression: **3,003/3,003 tests in 109 files PASS**,
zero skipped. The tests include actual React interaction/server action/API
handlers with mocked authorization/data boundaries and the mandatory real local
SQL regression. TypeScript passed. Full lint has zero errors and the same three
pre-existing navigation warnings. Required Office contracts: **62 passed,
0 failed, 1 explicitly skipped** (its older optional PGlite 0.5.8 runtime test
was not enabled); this is not a new complete Office database acceptance claim.
The production build also passed: Next 16.4.2 compilation 9.2 seconds, build
TypeScript 48 seconds and 108/108 generated pages, using deliberately
nonfunctional Supabase build configuration. This is compile/SSR evidence, not
an authenticated UI or hosted API test.

Remote CI after the audit fix passed at commit 6cf8baa9ac6e4ac45f84d72615213da5f7e75f8c:
[CI run 40084031775](https://github.com/Semiczek/diriqo/actions/runs/40084031775)
and [Office run 40084031807](https://github.com/Semiczek/diriqo/actions/runs/40084031807).
That commit precedes the UI slice described here. Read the checks on the final
UI commit in PR #44; these earlier run IDs are not proof for later UI changes.

The original GitHub run 40082418393 failed before dependency installation because
the new test runtime had no separate host dependency audit. The reviewed audit
and 23 retained component-notice entries are now in
`docs/diriqo/labor-test-runtime-dependencies.md` and linked vendor evidence.
The unchanged Office/package gate passes. The prior failed run remains evidence
of its own version, not a passing result.

**At that earlier checkpoint:** the existing root/child assignment batch used multiple database
statements. Input preflight prevents malformed later inputs from creating an
earlier write, but a later database/auth failure can still leave a partial batch.
This requires an atomic database operation and real rollback/concurrency tests
before release. The next operation must preserve archive/reset metadata, validate
the complete input, lock workers in stable order before source rows, recheck
authorization and hierarchy after waits, and keep a scoped receipt so retrying
a lost response cannot repeat the effect. Inspect the existing mobile/direct
DML paths separately: source-row-first locking can conflict with review's
worker-first order. A new batch RPC alone does not close that system-wide gate. The four remuneration readers/exports, actual source-write vs
approval, blocked revocation, rate-first ordering and authenticated UI remain
open. No data or schema mutation was performed for this UI checkpoint;
read-only test-schema queries confirmed numeric(12,2), nullability, defaults
and the existing approved-assignment protection trigger.

## Final application draft verification (2026-10-24)

The final local application suite passed **2,857/2,857 tests across 102 files with zero skips**, using the pinned PGlite runtime without PGLITE_MODULE or LABOR_SQL_EVIDENCE overrides. Full TypeScript passed. Full ESLint passed with zero errors and three pre-existing no-location-assign warnings (SignUpForm.tsx:164/232 and DashboardShell.tsx:275). The production Next 16.4.2 build passed: compilation 10.6 seconds, build TypeScript 21.7 seconds, **108/108 pages**, including /labor and /workers/[workerId]/rates. These are local results, not GitHub CI or deployed-browser acceptance.

The draft introduces rate history and time-review screens, server-authenticated canonical job-cost reads, complete paginated financial reads, explicit unknown/mixed-currency totals, and no provisional cost added to approved cost. Confirmed conflicts can be recovered only after explicit refresh and fresh server data, preserving drafts; uncertain requests retain their original command identity. React regressions failed before both rate and source-change recovery fixes and now pass. Eight actual dashboard SSR regressions cover parent/child costs across months and company time zones: parent amounts are not copied into every child's month; unallocatable periods are explicitly incomplete.

The PT409 migration postflight is retained privately as artifacts/labor-history/domain-conflict-migration-postflight-20261024.json, SHA-256 **fc7229c2cf30de27f936bd2255ab7baaacd43938b1b24fa2dc2d62097cc3ee4f**. The two function definitions differ only by the eight reviewed SQLSTATE replacements; ACLs and security configuration are preserved, and all nine ledger-table fingerprints match preflight. Security advisor notice kinds/counts were unchanged; this does not resolve older project-wide advisories.

This is a reviewable draft. The next-work list below remains required before merge/deployment; no original acceptance scenario is closed by these local results.

## Change and impact

The CLI-generated migration `20261024083058_labor_history_foundation.sql` adds effective company/worker rate versions, time submissions with versioned review, immutable cost snapshots, audit events, operation receipts and scoped RPCs. Draft → submitted → approved/returned is enforced in the database. A correction retains the former approved amount until the replacement is approved; exactly one approved pointer contributes to current cost. Previous approved versions remain unchanged.

Rates are selected by the actual work date. The worker/company lock serializes rate changes and financial approval. Every mutation pins the authenticated actor, uses a compare-and-swap revision and idempotency key, and rechecks current role/membership after waiting. Explicit zero is a real rate. Legacy zero/default values remain unknown: there is no current-profile backfill or automatic historical approval.

Actual hours, remuneration hours and billed hours are separate. Cost uses remuneration hours. Actual time follows company-zone day bounds, including 23-hour and 25-hour daylight-saving days. Financial snapshots include rate, currency, unit, worker type, billing type, quantity and amount. Foreign currencies are reported separately, never added to the job-currency subtotal. Missing rates and unresolved legacy work keep total_cost null.

Read-only hosted catalog inspection confirmed company_members.role is text NOT NULL with no CHECK value list; no existing unknown roles were found. The RPC member guard therefore explicitly whitelists worker, manager, company_admin and super_admin rather than trusting an arbitrary active membership. Raw unknown-role read and own-write regressions pass. The rollback test checks a NULL denial on nullable fixtures, or the NOT NULL constraint on the current hosted schema.

All eight new public tables and private operation receipts have RLS and no direct client table grants. Authenticated callers receive only scoped RPC access. Company administrators/super administrators receive financial DTOs. Managers can review company time and workers see their own time without financial fields. An expired licence blocks new operations while historical reads remain available to authorized members.

Three source-table triggers protect approved work_shifts, work_logs and job_assignments. An explicitly linked shift is fingerprinted and protected when a log is the claimed source. Unapproved legacy edits remain possible; a changed source invalidates an already captured draft. Exact source claims and explicit shift/log aliases prevent duplicate cost. Unrelated logs and aggregate assignments are not silently discarded merely because a worker also has a shift on the same job. Running shifts/logs and a legacy assignment with a fixed labor_cost or external_amount remain incomplete even when recorded hours are zero; their amount is not promoted to an approved fact.

The canonical read model is `get_job_labor_cost_totals`. Approved and provisional values are separate: provisional_known_cost is the full candidate amount, including a pending correction, not a delta to add to approved_cost. The existing four legacy views are unchanged by this migration. No invoice/revenue SQL is replaced.

The time-only picker `list_labor_source_options` returns scoped source identities, labels, time evidence and an existing submission pointer. Uncertain hours are null; assignment aggregates never invent actual time. Running sources are excluded. More than 2,000 matching rows fails explicitly rather than silently truncating; the caller can select a worker. Pagination for larger individual histories remains future work.

## Verified locally

- PGlite executes the actual migration and actual capability evaluator against synthetic supporting schema aligned to the inspected live numeric(12,2) fields, membership NOT NULL, assignment uniqueness and running-shift partial unique index: **96/96 scenarios passed**, followed by **5 rollback cleanup assertions**.
- The rollback suite captures 26 unmodified real RPC JSON responses. `tests/labor-sql-contract.test.ts` feeds these directly to production TypeScript parsers: **29/29 tests passed**. Coverage includes rate reads/receipts, draft/submit/approve/return, historical revisions, manager/worker redaction, source picker, list responses, complete/provisional/missing/legacy totals and foreign-currency accounting.
- Example: October 8 actual / 8 remuneration / 6 billed hours at 200 = 1,600. A later profile rate of 999 and November effective rate of 250 preserve the October snapshot. A reviewed 7-hour correction changes current cost to 1,400 while the original 1,600 remains in history. November 8 × 250 = 2,000.
- CAS conflicts, identical replay, changed-payload replay, lost roles, tenant/worker/job mismatches, raw missing arrays, unpaired timestamps, missing correction reasons, fixed-cost duplication, source mutation and anonymous/direct-table access are covered.
- Fixture business rows, Auth identities, rates, submissions and operation receipts roll back. No real employee data is used.

The SQL run is single-session offline evidence. Separate hosted rollback and concurrency results are recorded below; local tests do not prove authenticated browser behavior, full payroll integration or physical devices. PGlite **0.5.9 is a pinned required development dependency**, and the SQL/TypeScript contract suite runs normally without an opt-in variable or skip. PGLITE_MODULE remains an optional absolute runtime-path override. LABOR_SQL_EVIDENCE optionally supplies a private captured hosted JSON artifact to the same parser tests; it is not required for the local SQL suite.

Normal local commands:

```powershell
node scripts/test-labor-history-sql.mjs
node node_modules/vitest/vitest.mjs run tests/labor-sql-contract.test.ts
```

The root's initial complete local application checkpoint (before the PT409 follow-up) is **2,847 tests / 101 files PASS**, TypeScript PASS and production build PASS with **108 routes**. Lint reports **0 errors and 3 pre-existing warnings**. This is local evidence; it is not a CI result or a deployed acceptance result.

## Hosted test database evidence (2026-10-24)

The root operator applied the exact reviewed migration body under the observed hosted ledger version **20261024083058**, SHA-256 **47e1c218d8386d6b26165b46c529ceec2cff291d1168383df14dffdde659f43c**. The local filename was aligned to that ledger timestamp without changing any migration bytes.

- Hosted PostgreSQL rollback suite: **96/96 checks + 5 cleanup assertions PASS**. The earlier failed fixture attempt hit the existing one-running-shift-per-worker index and rolled back; fixture identities and the local bootstrap were corrected before the successful rerun. This was a test-data incompatibility, not a change to the migration.
- Hosted catalog: nine new tables including private receipts have RLS and no direct client table grants; ten public wrappers are invoker functions, with no anonymous execution. Existing security warning counts were unchanged. Nine additional informational RLS-without-policy findings are expected for the new RPC-only tables.
- All four original source-table fingerprints were unchanged. The root independently retained the exact original source rows and their schema, functions, views, grants, policies, constraints and triggers before application.
- The 26 actual hosted RPC outputs are saved privately in artifacts/labor-history/hosted-rollback-regression-20261024.json, SHA-256 a2e0ae1a4d89e47f31faaa029a471fca94202cbdd85b5be39d64f1bbf747d173. The root ran these through the same production parsers: **29/29 PASS**.

The recoverable scoped backup is private artifacts/labor-history/pre-migration-source-backup-20261024.json, SHA-256 96d1722a7c1ea398fa7acc777c4102f19c86d434ad3bc553e38bbe5188c1a30b. It contains **61 source rows: profiles 21, work_logs 3, work_shifts 5, job_assignments 32**, plus the captured catalog definitions. Read-only jsonb_populate_recordset roundtrips against the real database row types reproduced all four original MD5 fingerprints. The private backup-roundtrip artifact SHA-256 is 671d9d9b9ab5176e45d3cd38565902379efab4a6027e6709e585f158adfe3fdd. This is a scoped logical preimage with verified typed reconstruction; it is **not a full-project backup or PITR claim** and excludes Auth secrets. No original source rows were changed by this additive migration.

The concurrency procedure is in labor-history-concurrency-plan.md. The pure lock-evidence validator initially passed 73 offline cases and passed **89 offline cases after the OID-validation correction**. Offline preparation also exercised all five generated setups, finalization, all five owner postflight queries and scoped disabling against local PGlite. The barrier observation query compiled and correctly found no two waiting sessions in that single-session environment. These are helper checks, distinct from the subsequent hosted runs below.

## Hosted concurrency checkpoint (2026-10-24)

These are subsequent real Auth/HTTP runs and independent owner checks, separate from the rollback transaction and local helper tests above. Each runner used two distinct synthetic Auth sessions. The original reports are retained as produced; a later offline validator correction does not rewrite a failed runner report into a full pass.

| Scenario | Observed evidence | Checkpoint status |
| --- | --- | --- |
| approve-retry | Both HTTP 200 with the same receipt. The original runner stopped because its OID validator rejected PostgreSQL's canonical numeric-string database OID. Separate offline revalidation proves the exact lock overlap; independent owner checks prove one approval, one receipt and one snapshot of CZK 1,600. | Replay and single committed effect demonstrated by combined evidence; original runner remains failed. |
| rate-retry | Both HTTP 200 with identical receipts, exact database overlap and runner committed-state checks; independent owner postflight confirms one rate/event/receipt/revision increment. | Full HTTP + overlap + owner checks PASS for this scenario. |
| approve-race | Exact database overlap, one HTTP 200 and one committed approval/receipt/snapshot. The losing request reached the client's 55-second timeout without a recorded structured conflict response. | NOT CLOSED: single committed write is proven; losing response/retry behavior is not. |
| rate-conflict | Exact database overlap, one HTTP 200 and one committed rate write matching the winner. The losing request reached the client's 55-second timeout without a recorded structured conflict response. | NOT CLOSED: single committed write is proven; losing response/retry behavior is not. |
| rate-vs-approve | Both HTTP 200; owner postflight confirms the approved CZK 1,600 snapshot remains unchanged after rate 250 exists. The observer returned TWO_EXACT_WAITERS_NOT_OBSERVED. | NOT CLOSED: immutable serial outcome is proven, actual database overlap is not. |

There are three approved snapshots across these synthetic runs, each CZK 1,600 for 8 remuneration hours and 6 billed hours at rate 200. HTTP interval overlap alone is not database overlap proof. The failed observation does not establish whether the MCP calls were serialized; that remains an unverified explanation.

The persistent private artifact artifacts/labor-history/concurrency-http-reports-20261024.json contains all five redacted HTTP reports and the first offline overlap revalidation; SHA-256 292965c3d4d6dc54ff50041fdeaabcecb2ab023f248d28373ee0becf3e6f49f1. Independent committed-state, preservation and cleanup evidence is artifacts/labor-history/concurrency-owner-postconditions-and-cleanup-20261024.json; SHA-256 fe61093a4f25abf9d4269d15328124720a06106e1a6eb6873c1b117eb23d32a5. These are different evidence stages, not interchangeable successful runner outputs.

Owner postflight confirms the original 61 source rows retain all four preflight fingerprints. Cleanup confirms the synthetic Auth identity is banned, its password rotated, and there are zero remaining sessions or active synthetic profiles, memberships or grants. Business/audit history is retained. These consumed run IDs and disabled fixtures must not be reused.

### Unresolved conflict transport diagnosis

The local runner aborts requests after 55 seconds and records transportOrReceiptError without preserving the failing transport phase. The two approximately 55-second failures therefore establish a client timeout, not a verified server retry deadline or root cause. The frozen migration raises SQLSTATE 40001 for deterministic domain conflicts. A PostgREST transaction-retry loop is a plausible explanation: [PostgREST v14.18 uses the transaction runner](https://github.com/PostgREST/postgrest/blob/v14.18/src/PostgREST/MainTx.hs#L89-L94), and the [older hasql transaction implementation retries 40001/40P01 recursively](https://github.com/nikita-volkov/hasql-transaction/blob/2a9a710bd6230cb0abae84f14f852ab14fc3fa85/library/Hasql/Transaction/Private/Sessions.hs#L15-L51). [The upstream fix switches to transactionNoRetry](https://github.com/PostgREST/postgrest/commit/41b86fffa507b752e130539dcd9e1fb00a10cad7), and [PostgREST v16.0 lists the 40001 fix](https://github.com/PostgREST/postgrest/releases/tag/v16.0). The deployed PostgREST version and an actual server retry loop have not been established.

The follow-up is a separate reviewed migration using PT409 for deterministic labor domain conflicts, followed by fresh Auth/HTTP conflict tests. [PostgREST documents PT409 as an explicit HTTP 409 response](https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes). Preserve the applied foundation bytes and real database serialization errors; do not relabel an observed timeout as a successful domain rejection. At this checkpoint the PT409 migration has not been applied.

## PT409 follow-up checkpoint (2026-10-24, after initial concurrency runs)

The root operator applied the reviewed follow-up to the authorized test project wfcpfraxiuhuglnuaxqj. Its actual hosted ledger version is **20261024091643_labor_domain_conflict_status**. The CLI-generated local migration filename was aligned from 20261024091230 to 20261024091643 after observing that ledger entry; its body remains byte-identical, SHA-256 **cf50c9edd15f031bb89496cc6cfb31c91d675567af06f655b1f1b9cf72258b53**. The original foundation remains unchanged at SHA-256 47e1c218d8386d6b26165b46c529ceec2cff291d1168383df14dffdde659f43c.

Only private.labor_sources_validate(c uuid, sid uuid) and private.labor_mutate(c uuid, op text, p jsonb) are replaced. Their eight explicit deterministic domain raises now use PT409. Live definitions exactly match the original bodies with those eight SQLSTATE replacements; function identities, ACLs and security/search_path configuration remain unchanged. All nine ledger-table fingerprints match preflight. No historical business rows are rewritten.

- Local actual SQL regression: **99/99 checks + 5 cleanup assertions PASS**. New checks cover duplicate effective dates, a new draft with the wrong initial revision, and the wrong current version, including absence of partial writes.
- Local production parser/error-mapper contract: **30/30 PASS**, consuming 26 actual RPC DTOs plus 9 actual PT409 errors. Scoped lint and whitespace checks passed.
- Hosted rollback regression after applying PT409: **99/99 checks + 5 cleanup assertions PASS**, producing 26 actual RPC DTOs and 9 PT409 errors. The same production TypeScript parsers/error mapper also passed **30/30 against these actual hosted outputs**. Persistent private evidence: artifacts/labor-history/domain-conflict-hosted-rollback-20261024.json, SHA-256 **c2b78f203fc8d86c5cde8518ffd61de67e5e0ccf79103674fb2df10393e4d967**. This artifact contains 99 SQL checks plus 5 cleanup assertions, 26 RPC DTOs and 9 actual PT409 errors; it is separate from the earlier foundation artifact and the pre-fix concurrency reports.

These results are a new evidence stage. The initial 96/29 foundation proof and pre-fix HTTP reports above remain valid records of their own versions. PT409 application does **not** retroactively close the timed-out approve-race/rate-conflict runs, prove rate-versus-approval database overlap, or establish the original timeout's server-side cause. Fresh Auth/HTTP concurrency runs remain pending. Application changes remain uncommitted and undeployed at this checkpoint; C03-03, C04-03, C10-02 and P17 remain unfulfilled.

## Fresh post-PT409 concurrency checkpoint (2026-10-24)

The root operator completed **all five fresh Auth/HTTP RPC scenarios with exact pg_locks overlap and independent committed-state postconditions PASS**. These invocations used fresh synthetic identities and operation IDs after applying the PT409 follow-up. They are separate from the original five reports; the original failures remain preserved and are not retroactively changed.

| Fresh scenario | Verified result |
| --- | --- |
| approve-retry | Identical requests return the same successful receipt; exact database overlap and owner checks confirm one approval, receipt and snapshot effect. |
| rate-retry | Identical requests return the same successful receipt; exact database overlap and owner checks confirm one rate/event/receipt/revision effect. |
| approve-race | One approval succeeds. The losing request returns HTTP 409 / PT409 in **672 ms**; owner postflight confirms a single committed approval effect. |
| rate-conflict | The amount **260** wins and is the only committed rate. The conflicting payload returns HTTP 409 / PT409 in **631 ms**; no mixed or duplicate rate effect exists. |
| rate-vs-approve | Exact database overlap is proven. The **approval-first** outcome was observed: approval and rate update both succeed, and the approved **CZK 1,600** snapshot remains unchanged after rate 250 exists. The opposite, rate-first ordering is not proven by this run. |

Persistent private evidence: artifacts/labor-history/domain-conflict-concurrency-verified-20261024.json, SHA-256 **5eb441b2ce14be6554d3fc8fe28f894c9db0f4b76cee0c059012a3d37c8a44dd**. The original 61 source-row fingerprints remain unchanged. Final cleanup confirms zero sessions, inactive synthetic profiles/memberships/grants, banned synthetic Auth and rotated passwords. Synthetic business and audit history is retained.

These five successful RPC scenarios close their specific overlap/outcome checks. They do not establish source-PATCH-versus-approval behavior, revocation while waiting, the second rate/approval ordering, deployed browser acceptance, all payroll consumers or commercial readiness. The observed repair is consistent with the suspected 40001 retry issue; a server-side retry loop and the original hosted PostgREST version remain unverified.

**Release decision: prepare a draft PR only. Do not merge or deploy the new labor application path at this checkpoint.** The original 73-scenario registry is unchanged. C03-03, C04-03, C10-02 and P17 are not marked complete by these narrower database/HTTP results.

## Concrete next work before merge/deployment

1. **Reconcile the four remuneration readers with approved time and an independently evidenced remuneration basis.** app/workers/page.tsx:567, app/workers/[workerId]/page.tsx:609, app/api/workers/export/route.ts:364 and app/api/workers/[workerId]/shifts/export/route.ts:194 still derive financial values from legacy shift/assignment hours and present-day profile rates. lib/dal/payroll-readers.ts:56 still reads worker_job_assignment_summary. A ledger correction leaves the original source immutable by design, so these readers otherwise disagree with the canonical job economics. Use one scoped read model for the current approved version, filter individual work_date rows into the calendar work month, preserve actual/pay/billed hours separately, and expose missing historical evidence explicitly. Do not replace cost_amount with netPayout.
2. **Preserve the distinction between employer cost and worker remuneration.** The original input “Diriqo zadání pro Codex”, 10 October 2026, §5 introductory rules (line 300), §5.3 (lines 346–348) and §5.4 (lines 360–366) distinguishes actual/remuneration/billed hours, defines a historical cost rate, and explicitly excludes a legislative payroll calculation from Core. It does not establish cost rate = remuneration rate, gross wage or net wage. Existing profile “default hourly rate” and calculateWorkerPayroll provide no historical proof of that equality. Define a separate company-scoped, effective, explicitly evidenced remuneration basis and immutable calculation/version links; missing basis stays unknown. Preserve the actual paid amount/date and represent a later approved correction as an explicit difference to settle. Current payroll_payments upsert and a paid_at badge do not by themselves reconcile changed approved time. Payday stays a plan for month M+1, not the work-period selector or proof of payment; see docs/worker-advances-c08-implementation-20261018.md. Validate all four readers/exports against the same approved-time cases, distinct cost/remuneration rates, 31 October/1 November split, 8 actual/7.5 remuneration/6 billed hours, explicit zero versus unknown, revisions after payment, worker payday overrides, currencies, and company/role boundaries. Financial readers remain administrator-only; manager/worker time DTOs must not gain cost fields.
3. **Verify the repaired legacy editors and row displays in the real user flow.** The checkpoint above implements protected-source review links, scoped editor actions, truthful unknown row costs and strict numeric input. Confirm administrator/manager/worker visibility, actual protected-source responses and draft preservation after reload in the deployed application. The new atomic assignment batch and terminal cancellation are locally validated above; apply and verify them in the hosted test database and authenticated UI before acceptance. An approved correction must keep the previous amount until approval and then switch the current pointer once.
4. **Complete source-write and authorization concurrency gates.** Collect actual source PATCH/approval lock evidence, including a shift referenced through a log. Direct DML takes a source-row lock before the worker lock; approval takes the worker lock before a source-row lock. A real 40P01/deadlock remains possible and is not repaired by changing deterministic domain conflicts to PT409. Reconcile survivor/victim state, audit, receipts and any retry before accepting the flow. Test role/membership/module revocation during a wait and the rate-first stale-preview outcome with separately identified evidence. Do not reuse consumed fixtures or interpret sequential operations as overlap.
5. **Finish application release proof after those integrations.** Keep the current draft review separate from approval to merge/deploy. Run the updated application checks and authenticated administrator/manager/worker flow, including reload, correction, company switch, unknown rates and licence loss. Preserve the migration bodies, both historical and fresh artifacts, and the original 73-scenario scope. This worklist does not introduce a restricted rollout as a substitute for completing that scope.

## Release gates still open

1. Preserve the verified hosted migration, scoped backup, rollback and parser evidence above through release. Any additional production scope requires its own current preservation check.
2. Complete commit/review, CI, application deployment and the authenticated deployed workflow. The local build is already passing; test database application alone is not app delivery.
3. Preserve the five successful fresh RPC scenarios above. Complete source-versus-approval, blocked role/module revocation and separately identified rate-first evidence. Legacy direct source DML can take a row lock before the new worker lock; PostgreSQL may abort one competing transaction as a deadlock victim. Rollback preserves integrity, but client retry and live timing have not been proven here.
4. Integrate and verify every consumer that formerly recalculated current profile rates, including the existing payroll/assignment views. Root application work is tracked separately; this foundation alone must not be presented as completing those consumers.
5. Verify the complete user flow with administrator, manager and worker sessions; missing rate, return/revision, company switch, role revocation, licence expiry and persisted reload. Preserve incomplete values in UI rather than substituting zero.
6. Contractor invoice billing intentionally returns invoice_amount_required until a verified invoice-linked amount exists. Do not silently fall back to an hourly estimate. Ambiguous assignment/shift/log overlap requires explicit source reconciliation.

## Migration and rollback

This migration is additive and performs no historical source-row updates or deletions. Existing sources gain guards; before the first approved ledger record these do not freeze old time. Apply in a database transaction: any DDL failure must roll back the entire migration. Avoid a partially installed ACL/function set.

Before application activation, a failed rollout can leave the additive schema installed and keep the feature inaccessible while the cause is repaired. Prefer a forward fix. After any draft, approval or rate is recorded, **do not drop ledger tables, approved snapshots, audit events or guards as a rollback shortcut**. Preserve the database and audit history. Pause new workflow writes and deploy a compatible application rollback that retains canonical historical reads and explicit incomplete state; an older application that resumes current-profile cost calculation is not an acceptable financial rollback. Removing guards or changing the canonical contract requires a reviewed follow-up migration with preservation evidence.

No destructive down migration is included. Scoped backup, test database application and database postflight are recorded above. The remaining concurrency gates, application delivery, remaining consumers and real user acceptance are still open. C03-03, C04-03, C10-02 and P17 remain unfulfilled.

## Initial foundation checkpoint artifact hashes (SHA-256)

These rows identify the pre-PT409 checkpoint, including its then-current runner and test artifacts.

| File | SHA-256 |
| --- | --- |
| supabase/migrations/20261024083058_labor_history_foundation.sql | 47e1c218d8386d6b26165b46c529ceec2cff291d1168383df14dffdde659f43c |
| supabase/tests/labor-history.sql | d1a5af46957813627c8becef3ddffa4af2691e14d67102472989704ddfc32845 |
| scripts/test-labor-history-sql.mjs | c6d81aec1812a7298a4e90076402ee739af7a5cc4d5e822778f0ec343ef55411 |
| tests/labor-sql-contract.test.ts | 5d6223c858ec3cfe0ad5ded141ef4d8f7802bb30cc86bdf929d5228165a76424 |

## Current PT409 checkpoint artifact hashes (SHA-256)

| File | SHA-256 |
| --- | --- |
| supabase/migrations/20261024083058_labor_history_foundation.sql | 47e1c218d8386d6b26165b46c529ceec2cff291d1168383df14dffdde659f43c |
| supabase/migrations/20261024091643_labor_domain_conflict_status.sql | cf50c9edd15f031bb89496cc6cfb31c91d675567af06f655b1f1b9cf72258b53 |
| supabase/tests/labor-history.sql | 60fa6975d96ecace089666437cdf6819bf32b663f6697fd1bf3519ae627a33c2 |
| scripts/test-labor-history-sql.mjs | a8b719193b38a2db2137c3caf4241c4f5aa30776f79054b974720e9ae721168a |
| tests/labor-sql-contract.test.ts | 02f443f6f4bf9fe97663d220a14a10a1a35e40fb3c870f6365bb861887abfb3c |
