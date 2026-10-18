# C08: employee advance ledger, implementation and verification

PR #27 is merged and live on `app.diriqo.com` from `010a3643b9ad5397b665d2e8a37238ac7f3737f1`. Main and Office CI passed. Application checkpoint `ae5c232` was integrated with reviewed main `6467d229` in merge `668e3a2`, including Next.js 16.4.2; focused review fixes are in `fd1f8e4`. Both test-database migrations, hosted SQL/Auth/HTTP checks, the original C08-01 UI flow and test-access cleanup are complete. The checkpoint below closes only the original C08-01/02 scenarios; C08-03 remains partial.

## Implemented contract

A worker requests 5,000. An administrator approves 3,000 with an explanation. Approval records no payment. Separate recorded payments of 1,000 and 2,000 consume the approved balance; the first leaves 2,000 payable, the second leaves zero. The request is marked paid only when cumulative payments equal the approved amount. The administrator records cash or an evidenced bank transfer; this application does not send money.

Every request, review, payout and settlement has a stable client-generated operation identity. A transport failure preserves the original identity and payload in session storage; a retry confirms the existing result. A later definite rejection (for example, a changed active company or revoked role) does not erase a previously uncertain operation: it cannot prove that the original payment did not commit. Another payload with that identity is rejected. Requests carry a revision so a second administrator sees a stale-state error instead of overwriting a decision. A per-company/worker transaction lock serializes manual and request-linked payments against the shared monthly limit. Financial history is append-only; direct DML, TRUNCATE, trigger and reference privileges are removed from API roles.

Two balances are shown separately: approved but unpaid, and paid but unsettled. Returned money and an evidenced payroll offset are separate immutable settlement entries tied to the payment. Their cumulative amount cannot exceed that payment. A returned amount reduces the advance counted against wages. A payroll offset confirms the same deduction; it is not deducted again. Neither settlement reopens the approved payout ceiling or monthly payment limit. Stored payroll-payment amounts are not modified.

Reads use the session client, explicit company scope and own-profile scope for workers. RLS admits an active company administrator or the worker's own history. Managers cannot approve or read team financial history through these tables. The server resolves the actual active company before checking the role, and rejects a form from a different company. New requests/payouts require the existing Core capability evaluator; review and settlement preserve access to existing history after licence expiry. No licence model is changed.

## UI and accounting readers

- `/mobile/my/advances`: own request, decision, payments and settlement history; linked from My Diriqo and web My Work.
- `/advance-requests`: administrator review with changed-amount reason, partial payouts and settlement evidence.
- Worker detail: immutable manual payout form and history, plus a link to full request/settlement history.
- Worker list/detail, dashboard and XLSX export count the payment ledger once. Request status and note text no longer manufacture a second payment. Returns reduce the wage advance; offsets do not create another expense.
- Worker list/detail, finance editor and XLSX export explicitly scope shifts, logs, payroll items, paid wages and absences to the active company. Assignment ownership follows `jobs!inner.company_id`; summary-view reads use only previously scoped assignment IDs. Worker detail checks active membership before reading profile or finances. A failed page or denied payment read cannot silently become a partial or zero total.
- Historical NULL requested amounts are displayed as undocumented, not zero.
- Financial readers paginate beyond PostgREST's default cap, preserve cents, and refuse ambiguous historical periods or currencies instead of returning a guessed total. Payout/settlement history keeps its recorded currency. Dates use the company timezone at entry.

## Pay date and period

The work month and new advance `payroll_month` are calendar months. A new payment belongs to the calendar month of its explicit actual payment date. A configured payday is only a planned date for wages of month M in month M+1. Days 29–31 are clipped to the last day of that payment month; weekends and holidays are not silently moved. NULL is displayed as not configured. Weekly/shift modes do not receive a fabricated monthly payday.

The shared authorized settings writer updates canonical and legacy aliases together. Existing company rows are authoritative; false/NULL values are preserved. Active worker overrides are read only from `(company_id, profile_id)`. Global profile overrides are not allowed to affect a different company. Historical stored `payroll_month` and recorded payments remain untouched when settings change. Unknown historical periods or currencies require a separately audited reconciliation; this migration does not invent evidence.

The worker export honors individual scoped payday overrides. A historical report's displayed plan is explicitly based on current settings; the current schema has no historical schedule snapshot. Actual paid amounts/dates remain the original evidence.

## Verification and deployment boundary

