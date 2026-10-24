# Labor history: hosted concurrency verification plan

Checkpoint 2026-10-24. **Hosted evidence is partial; the full concurrency acceptance is NOT DONE.** The procedure and pure validator are distinct from the actual runs recorded below. Application changes remain uncommitted and undeployed; neither this document nor isolated concurrency results prove commercial readiness.

Scope is the explicitly selected test project `wfcpfraxiuhuglnuaxqj`. Its display name is not an authorization decision. The frozen local migration under test is `20261024083058_labor_history_foundation.sql`, SHA-256 `47e1c218d8386d6b26165b46c529ceec2cff291d1168383df14dffdde659f43c`; the local filename matches the observed hosted ledger version 20261024083058. Recheck this hash and the applied migration body before any new concurrency execution. The release report owns current migration and hosted rollback-test status. Do not silently adapt the migration to make a test pass.

## Local preparation delivered

- `scripts/labor-history-concurrency-proof.mjs`: pure validator of the owner observation and the two local HTTP intervals for the five RPC scenarios below. It performs no I/O and does not authenticate.
- `tests/labor-history-concurrency-proof.test.ts`: 73 passing offline cases at initial delivery and 89 after the OID-validation correction, including stale scope, wrong database/backend/lock tag, reused operation identity, nonexistent owner lock, unsupported source-PATCH evidence, and clock-domain separation.
- `scripts/prepare-labor-history-concurrency.mjs`, `scripts/test-labor-history-concurrency.mjs` and `supabase/tests/labor-history-concurrency-barrier.sql` support bounded fixture preparation, dispatch and owner observation. Offline preparation exercised all five setups/postflights and scoped disabling in PGlite. Their successful compilation is not hosted concurrency proof.
- The SQL/TypeScript foundation contract runs with required pinned PGlite 0.5.9, without opt-in or skipped default tests. The release report records the separate 96+5 SQL assertions, 29 parser checks and latest 2,847/101 local application suite; these are not substitutes for the hosted scenarios.

The validator returns `overlapVerified: true`, with `businessOutcomeVerified: false` and `authSessionsVerified: false`. The runner must separately establish actual Auth sessions, mutation outcomes, complete committed state, private receipt/event counts, preservation and logout before it can report a scenario as passed. Unit-test fixtures are constructed observations; they are never hosted concurrency evidence.

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

The required outcome table below is the plan for **fresh post-fix runs**. Each deterministic conflict must return **HTTP 409 and PT409**, preserving the exact LABOR_* message token. A timeout, HTTP 500 or bare 40001 is not accepted. Fresh-run reports must bind the applied follow-up version and remain separate from the original five invocations above.

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
3. **Connect legacy editors and row displays to the review lifecycle.** app/work-shifts/[shiftId]/edit/page.tsx:359–363 still turns an approved-source denial into a generic update failure; app/api/job-assignments/[assignmentId]/route.ts:113–119 returns a generic 500. Show the protected approved state and route correction through a linked review revision. JobDetailPageClient.tsx:691–692,1063–1070,2568 still treats a legacy default hourly_rate=0 as a numeric row cost while the canonical total correctly says incomplete. Show undocumented legacy cost as unknown and keep row-level and aggregate financial claims consistent. Verify that a pending correction keeps the previous approved amount, and only its approval switches the current pointer once.
4. **Complete source-write and authorization concurrency gates.** Collect actual source PATCH/approval lock evidence, including a shift referenced through a log. Direct DML takes a source-row lock before the worker lock; approval takes the worker lock before a source-row lock. A real 40P01/deadlock remains possible and is not repaired by changing deterministic domain conflicts to PT409. Reconcile survivor/victim state, audit, receipts and any retry before accepting the flow. Test role/membership/module revocation during a wait and the rate-first stale-preview outcome with separately identified evidence. Do not reuse consumed fixtures or interpret sequential operations as overlap.
5. **Finish application release proof after those integrations.** Keep the current draft review separate from approval to merge/deploy. Run the updated application checks and authenticated administrator/manager/worker flow, including reload, correction, company switch, unknown rates and licence loss. Preserve the migration bodies, both historical and fresh artifacts, and the original 73-scenario scope. This worklist does not introduce a restricted rollout as a substitute for completing that scope.

## Execution prerequisites

