# React lifecycle test dependency review — 2026-10-24

The quote-operation regression needs actual React DOM mounting, unmounting and
state updates. Its new Vitest environment uses **jsdom 27.4.0**, a pinned development
dependency compatible with the existing Node 20 CI. The prior hook-only mocks
did not reproduce the confirmed-operation lock after a server-action refresh.

The reviewed delta is against commit
`9752b372622feb3b6356acb11f0dbbd066f85442`.
Its host declaration and lock-package hashes exactly match the previously
reviewed baseline. The new lock contains **41 added development-only records**,
representing **39 distinct registry archives**, with **zero changed or removed
existing package records**. The application and Office runtime declarations
are unchanged. Searching application, component, library and test source finds
jsdom only in the new test's Vitest environment directive.

## Evidence

- `vendor/host-dependency-review-20261024.json` records every exact package
  name, version, registry URL, lock SRI, archive SHA-256, declared license and
  license-notice hash.
- `vendor/host-dependency-notices-20261024.json` retains the actual notices,
  including upstream supplements and embedded W3C attributions.
- `vendor/office-dependency-baseline.json` binds this separate review by
  SHA-256 and records the updated host declaration and lock-package hashes.

Every downloaded archive matched its lock SRI and package name/version/license.
Forty notice records were present in the package archives. The remaining package,
saxes 6.0.0, omits its license file from the published archive; the complete ISC
notice and its retained historical MIT notice were recovered from
[the exact upstream commit recorded by the registry](https://raw.githubusercontent.com/lddubeau/saxes/211fa0ebec9b628affc09219199639887174bfc3/LICENSE).
No unknown declared license or changed existing license expression was found.

## Additional notices

The declared-license inventory is MIT (30 package locations), BlueOak-1.0.0 (3),
MIT-0 (2), BSD-2-Clause (2), ISC, CC0-1.0, BSD-3-Clause and Apache-2.0 (one each).
The three BlueOak records share one exact lru-cache archive. Their complete
notices are retained.

The archive for `@csstools/color-helpers` also contains W3C-derived conversion
code. Its 31 distinct attribution comments and the referenced
[W3C 2015 Software and Document License](https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document)
are included in the notice bundle.

The tldts code declares MIT. Its generated suffix trie uses Public Suffix List
data whose exact source submodule declares MPL-2.0. The review records the
[versioned data source](https://raw.githubusercontent.com/publicsuffix/list/52b71b3c4576ff77450cc7ebcfc7f34a916af3f9/public_suffix_list.dat),
its SHA-256, the original notice and the complete MPL text. The sibling tldts-core
parser does not contain this generated trie. Redistribution of the development
toolchain must preserve the relevant notices and data-source availability.

## Validation and boundary

`node scripts/check-office-package.mjs`: **PASS** after the separate audit
and baseline update. The check script, Office archive, Office license allowlist,
asset evidence and Office SBOM were not modified.

The actual React regression suite and existing quote UI suite passed **48 tests**.
Against the original hook, the new suite reproduced two failures; the other nine
new guard scenarios passed.

This host development-dependency review does not claim that these dependencies
satisfy the narrower Office allowlist. Existing host dependency obligations remain
unchanged. Registry integrity, package identity and identified notices were
reviewed; the evidence is not a certification of legal compliance for every
possible redistribution.