Local checks include TypeScript, targeted lint, monetary and authorization tests, pagination beyond 1,000 records, active-company rejection, malformed responses, retries, settlement arithmetic, payday boundaries and shared settings writers. On integrated application checkpoint `668e3a2`, TypeScript and targeted lint passed, as did the complete Vitest suite (58 files, 1,564 tests). The Next.js 16.4.2 production build with webpack passed, including compilation, TypeScript, all 107 static-page generation steps and build traces. Build-time Supabase configuration was deliberately nonfunctional test data, so this build is not a hosted database or authenticated UI test. The final 80 SQL scenarios plus 5 cleanup checks passed in local PGlite with a simplified schema baseline and the actual shared capability evaluator, not on the hosted database. See the preflight document for the latest SQL count and observed metadata.

Focused follow-up review found and repaired pre-existing cross-company payroll readers and loss of the original idempotency key after a rejected retry. After these fixes, 8 targeted test files / 88 tests passed along with TypeScript and targeted lint. The tests call the export GET handler and decode its XLSX, invoke server list/detail pages and the finance action, and cover an administrator in both A and B with a shared worker, 1,001 shifts, a failed second page, denied payment permissions, and legacy NULL amounts. The query fixture deliberately exposes both companies; these tests verify application filtering, not hosted RLS. Independent app re-review and the two new regression files (11 tests) passed. The first two follow-up builds exhausted the TypeScript worker heap (4 GB and 5 GB); narrowing the dynamic query return type and exported finance DTO removed the recursive SDK type expansion. The final production build passed with the standard 4 GB heap (compilation, TypeScript, 107 static steps and traces), using the same dummy Supabase configuration. No typecheck was skipped.

## Hosted test-database evidence, 18 October 2026

The approved test project is `wfcpfraxiuhuglnuaxqj`. The provider recorded successful application as version `20261018182238`, name `atomic_worker_advance_ledger`. The repository file is now `supabase/migrations/20261018182238_atomic_worker_advance_ledger.sql`; only its filename changed to match the provider, with byte-identical SQL SHA-256 `B15A61F497B1EE85100B0538027890C0FAE0BACBFE6B7BACD0F8FB4EFF81CB28`.

The hosted rollback-only SQL suite passed **80 scenarios plus 5 cleanup assertions** against the deployed schema. Its SQL SHA-256 is `F428CC4170FCE4D527A35DE1FD7AD359600999070C654EAC2A93FD3B8EB56AA1`. This covers sequential RPC behavior, simulated PostgreSQL authenticated roles, RLS, direct-DML denial, exact retries, rejected changes leaving financial state unchanged, partial payouts and settlement arithmetic. The fixture transaction rolled back.

Managed evidence: `artifacts/worker-advances/hosted-sql-20261018.json` (persistent Diriqo artifact), SHA-256 `8cf36cae13974bfe2092801fb215d0dad3cbc3bd261239b2a030de74c4c3b118`. It contains provider apply success, preflight/post-migration metadata, deployed grants/policies and the actual hosted SQL result. The recorded post-migration observation is 18:22:59 UTC.

Preservation checks:

| Existing data | Count | Preserved fingerprint |
| --- | --- | --- |
| Original request columns, excluding newly added revision/review-operation/review-reason/currency | 1 | `a157951554d67b6ff1eb5f7109e9281a` |
| Company payroll settings | 3 | `3f8f6b7e5bb6ab83cd3d0090a32abb15` |
| Scoped worker payment settings | 6 | `b0c3b648047b8d8f5b39855e30e2c808` |
| Existing payment ledger | 0 | `d751713988987e9331980363e24189ce` |

The release coordinator separately rechecked the request fingerprint using only its original columns and excluding the explicitly synthetic fixture tenants. That check is preserved in `artifacts/worker-advances/original-request-preservation-20261018.json`, SHA-256 `7ee6c11c0f70d8a1a188d3ad341d8897965f1f1a5d0babb97777b07367f099a9`. The artifact's full-row post-migration fingerprint differs because four columns were added; that is not evidence of a change to the original request values. Settings and payment fingerprints match directly in the saved before/after metadata. Pre-migration scoped data/schema snapshots are recovery evidence for the affected objects, not a verified full-database restore point.

This hosted SQL pass does **not** itself establish two overlapping HTTP/Auth transactions, lock-wait reauthorization, browser form behavior or device operation. The separate lock-wait and authenticated UI results are recorded below; physical-device behavior remains unverified.

## Hosted concurrency, reauthorization and repaired failures

