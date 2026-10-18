# Office sharing release preparation

This is a preparation runbook, not evidence that the new feature has passed or shipped.
The user requested JSPD Hub. The shared library remains in the Diriqo repository,
but its new source branch must not be merged into or deployed as the Diriqo application.

## Reviewed checkout state

On 12 October 2026, GitHub was read and both `refs/remotes/github/main` refs were fetched:

- Hub local base `f2ea87f3bb2a6782c3a8489380299a42be0b3cf8`; upstream `5db7abc389f7b580b7bbbf66f876b144707d6b8d` adds one unrelated OCR invoice change.
- Diriqo local base `fc5b776`; upstream `ac07949537852d02fa69654433eb6353db052a1f` adds seven invoice-related commits.
- Working branches are `codex/hub-office-sharing` and `codex/office-sharing-library`. Creating them preserved the existing working changes.
- Fetch and branch creation do not merge those newer main commits. Refresh and incorporate upstream before the final release; never reset or overwrite other agents' changes.

Root `src` (27 files), `types` (25 files) and `database` (5 files) were byte-identical to
the canonical package at the initial inspection. Both hosts consumed the reviewed
0.1.0 runtime with SHA-256 `fc8b602dc57267f504bbd4d02788b8dc349f4cb03d282fe62008e9d0538e5c5a`.

## Scoped packaging

Do not run the historical `scripts/package-integrations.mjs`: it is an initial
bootstrap which rewrites both dependency baselines and the original Office migration.
Do not broadly rerun `scripts/prepare-canonical-source.mjs`: later root documentation
is not automatically the canonical library's reviewed documentation.

After all shared source, declaration and test edits are complete:

```powershell
node scripts/release-office-sharing.mjs prepare
node --experimental-strip-types --test tests/*.test.mjs
node scripts/typecheck.mjs
```

The preparation command first verifies both original license audits. It advances
only the proprietary package's own version from 0.1.0 to 0.2.0; exact third-party
declarations, resolutions, integrities, notice files and package fingerprints are
retained. The version-only metadata change is then reflected in the audit report
and SBOM through the existing offline report generator. It does not install anything.
It copies only `src`, `types`, and `tests` into the canonical package, excluding the
workspace-only release helper's own test. A missing canonical source is never silently
deleted, so intentional removals require a separate reviewed edit.

When the shared checks pass:

```powershell
node scripts/release-office-sharing.mjs release
```

This command builds the canonical package, creates one reviewed 0.2.0 archive, and
updates the two isolated vendor snapshots byte-for-byte. It preserves the old archive,
all historical migrations and host dependency baselines. It regenerates source
provenance and verifies the rebuilt runtime against the archive. Only the local Hub
Office installation is refreshed; no dependency installation, Git operation, migration,
production data write, or deployment runs. The exact release evidence is written to
`reports/office-sharing-package.json`.

The new Diriqo library branch has automatic Vercel deployment explicitly disabled.
Publish the source branch without merging/deploying the Diriqo application. Hub may
consume that immutable reviewed library release independently. Review and test Hub's
resulting changes before any Hub migration or release action.

## Test environments and limits

- Hub already contains PGlite 0.5.8 at `node_modules/@electric-sql/pglite/dist/index.js`.
  Its existing `node scripts/test-office-base-database.mjs` uses a fresh in-memory
  database and exact Office migration sources. Add the new sharing migration to the
  dedicated test fixture/runner; do not claim old SQL results cover it.
- PGlite models Auth contracts and sequential transactions. It does not prove real
  Supabase JWT validation, multiple-session locks, a deployed database, or production UI.
- `psql`, `pg_ctl`, and `docker` were unavailable on PATH at inspection.
- The previously authorized Supabase staging branches expire **12 October 2026 at
  19:00 Prague time (17:00 UTC)**, with cleanup scheduled five minutes earlier. Do not
  extend/recreate paid branches or run past that authorization based on a local
  manifest passing its freshness check.
- Until expiry, `scripts/staging-host.mjs hub build` / `start` use the isolated Hub
  staging and port 4331. Freshly verify the branch before any staging operation.
- After expiry, the root demo can exercise synthetic employee/company flows locally:
  shared build, `npm run demo:build`, then `node demo/server.mjs` at port 4320. Its
  alpha/beta synthetic sessions are not evidence for real Hub authorization.
- Windows Node tests can require an escalated process because the sandbox rejects
  child-process creation with `EPERM`; this is an execution issue, not a passing test.

The release helper's two focused metadata tests passed locally. No new shared build,
package, hosting deployment, or live sharing test was performed by this preparation.