1. Owner verifies the additive migration is installed in this exact project, the frozen body/hash matches, and live source columns/constraints accept the proposed synthetic fixtures. The rollback SQL suite and this concurrency suite are different proofs.
2. Preserve affected original schema, trigger/function definitions, ACL/RLS, legacy views and scoped original rows in a private recoverable artifact before migration. Include a restore procedure and fingerprints. A fingerprint alone cannot restore rows. Provider backup/PITR availability is a separate, currently unproven property.
3. Explicitly authorize synthetic hosted fixture setup and the requested scenarios. All company, profile, job, source and operation IDs must be new. Do not use customer workers, wages, shifts or jobs.
4. Use company name `TEST-LABOR-HISTORY-<runId>` and Auth email `labor-history-concurrency-<uuid>@example.invalid`. Use one active company-admin actor, a separate active worker member, one job and one completed source per invocation. Create jobs before Core rollout enrollment, or include `core.jobs.create` in the setup capabilities. Grant currently valid `core.rates.manage`, `core.time.record` and `core.time.approve` for the fixture company. Do not grant cross-company access.
5. The client reads only the public/publishable key for the exact project and the private synthetic fixture password. Reject service-role keys. Claim fresh run, output and owner-evidence paths with exclusive create **before Auth**. A failed or partially dispatched invocation consumes its run ID; do not overwrite its report or reuse its operation IDs.
6. Log in twice and assert both JWTs identify the exact fixture Auth user and have distinct authenticated session IDs. Keep tokens/passwords only in the private fixture or memory. Do not print them, raw Auth responses, SQL query text or error details. Session identity does not establish a mapping to a database backend PID.
7. Snapshot the complete fixture state before dispatch and verify expected tenant, actor, worker, job, source, current version, CAS revisions, rates and preview hash. Read new labor tables through scoped public RPCs; authenticated direct SELECT is intentionally unavailable. The owner supplies private event/receipt/snapshot checks independently.

The baseline used below is hourly CZK 200 effective `2026-10-01`, with one submitted eight-hour line on `2026-10-15`: `actual_hours = 8`, `pay_hours = 8`, `billed_hours = 6`. The initial approved cost is CZK 1,600, based on paid hours. Both paid and billed hours stay within actual hours. The candidate covering rate is CZK 250 effective `2026-10-10`; its effective date must differ from all existing rate dates. A later non-covering date is not a valid substitute for the rate-versus-approval scenario. Keep a separate previously approved version and an unrelated synthetic company as preservation canaries when the authorized setup supports them.

## RPC scenarios and committed outcomes

Each row requires **both** actual database overlap and the complete committed postcondition. Choose a new invocation for every row/attempt. Do not count HTTP overlap, two status 200 responses, or elapsed time alone as database concurrency proof.

| Scenario | Client A / client B | Required outcome |
|---|---|---|
| `approve-retry` | `review_labor_submission` twice; identical actor, operation ID, submission/version, expected revision, approve decision and preview hash | Both return the same scoped receipt. Exactly one revision increment, one approve event, one operation receipt, one snapshot per submitted line and one approved pointer. No duplicate cost. |
| `approve-race` | Review twice with distinct operation IDs and identical current CAS/version/hash | One successful approval; one `PT409 / LABOR_REVISION_CONFLICT`. Only the winning operation has a receipt. The state and cost effects occur once. |
| `rate-retry` | `set_company_worker_rate` twice with identical operation ID and complete payload | Two equal scoped receipts; exactly one new immutable rate, one schedule revision increment, one `rate_created` event and one receipt. Old rates and approved snapshots are unchanged. |
| `rate-conflict` | Rate twice with the same operation ID and CAS/effective date; A amount 250, B amount 260 | Exactly one success and one `PT409 / LABOR_OPERATION_CONFLICT`. The new rate and receipt equal the winning payload, never a mixture; exactly one rate/event/revision increment. Either client may win. |
| `rate-vs-approve` | A sets covering rate 250 using `operationId`; B reviews using `otherOperationId`, the existing submitted CAS and the preview hash from rate 200 | Both serial outcomes below are valid. Exactly one rate version/event/receipt is created; approved historical snapshots remain unchanged. |

For `rate-vs-approve`:

- **Approval first:** both operations succeed. The approved line snapshot stays bound to rate 200 and cost 1,600 even after the rate 250 exists. Current totals include that approved snapshot once. No retroactive repricing.
- **Rate first:** rate succeeds; approval returns `PT409 / LABOR_PREVIEW_CONFLICT`. The submission stays submitted at its pre-race revision, with no new approved pointer, approval event, snapshot or approval receipt. A separate, explicitly recorded follow-up may read a fresh preview and approve cost 2,000 with a new operation ID. Never auto-resubmit the stale user's approval against a new price.

