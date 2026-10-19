# XLSX compatibility and cached previews

## Import behavior

The OOXML importer resolves SpreadsheetML and relationship namespace URIs, including prefixed XML parts. Shared formulas are expanded from their declared master and range with Excel relative, absolute and mixed A1 references. Missing, duplicate or out-of-range shared masters are rejected; shared formulas are not silently replaced with values. Formula cached numbers, text, empty strings and booleans survive XLSX export/reimport. Other supported formatting remains deliberately partial, and the original upload remains available byte-for-byte.

Dependency analysis indexes formula cells by sheet/column/row. It does not allocate every coordinate in a large referenced range. Storage/import remains bounded at 8,000 formulas, 15 million total reference accesses, 1 million formula characters, 200,000 dependency checks/edges and a dependency depth of 2,000. Existing per-formula length, token, nesting, range, cell and archive limits still apply. Final validation runs inside the isolated import worker.

## Editing boundary

The interactive engine retains its previous 2,000-formula and 200,000-reference-access budget. A larger accepted import receives the persistent workbook field officeCalculationMode = cached-readonly-v1. Its paginated preview reads stored values directly and never mounts the Fortune workbook or recalculates formulas. The UI explains that the values came from the upload and that editing currently requires downloading the original and opening it in Excel.

The existing Fortune parser eagerly evaluates IF arguments. A measured complex workbook produced incorrect errors in unused branches; changing only the IF callback is insufficient, and intercepting operator errors also changes unary error semantics. No speculative evaluator patch or silent value flattening was introduced. Preview is a compatibility fallback, not a claim of complete Excel calculation support.

Editor callbacks, generic/local service mutations and the Supabase adapter block save, proposal, approval and restore operations for an existing cached preview. Metadata operations, copies and exports remain available. The adapter reads current stored content before deciding, so removing the flag from an incoming save does not bypass this check. Incoming oversized interactive saves are rejected too.

The Supabase adapter checks are application-server checks. The host's authenticated office_request RPC requires its own database guard to prevent old or direct clients from changing an already marked snapshot; package tests alone do not establish that a host migration is installed. Existing RPC expectedRevision checks remain necessary for concurrency. Imported preview content and formula caches must stay immutable while metadata operations remain allowed.

## Local evidence (2026-10-19)

All five user-selected FNOL XLSX files imported and validated locally. Three smaller files remained editable: 236, 10 and 20 formula results respectively matched their Excel cached values with zero mismatches. Two larger files each retained all 5,972 formulas and opened under the cached-preview policy. Each had 12,089,773 reference accesses but only 1,343 formula dependency edges. Their interactive runtime calculation was blocked. The local imports took approximately 0.75–1.05 seconds each; this is local diagnostic timing, not a production service-level guarantee.

For all five files the diagnostic confirmed exact formula and cached-value export/reimport preservation and unchanged SHA-256 of the original files. It did not upload the source workbooks. The standalone local script scripts/diagnose-xlsx-local.mjs accepts explicit paths and prints only filenames, hashes, counts, timings and comparison totals. It does not print cell text or formulas. Do not commit customer files as fixtures.

The source suite passed 293 tests and TypeScript passed. Tests include namespaces, shared formulas, bounded dependency graphs, cached-value types, persistent preview state, blocked service mutations, hosted adapter behavior and actual Workspace save/restore callbacks. This evidence does not establish a deployed host, live authenticated upload, database migration installation or full fidelity of Excel formatting.
