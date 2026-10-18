# C06-03: atomic calendar edits — local release candidate

This package targets only Diriqo and test Supabase `wfcpfraxiuhuglnuaxqj`. It is prepared locally on `codex/diriqo-calendar-atomic`, based on main `1d65810391cbb3c45ae5c4f835d05ce18d51c47f` including the selected-company fix. No migration, hosted fixture or calendar data mutation has been applied by this package. Local checks below are not hosted or browser acceptance.

## Original acceptance boundary

C06-03: “Souběžné přesunutí stejné události dvěma vedoucími vyvolá řešitelný konflikt, ne tiché přepsání.”

The current supported calendar writers remain `company_admin` and `super_admin`. This change does not grant the existing `manager` role access to administration pages. Calendar entries representing jobs still open the job editor; concurrency of job scheduling is a separate path, not established by this event contract.

## Contract and scope

- A database snapshot reads one event, its complete assignment set and an opaque decimal revision from one MVCC snapshot.
- Create, update and delete use authenticated atomic RPCs. Updates and deletes require the loaded revision; stale revisions return `PT409` / `CALENDAR_STALE`. No business conflict uses retryable serialization SQLSTATE `40001`.
- Header and assignment changes commit together. Existing assignment IDs and timestamps survive when the assignment is retained. Revisions also cover changes initiated by foreign-key actions; callers must treat the revision as opaque rather than expecting exactly one increment.
- Direct table DML is removed so an old or direct client cannot bypass revision, company or module checks. Mutation authority checks active profile/admin membership, same-company job and worker memberships, the existing `core.calendar.manage` capability and calendar module setting. Authorization is revalidated after waiting operations.
- New writes synchronize the legacy time and event aliases. The migration refuses conflicting aliases and invalid assignment ownership instead of rewriting existing choices. Snapshot reads remain available without an active paid capability for authorized administration of retained history.
- Server reads explicitly filter the selected company. Editor options come from active memberships of that company; lists paginate instead of silently accepting a truncated first page. A bounded read fails visibly rather than reporting incomplete success.
- The UI retains the user's draft and original revision when another editor wins. It shows the current saved snapshot where authorized, blocks blind resubmission, and requires confirmation before replacing the draft with the latest version. Unknown write outcomes similarly require reconciliation. Browser dates are sent with explicit timezone information.

## Data preservation and rollout

The read-only preflight reports four existing calendar events and four assignments with no alias conflicts, orphans, duplicate logical assignments or cross-company job links. See `calendar-preflight-20261018.md` for the observed schema, actual ACL/RLS and exact source of this statement.

A separate release-owner backup captured the four events, four assignments, columns, constraints, indexes, policies, table/column grants, triggers, ownership and RLS on 18 October at 19:27:35 UTC. Managed artifact: `artifacts/calendar/pre-migration-backup-20261018.json`, SHA-256 `f359d003580f328226577ce7e390b9568834c010d0696978148c8e7d732335d1`. It is a targeted object/data snapshot, not a proven full-database restore point. Recheck the exact current row fingerprints and metadata immediately before any approved apply.

Apply and application release must be coordinated. After the database migration, the old deployed web version's split direct writes will fail closed until the RPC-capable application is deployed. Document and minimize this calendar-write interruption. Reads remain separately authorized. A rollback must retain an RPC-capable application or disable calendar writes; restoring unsafe direct grants is not a valid rollback. Preserve existing and newly committed records and prefer a reviewed forward repair over destructive schema reversal.

## Verification boundary

The action/DAL tests call the real server entry points with mock Auth and database ports. UI handler tests execute the actual components with a lightweight hook runtime; they do not establish browser layout, framework scheduling or a live two-user interaction. The SQL runner uses an isolated PGlite PostgreSQL engine, actual migration and shared capability evaluator, with a deliberately simplified Auth/Core schema. It reads no database URL or credentials and makes no network request.

Implementation checkpoint: `7d94d318d9a3e0ff91a6bace496b5308272894d1`, 18 October 2026. Local validation passed:

- Full Vitest: **63 files / 1,686 tests**, including 44 action/DAL and 10 UI-handler checks.
- Uncached TypeScript, targeted ESLint and production Next.js 16.4.2 webpack build, including 107/107 generated pages. Build used deliberately nonfunctional Supabase values; it did not connect to hosted data.
- Local PostgreSQL: **66 contract cases + 4 cleanup assertions**, plus rejection of a conflicting pre-migration alias. Separate **12 paid-selection cases + 2 cleanup assertions** use the simplified local receipt schema and must never run on hosted Supabase.
- Diff whitespace validation. The 73 original scenario IDs and texts are preserved; C06-03 moves from a known implementation defect to partial acceptance, not complete acceptance.

Immutable SHA-256: migration `08fa80e9e55c636f7a3dd10fd19b6d9e69800de0f2fade2043dde2cc3e2a32f7`; hosted-compatible SQL suite `21940f91a29408e42cf7e832e3ed53d2e964622b3097a215ccd5504658001b46`; local-only paid suite `7f32d8ed5e1bf8201d65db287f28de8d072beee1b6d0e4d0219124ab4221f758`.

Initial UI test startup failed because the harness lacked a `server-only` mock and treated asynchronous dictionary loading as synchronous. Both harness issues were fixed before the successful targeted and full runs. The restricted Windows runner also rejected Vite process spawning; the successful runs used the approved local execution path. These attempts are not presented as successful tests.

Hosted sequential SQL, actual overlapping Auth/HTTP edits, lock-wait reauthorization and two authenticated UI sessions are still pending. The local paid cases do not prove payment provenance or a real paid-receipt barrier. Complex privileged owner/FK deletion concurrency may abort atomically and is not claimed as a proven successful workflow. C06-03 is not declared complete by local tests alone.