The first hosted payout overlap exposed a release blocker: one request committed, while the stale loser and its exact-payload retry each reached the 45-second transport timeout without a second ledger event. The original C08 review/payment functions used SQLSTATE `40001` for `ADVANCE_STALE`. That code denotes a retryable serialization failure, not a business revision conflict. [Supabase's official troubleshooting](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b) documents this retry loop and recommends `PT409` for HTTP 409. [PostgREST's custom-error contract](https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes) defines the `PT` mapping; the [upstream Hasql retry source](https://github.com/nikita-volkov/hasql-transaction/blob/2a9a710bd6230cb0abae84f14f852ab14fc3fa85/library/Hasql/Transaction/Private/Sessions.hs#L48) establishes why the transient code is unsuitable.

The follow-up is a separate forward migration replacing only the two C08 functions' stale-revision SQLSTATE with `PT409`; applied migration `20261018182238` remains byte-identical. `ADVANCE_STALE` and the existing UI message remain unchanged. The SQL regression checks the actual error code for both functions, the action regression checks the exact PostgREST error payload, and the HTTP overlap harness requires both the loser and its identical retry to return `409/PT409`. The forward migration, hosted SQL rerun, fresh two-session payout overlap and original-operation reconciliation have now passed. The initial timeout remains preserved as a failed attempt, not counted as a pass.

Applied forward migration: `supabase/migrations/20261018183656_advance_revision_conflict_http409.sql`, provider version **20261018183656**, SHA-256 `9E63B84B8C0EE70001997570F2BF4F3AD1E2B6C099776DA19D2BF27E488750A9`. Its filename was aligned with the actual provider version without changing the SQL. Independent source comparisons before application and by the release owner verified exactly two SQLSTATE substitutions and otherwise identical function definitions. With the original and forward migrations loaded, both local PGlite and the subsequent hosted rollback-only SQL run passed **81 scenarios plus 5 cleanup assertions**, including both `PT409` branches and unchanged financial snapshots. The updated SQL suite SHA-256 is `0050CD384B0577190CE57258A3A6CFE392ED3FA911D9AA1ED40EFC434871CD44`. The targeted action suite passed **20 tests** and the HTTP harness passed `node --check`; these checks do not prove hosted PostgREST response timing.

The release owner terminated only the two confirmed looping synthetic payment backends. Each termination matched the exact PID, backend start, `authenticator` user and payment RPC query and returned `true`; those operational identifiers remain in the private evidence. No project restart was used. This cleanup is separate from proving the corrected HTTP response.

Hosted request reauthorization passed all four combinations: `settings/revoke`, `company/revoke`, `settings/expiry`, and `company/expiry`, with actual Auth/HTTP calls and owner lock-wait evidence. The observed transaction isolation was `READ COMMITTED`. The first settings/revoke attempt returned HTTP500/SQLSTATE57014 (statement timeout); it remains a failed attempt. The release coordinator attributed the orchestration delay to coordinating two owner queries. The rerun first proved the waiter, then changed only the synthetic membership and committed in the same barrier transaction, publishing revocation and releasing the lock together. That rerun passed.

All three fixture-driven harnesses ran against explicitly synthetic hosted tenants with real Auth/PostgREST callers. Owner-side evidence proves the blocked backend chain before release; HTTP timing alone is not the overlap proof.

| Hosted boundary | Final result |
| --- | --- |
| Fresh payout overlap after the fix | PASS: one committed payment, one `409/PT409` conflict; identical loser retry also `409/PT409` |
| Exact payout retry | PASS: one financial event and the same immutable event on replay |
| Shared worker/month limit | PASS: only one candidate can consume the shared remaining limit |
| Concurrent settlements | PASS: no settlement total above the paid amount |
| Worker request reauthorization | 4/4 PASS: settings/company barriers × membership revocation/expiry |
| Payment reauthorization | 7/7 PASS: rollout/test-grant barriers × administrator revocation/subject revocation/expiry, plus test-grant revocation |
| Original-operation reconciliation after the fix | 4 steps PASS, using the saved operation identities |
| Paid-receipt licence barrier | NOT RUN; no paid receipt was manufactured |

The aggregate contains 19 preserved reports: 15 final scenario passes, one reconciliation pass and three failed historical attempts (initial payout overlap, initial reconciliation, and initial settings/revocation). The hosted SQL artifact contains the provider-applied forward migration, **81 scenarios + 5 cleanup assertions PASS**, and the narrowly matched backend cleanup. No bank transfer or payroll deduction was performed.

| Managed private evidence path | SHA-256 |
| --- | --- |
| `artifacts/worker-advances/hosted-concurrency-20261018.json` | `98b8839dd8deed772d8fa0699bbeca3ed2d67a44a18a6b5ca72686d8181b7206` |
| `artifacts/worker-advances/hosted-http409-sql-20261018.json` | `2dc25206502836a692957146a31696fd6f8d5013959d5001b74a326995939904` |

## Live release checkpoint, 18 October 2026

Release `010a3643b9ad5397b665d2e8a37238ac7f3737f1` from PR #27 is deployed on `app.diriqo.com`; main CI and Office CI passed. The release owner completed the authenticated worker/admin flow using synthetic records: request 5,000 → approve 3,000 with a reason → record payments 1,000+2,000. The live UI/AX observations and DB ledger confirm the two balances are distinct. Subsequent recorded return 500 and payroll offsets 500+2,000 leave paid 3,000 and outstanding 0. These are records of synthetic evidence, not actual money transfer or payroll deductions.

The configured payday changed 31→25, remained 25 after reload, and both database aliases matched 25. The saved payday screenshot supports the visible setting. The archived ledger screenshot is scrolled below the target request's upper balance cards; it is not presented as visual proof of those hidden balances. The balance proof is the live UI/AX observation plus the DB records.

| Original acceptance scenario | Status and narrow basis |
| --- | --- |
| C08-01: request 5,000, approve 3,000, pay in two amounts, show both balances | **HOTOVO**: authenticated UI/AX flow and matching DB ledger; export is outside this original scenario |
| C08-02: repeat the same payment without an extra movement | **HOTOVO**: actual Auth/HTTP retry and two-session overlap preserve exactly one immutable payment; recovery UX for an uncertain response is a separate boundary |
| C08-03: no duplicate job cost beside worked-time cost; settlement has evidence | **ČÁSTEČNĚ**: referenced settlements are demonstrated in UI and DB; the concrete job-cost comparison remains unverified |

Cleanup is complete: 18 synthetic companies have 0 active test memberships; 0 active synthetic profiles remain; 3 synthetic Auth accounts are banned and 0 sessions remain. The real user's original active-company context was restored. Synthetic financial evidence is retained.

Managed evidence: `artifacts/worker-advances/live-ui-and-cleanup-20261018.json`, SHA-256 `20f68d9d319dd0c159c81ca21cce853b0a782d87daa499b259802657bcd09a64`. It records the release/CI identities, authenticated UI and DB evidence, payday check and cleanup aggregates. The broader module and product are not declared commercially ready by closing these two original scenarios.

Supporting independent classification: `artifacts/worker-advances/exact-acceptance-classification-20261018.json`, SHA-256 `f4491ff210ba8e572cfbf63d2b3326764c29b615fdde7ad6c29d3d635673a342`. The canonical matrix is **3 HOTOVO / 48 ČÁSTEČNĚ / 11 CHYBÍ / 6 CHYBA / 5 NEOVĚŘENO**, with all 73 original scenario identifiers and texts preserved.

## Remaining verification outside the closed scenarios

A separate mixed-role active-company fallback was observed during UI preparation: a user who is administrator in company A and worker in selected company B can see company B in the header while `/` loads company A dashboard data. `app/(dashboard)/page.tsx` uses `getActiveCompanyContext()` with its default `hasHubAccessRole` filter before resolving the active-company cookie; the worker membership is filtered out and the resolver falls back to an administrator company. C08 uses the correct `requireWorkerAccess` boundary. The global resolver/dashboard issue is open for a separate fix; this release does not close the full tenant audit.


Deployment, the original C08-01 UI flow and synthetic access cleanup are finished. C08-03 still needs a concrete job-cost comparison against worked time. Payroll XLSX acceptance, uncertain-response recovery UX, the paid-receipt barrier, broader authorization surfaces and physical Android remain separate work; they are not additional completion criteria for the original C08-01/02. Before applying to another environment, rerun read-only preflight, preserve schema/grants/policies and settings snapshots, establish the approved recovery procedure and review both migrations against that environment.

If application or verification fails, stop new advance operations and retain all financial rows. Roll forward with a reviewed repair. Do not re-enable the old direct writes or drop the settlement ledger as a rollback shortcut. An application rollback must keep advance mutations disabled unless it supports this ledger contract; a database restore requires an explicit recovery decision and reconciliation of any evidence written after the snapshot.

## Explicit remaining scope

This is the agreed minimal C08 slice. Broader draft/cancel flows, delegated separate decision/payment permissions, corrected financial events, automated percent-of-earned limits, actual payroll deductions and bank transfers are not claimed complete. `percent_of_earned` without an explicit supported amount override fails closed. The existing frequency value is retained; this package adds no unapproved interpretation of weekly/shift payout scheduling. Auth/HTTP evidence is limited to the 15 final scenarios and reconciliation above. Paid-receipt barriers, broader UI/export recovery paths, device and field operation remain open. The original C08-01 UI flow and C08-02 idempotency invariant are closed. Deployed SQL role/RLS scenarios have their separate hosted evidence recorded above.