Worker-lock queue order is not an assertion about who wins. One overlapping run observes one legal serial outcome. To claim both orderings were covered, preserve two separately identified hosted runs with corresponding evidence, or design and review an additional deterministic test. Repeating sequential RPCs is not equivalent to either concurrency proof.

Domain conflicts are matched against the actual returned PostgreSQL code and exact message token. The historical foundation body retains SQLSTATE `40001`, while the applied follow-up replaces its deterministic domain raises with `PT409`. Fresh runs must record HTTP 409 and PT409 together; existing pre-fix reports must retain their original outcomes. Transport timeout, `40P01`, `57014`, arbitrary server errors or missing owner evidence are not accepted domain conflicts.

## Actual database-overlap proof

The owner barrier holds the worker advisory lock, not a company row and not only the operation key:

```sql
pg_advisory_xact_lock(
  hashtextextended('labor:' || company_id::text || ':' || worker_profile_id::text, 0)
)
```

Every RPC first obtains its own operation key:

```sql
hashtextextended(
  'labor-op:' || company_id::text || ':' || actor_profile_id::text || ':' || operation_id::text,
  0
)
```

The owner observes `pg_stat_activity`, `pg_blocking_pids()` and **actual `pg_locks` rows**. Merely calculating a key or finding an RPC name in query text is insufficient. Use the current database OID, `locktype = 'advisory'`, backend PID, `mode = 'ExclusiveLock'`, grant state and the complete bigint tag: `classid = (key >> 32) & 4294967295`, `objid = key & 4294967295`, `objsubid = 1`. Signed negative keys are valid. Reject collisions between worker and operation keys for this fixture. Do not export raw query text.

The observation must identify exactly two distinct active RPC backends with `wait_event_type = 'Lock'`, and a blocking graph that reaches the owner PID. Their query starts must be after owner lock acquisition and no later than observation, on the database clock. The barrier must be acquired and released in the same owner session; use a bounded nested subtransaction and rollback the marker exception to release its transaction-level lock. No business DML is needed in this barrier.

- For identical operation IDs, one RPC holds the operation lock and waits on the worker lock; the second waits for that same operation lock through its peer and has not reached the worker lock.
- For different operation IDs, both RPCs hold their own distinct operation lock and wait on the same worker lock. In `rate-vs-approve`, correlate the first key to `set_company_worker_rate` and the second to `review_labor_submission`.
- The owner must verify its own granted worker lock from `pg_locks`, not set a constant `true` as a substitute for that query.
- Bound acquisition, statement and observation durations. A recommended owner limit is 45 seconds observation, 55 seconds statement timeout and 5 seconds lock acquisition timeout. Cancel and record a failed/inconclusive run when the exact graph is not observed.
- HTTP intervals use one process's monotonic clock. Compare their overlap only to one another. Database timestamps use only the database clock. Never compare the two clocks, infer a tolerance or claim an Auth-session-to-PID mapping.

Public fixture schema shared by runner and barrier preparation:

```text
runId, scenario, companyId, actorProfileId, workerProfileId, operationId,
otherOperationId? (approve-race / rate-vs-approve only),
submissionId?, versionId?, expectedRevision?, expectedScheduleRevision?,
rateInput?, otherRateAmount? (rate-conflict only)
```

Private `{email, password, authUserId, fixture}` stays outside the repo. The runner reads the exact current cost preview before dispatch; its hash is not accepted from a stale fixture file. Rate payload uses `actor_profile_id`, `profile_id`, `expected_schedule_revision`, `effective_from`, `amount`, `currency`, `unit`, `worker_type`, `billing_type`, `reason`, `operation_id`. Review uses `actor_profile_id`, `submission_id`, `version_id`, `expected_revision`, `decision: 'approve'`, `expected_cost_preview_hash`, `operation_id`. Both public RPCs take `{target_company_id, payload}`.

Validator exports are `laborHistoryScenarios`, `matchesLaborHistoryGate(gate, fixture, round = 1)` and `validateLaborHistoryOverlap(gate, responses, fixture, round = 1)`. The definitive evidence shape is checked in the module and the positive test fixtures. The gate binds project, run, round, company, actor, worker, operation IDs, submission/version when relevant, `applicationName = 'labor-history:<runId>:<round>'`, current database OID, barrier PID, ordered server timestamps, full owner/worker/operation lock observations and the two waiter graph nodes. Every client observation binds A/B to its RPC, operation ID and monotonic interval. JSON must be written atomically to the matching one-time owner observation path.

## Source mutation versus approval: separate collector required

