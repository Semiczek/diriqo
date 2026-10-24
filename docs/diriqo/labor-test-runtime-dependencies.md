# Labor SQL test dependency review — 2026-10-24

The mandatory labor SQL regression uses pinned development dependency
`@electric-sql/pglite` **0.5.9**. It executes the real migrations and RPCs in an
isolated local PostgreSQL runtime. Application code under `app`, `components`
and `lib` does not import this runtime. The runner does not contact hosted
Supabase or install dependencies.

## Reviewed delta

Compared with `0a987c75f8272c33d24bfbd7748b2f8d78806682`, the host lock adds
one package record and one root development-dependency declaration. No existing
package record is changed or removed, and production dependencies are unchanged.
The prior declaration and lock-package hashes match the existing reviewed baseline.
The previous jsdom review is retained and referenced by hash.

The exact registry archive matches the lock SHA-512 integrity. Its SHA-256 is
`10c57dd9d5b19f3b2cfed5c3c3794d0415b1a6a16f6da32a0f4d173b00be8d9d`.
All 308 installed files match that archive byte for byte. The package declares
Apache-2.0 and has no npm runtime/optional dependencies or install hooks.

## Bundled code and notices

No npm dependencies does not mean no bundled code. Source maps identify
pg-protocol, pglite-utils, async-mutex, tinytar and tsup runtime shims.
The review retains their notices together with the identified PostgreSQL/regex,
Emscripten/musl, ICU, zlib, XML/XSLT, OpenSSL and OSSP UUID attributions.
ICU's full notice is already embedded in the package virtual filesystem.

- `vendor/labor-test-runtime-review-20261024.json` records package integrity,
  the exact dependency delta, upstream release/source identities, source-map
  and binary observations, and links to the prior review.
- `vendor/labor-test-runtime-notices-20261024.json` retains **23 notice entries**
  with source URLs, source/text hashes and the actual notice text.
- `vendor/office-dependency-baseline.json` binds this separate review and the
  resulting declaration/lock-package hashes.

Exact XML/XSLT binary patch versions were not independently established; their
notice sources follow the pinned upstream release build recipe. This evidence
is an identified-component license/notice review, not an exhaustive native
object SBOM, a reproducible-build claim or a legal compliance certification.
The package is used in the development/test toolchain; redistribution must
retain the included notices and any applicable source obligations.

## Verification

`node scripts/check-office-package.mjs`: **PASS** after the separate review.
The check script, Office archive, Office license allowlist, asset evidence and
Office SBOM are unchanged. The failed GitHub run stopped before installation;
its failure is retained at
https://github.com/Semiczek/diriqo/actions/runs/40082418393.
The subsequent CI result must be reported separately from this local gate pass.
