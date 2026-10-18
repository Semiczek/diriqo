# Next.js security update — 2026-10-18

## Change and security boundary

Upgrade `next` and `eslint-config-next` from 16.2.0 to 16.4.2. Keep React/React DOM
19.2.4 and the reviewed Office 0.3.4 archive unchanged. No migration, billing,
tenant policy, PDF export or production configuration change is included.

The public offer form calls a Server Action with a token, version and FormData.
The framework decodes that request before the action validates its token. That
makes the framework's RSC deserialization boundary relevant even though Diriqo's
action authorization stays server-side. The update uses the patched upstream
implementation rather than changing the public offer protocol or bypassing its
guards.

Primary advisories checked:

- [GHSA-m99w-x7hq-7vfj](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj): App Router / Server Actions denial of service; fixed from 16.2.11.
- [GHSA-q4gf-8mx6-v5v3](https://github.com/vercel/next.js/security/advisories/GHSA-q4gf-8mx6-v5v3): RSC deserialization denial of service; fixed from 16.2.3.
- [GHSA-8h8q-6873-q5fj](https://github.com/vercel/next.js/security/advisories/GHSA-8h8q-6873-q5fj): RSC deserialization denial of service; fixed from 16.2.5.
- [Next.js 16.4.2 release](https://github.com/vercel/next.js/releases/tag/v16.4.2).

No denial-of-service or code-execution payload was sent to a live application.
Evidence is the verified patched package, upstream advisory ranges, the absence
of `next` from the new npm audit, and real bundled RSC codec controls. This is not
a claim that a private upstream exploit was reproduced locally.

## Required compatibility changes

Turbopack 16.4.2 attempted to bundle the Office server worker's neighboring files,
including CSS and license notices. `serverExternalPackages` now names only
`@diriqo/office/server`, keeping that Node worker native while the Office client
continues to bundle. Existing worker and license output tracing remains in place.
The build trace includes the server entry, import worker, package metadata and
notices. Externalizing the whole Office package was rejected because it broke the
client build. See [the supported Next.js option](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages).

The new supported React Hooks plugin reported 19 errors in existing components.
Effective rule comparison showed these rules already had error severity; their
analysis changed with the plugin. No rule was disabled, downgraded or ignored.
The compatibility edits make existing event handling, prop synchronization and
rendering boundaries explicit:

- Keep request loading inside its effect or the explicit refresh event; cancel
  stale advance-list updates and retain module purchase/abort guards.
- Read the new-customer query with `useSearchParams` under Suspense. Keep Diriqent
  data authorization inside its try/catch and construct JSX afterward.
- Keep inventory retry references in event handlers, and invalidate dashboard
  context only through the company-switch handler.
- Reconcile edited job/communication/quote state only when the source snapshot
  changes. Key job state by job ID. Supply the nearest-shift clock with each server
  snapshot so both hydration and later refreshes use the same current reference.
- Subscribe to company-keyed note storage and preserve unsaved notes after a write
  failure. Reset photos by job key and fetch on explicit expansion.

Four warnings from the new internal-navigation rule remain visible. In particular,
company switching still performs a full navigation to clear old company state.

## Dependency review

`vendor/host-dependency-review-20261018.json` records the separate host review:
76 changed lock records, 69 registry archives verified against their SRI, six
existing bundled metadata records and one unchanged-archive metadata record.
No unknown declared licenses or changes to existing declared SPDX expressions
were found. Upstream notice changes and existing Sharp/libvips LGPL and
caniuse-lite CC-BY obligations are explicitly recorded. This technical check is
not a legal compliance certification and does not extend the Office-only license
allowlist to host dependencies.

The existing host dependency guard remains enforced with the reviewed hashes.
Full original and updated npm audit JSON and the archive/source notice evidence
are retained in the local review artifact collection. Audit totals decreased from
25 affected packages (1 critical, 15 high, 8 moderate, 1 low) to **18 affected
packages (11 high, 7 moderate, 0 critical)**. The remaining other dependency trees,
including development-tool transitive findings, require separate triage. Audit
package counts are not counts of proven exploitable application paths.

## Validation and limits

- `node scripts/check-office-package.mjs` and clean `npm ci`: PASS.
- TypeScript `tsc --noEmit`: PASS (2 GiB local heap).
- ESLint: PASS, zero errors and four visible navigation warnings.
- Vitest: 1,490 tests passed in 53 files.
- Platform foundation: 18 passed.
- Office contracts: 56 passed, one optional PGlite check skipped because the
  approved PGlite runtime was not available. No new dependency was installed for it.
- Next.js 16.4.2 Turbopack production build: PASS, 106 static pages generated.
- Eight real production RSC codec controls passed across the bundled Webpack and
  Turbopack implementations: JSON, offer-shaped token/version/FormData, bounded
  nested values, and malformed JSON rejection.
- Nine browser runtime controls passed using installed React/React DOM 19.2.4 in
  headless Chrome: note SSR hydration, persistence, company reset, storage events,
  failed-write fallback, fallback isolation, photo expand, late old-job response,
  and collapse/reopen without a duplicate request.

The browser checks used an owned localhost fixture with synthetic data. The
components and React runtime were real; i18n, layout, image and API boundaries
were mocked. These checks are not authenticated live acceptance. The retained
helper sources and logs identify those boundaries. No production deployment,
database change, physical Android test or live payment was performed for this PR.