This is a distinct unresolved scenario. The pure RPC validator intentionally rejects `source-vs-approve`: a direct source PATCH has no `labor-op` lock, so inventing one or matching only the table name would give false proof.

For this separate, not-yet-executed scenario, use a new two-hour synthetic `work_shifts` source initially captured by its own submitted version; do not reuse the eight-hour fixtures from the completed runs. Dispatch an authenticated, tightly scoped PATCH changing a fingerprinted value such as `hours_override` from 2 to 3:

```text
PATCH /rest/v1/work_shifts?id=eq.<sourceId>&company_id=eq.<companyId>&profile_id=eq.<workerId>
Prefer: return=representation
{"hours_override":3}
```

The other client calls `review_labor_submission` for that exact claimed source/version with the old preview. Notes and `updated_at` are deliberately excluded from fingerprints and are not a valid test substitute. Run separately for a linked shift claimed through a log, and for assignment/log sources if those paths are to be marked covered.

Frozen implementation lock order:

```text
source PATCH: source row DML lock -> BEFORE trigger -> worker advisory lock
approval RPC: operation advisory lock -> worker advisory lock -> source SELECT FOR UPDATE
```

Thus the following cycle is possible and must be measured, not waved away as safe serialization:

```text
PATCH holds source row; waits for worker held by approval
approval holds worker; waits for source transaction held by PATCH
```

A worker barrier can first observe both calls queued while PATCH already owns its source row. After release, a second bounded observer must look for the post-release graph, including the actual worker advisory lock, transaction-ID wait/holder, `backend_xid` where available, `pg_blocking_pids()` edges and distinct backend IDs. Capture the cycle if observed before the deadlock detector selects a victim. Tuple/relation lock presence alone is not a complete inventory of row ownership, and a relation-level `RowExclusiveLock` does not prove contention on the exact source row. If the collector cannot bind its observations to the exact source operation and transaction, mark proof incomplete. Do not install an extension, alter global deadlock settings or add test-only production trigger sleeps to manufacture evidence.

Allowed serial business outcomes are:

- PATCH commits first: source becomes 3, approval fails with `PT409 / LABOR_SOURCE_CHANGED`; submitted revision/pointer/snapshots/events/receipt remain unchanged.
- Approval commits first: one approved snapshot at the reviewed amount; PATCH fails with `23514 / LABOR_APPROVED_SOURCE_IMMUTABLE`; source remains 2.

A `40P01` response records a real deadlock failure, even when PostgreSQL rolls back the losing transaction and leaves consistent data. Verify both survivor and victim postconditions with a fresh read. Do not mark UX/retry behavior passed, swallow the error, or use a later successful retry to erase the original failure. Any retry must be separately identified and demonstrate whole-transaction rollback and no double effect. A transport timeout has an unknown commit outcome until scoped receipt and state reconciliation; it is not equivalent to a domain rejection. If lock-order correction is required, it is a separate reviewed change to the frozen migration or a follow-up migration.

## Independent final checks and cleanup

Owner postchecks must bind the same run/company/worker/actor/operations and exact source/submission/version. Count and compare all affected rate schedules/versions, source claims, submission/version/line rows, cost snapshots, append-only history events and private operation receipts. Reconcile every response with the committed state and exact decimal amounts. Verify old approved snapshots and original source/legacy view fingerprints remain unchanged outside the intended synthetic changes. For failed operations require zero partial rows and no successful receipt.

Compare complete before/after fixture RPC results, not an implicitly truncated page. Private postchecks must not be replaced by a privileged application read path. Do not expose customer rows, password hashes, Auth refresh tokens, session tokens, JWTs or query text in evidence files. Normal reports contain only synthetic IDs, safe error tokens, counts, fingerprints, lock facts and checks.

Always log out both synthetic sessions in a `finally` block, including on timeout and assertion failure. The owner then disables the synthetic Auth user, rotates its fixture credential, verifies zero active sessions and retains test audit records according to the agreed cleanup procedure. Do not delete immutable business history to hide failed runs. Avoid payment, mail and other provider effects.

Remaining gates: a source PATCH collector/run and any deadlock resolution; role/module revocation while blocked; separately observed rate-first behavior. All five fresh post-PT409 RPC scenarios now have exact overlap and successful owner reconciliation, including structured losing responses. Both batches retain their original evidence and completed cleanup; new attempts need fresh IDs and credentials. Preserve the original failed approve-retry report and separate offline revalidation as well as the fresh successful run. C03-03, C04-03, C10-02 and P17 remain unfulfilled. The release report separately tracks hosted rollback SQL, application delivery, all consumers and end-to-end payroll/economics acceptance.
