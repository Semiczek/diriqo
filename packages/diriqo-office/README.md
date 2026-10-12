# Diriqo Office – canonical source

This directory is the single editable source of `@diriqo/office` for Diriqo and JSPD Hub. The project-owned code is proprietary (`UNLICENSED`); public repository visibility does not grant a third-party license. The OSS dependency and asset notices remain in `licenses/`, `THIRD_PARTY_LICENSES.md`, `LICENSE_AUDIT.md`, `ASSET_LICENSES.md` and `sbom.cdx.json`.

Both applications consume the same reviewed `vendor/diriqo-office-0.1.0.tgz`; Hub does not maintain a second editor implementation. Changes to the shared code belong here. `SOURCE_MANIFEST.json` identifies every reviewed source file by SHA-256 and binds that source snapshot to the immutable runtime archive. The enclosing Git commit provides its immutable repository revision. The manifest is an integrity record, not a signature or production approval.

## Reproduce the shared checks

Use Node 22.18+ or 24+, with the already reviewed dependency lockfile:

```sh
node scripts/check-source-provenance.mjs
node scripts/licenses.mjs --check
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
node scripts/check-source-provenance.mjs --runtime
```

The dedicated `office-shared.yml` workflow performs these checks using a preinstalled supported runner Node. It runs every top-level shared test, including genuine negative license checks. It installs no office SDK, license key or cloud account, and makes no database calls. Dependency changes require the separate `license:preflight` audit and review **before installation**. CI never regenerates the license evidence or source manifest.

The runtime check compares the newly built JS, CSS, notices and declarations with the archived runtime actually used by both hosts. Rebuilding does not update either host archive. A deliberate runtime change must be reviewed, packaged once, copied byte-for-byte to both hosts, and have its lockfile integrity and source provenance updated together.

`tests/host` contains additional host integration tests. Their existing runner requires both actual host checkouts and Next runtime in the original integration layout; they are not included in `npm test` and are not silently reported as passing by shared CI. SQL runners and live staging/printing tools also require their documented separate environments. Historical staging results and account credentials are deliberately absent from this source directory. See `docs/ENABLEMENT.md`, `docs/TESTING.md`, `docs/LIMITATIONS.md` and `docs/NORMALIZED_PERSISTENCE.md`; the required SQL order is core plus the correct host adapter, normalization, then the separate receipt-commit correction.

The staging/provisioning/release scripts retained here are reviewed source and test dependencies, not automatic workflow steps. Tools referring to `integrations/*`, `reports/*` or `.staging/*` require the isolated integration workspace described in their runbooks. CI does not invoke them, publish, enable Office for a company, or apply migrations. The normal application imports only the vendor archive; this directory has its own build and test boundary.

After an intentional source-only edit, run `node scripts/check-source-provenance.mjs --write` and review its manifest diff. Do not edit the archived runtime or license evidence to make a failing check green.
