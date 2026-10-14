# Diriqo Office – předání nasazení do main

Stav **12. 10. 2026**: Office je sloučené do obou `main` a nasazené na `app.diriqo.com` a `hub.jspd.cz`. Přihlášený Chrome ověřil otevření Office ve správné firmě a průchod hlavním menu. Nezávislé živé čtení potvrzuje přesný produkční katalog i všech osm migračních záznamů. Diriqo i Hub main CI jsou celé zelené; nový Hub main běh potvrdil také skutečný PostgreSQL 17 a Android POS. Doplněné přesné produkční originy jsou aktivní v nových nasazeních stejného zdrojového kódu a oba hosty prošly negativním UI testem importu. **V produkci nebyl uložen testovací dokument. Úspěšné úpravy, importy, izolaci dvou firem a souběžné ukládání dokazují stagingové testy; fyzická pokladna a tiskárna ověřené nejsou.** Tento dokument je interní a obsahuje technická produkční metadata.

## Stav předání

| Oblast | Stav | Důkaz / hranice |
| --- | --- | --- |
| CI aktuálních PR obou hostů | PASS | Hub `1ce110f8…` a Diriqo `fc5b7761…`, přesné testované merge commity níže. |
| Diriqo main CI | PASS | `bfa6514e…`: 1 034 Vitest + 11 Office + 186 sdílených testů, TypeScript, lint, build a licence PASS. Tree je totožný s testovaným PR. |
| Hub main CI | PASS | `12c1803a…`: všech 9 jobů SUCCESS; web 1 823 PASS / 7 SKIP, Office SQL 68 PASS, PostgreSQL 17 163 PASS, Android backend PostgreSQL 24 PASS a povinných 5 HTTP/PostgreSQL scénářů; build, typy, lint a licence PASS. |
| Firemní oprávnění a migrace v místním PostgreSQL | PASS | Hub 68, Diriqo 72 kontrol; minimální fixture, sekvenční PGlite. |
| Vzdálené stagingové RPC | PASS | 272 kontrol pro každý host, dvě firmy a skutečné Auth účty; nejde o browser UI. |
| Veřejný staging přes HTTP | PASS | Hub 50, Diriqo 48 kontrol; importní worker, originály, exporty a role. |
| Hub čerstvé přihlášení a výběr firmy | PASS | 24 HTTP kontrol bez předvyplněného firemního cookie. |
| Produkční nastavení a základní RLS | READBACK PASS | Hub 4/4, Diriqo 3/3 firmy enabled, žádné chybějící nastavení, žádná Office tabulka bez RLS. |
| Produkční funkce a migrační ledger | VERIFIED | Katalog Hub 265/265, Diriqo 262/262; historie 8/8 EXACT včetně názvů, UTF-8 bytů a SHA-256. |
| Sloučení PR do main | MERGED | Diriqo `bfa6514efce88df13abf506eb4c487af054b2868`, Hub `12c1803ae2feccc58048e2af2b3853798df53efa`. |
| Produkční deployment / přihlášený Office průchod | READY, READ-ONLY SMOKE PASS | Oba produkční aliasy směřují na uvedené main revize; Chrome otevřel správnou firmu a ověřil Office ↔ hlavní menu, bez produkčních zápisů. |
| Produkční domény pro upload a negativní UI import | PASS | Přesné `OFFICE_PUBLIC_ORIGIN` pro každého hosta, redeploy stejného main; neplatný DOCX vrací `OFFICE_FORMAT` před persistencí. |
| Nativní tisk a fyzická kasa | NEOVĚŘENO | Stažený PDF ani browser smoke nejsou důkazem fyzické tiskárny, terminálu nebo zásuvky. |

Zdroje stavu CI: [aktuální Hub PR](../reports/hub-final-ci-1ce110f8.json), [Hub main](../reports/hub-main-ci-12c1803a.json), [Diriqo PR](../reports/diriqo-office-fc5b776-ci.json) a [Diriqo main](../reports/diriqo-office-main-bfa6514-ci.json). [Předchozí obouhostový snapshot](../reports/office-main-current-ci.json) zůstává historický; starší reporty samy necertifikují novější Git revize ani produkci.

## Přesné revize a CI

| Host | Hlavička PR | Skutečně testovaný merge | CI výsledky |
| --- | --- | --- | --- |
| JSPD Hub, PR 15 – aktuální head | `1ce110f885bb4ae144b45e286e8c72b7bc0d93f0` | `ad6268530887b238daf27cd0a7a1759d3fa41978`, základ `de4cfee2d2544f617c6de021524d74a85b560451` | Web 1 823 PASS, 7 SKIP, 0 FAIL; samostatný PostgreSQL 17 a Android job PASS; Office base SQL 68 PASS, build 143 stran. |
| Diriqo, PR 14 – předchozí head | `5cf7e73305815c6d81b0749bbd66dd36e0939002` | `57fc4a28e0b458f9e12e790ce931f8ab4c87d491`, základ `4a0de93a2968221a77e34e641ee839c3bd85c069` | Vitest 1 017 PASS; Office kontrakty 11 PASS; sdílené jádro 186 PASS. Historický CI pro předchozí základ. |
| Diriqo, PR 14 – aktuální odeslaný head | `fc5b7761fa8f86be4736392b722123dac8471adc` | `1a7e02f70539f9aa31c3da352a77346768220160`, základ `0f4f69136e28f67a0b7f58e6f726362f4e3bd435` | CI Vitest 1 034 PASS ve 42 souborech, Office 11 PASS, sdílené jádro 186 PASS; TypeScript, lint, build 105 stran a licence PASS. |

Hub aktuální PR: [audit-quality](https://github.com/Semiczek/jspdhubhotovy/actions/runs/38235340221). Historický Diriqo head `5cf7e73`: [CI](https://github.com/Semiczek/diriqo/actions/runs/38229562435), [sdílené zdroje a licence](https://github.com/Semiczek/diriqo/actions/runs/38229562395). Reporty evidují také jednotlivé buildové, typové, lintové a další požadované joby. Sedm přeskočených Hub web testů zůstává SKIP; samostatný PostgreSQL job neopravňuje označit všechny přeskočené scénáře za provedené.

Poslední Diriqo PR head má [CI 38235290518](https://github.com/Semiczek/diriqo/actions/runs/38235290518) a [shared CI 38235290545](https://github.com/Semiczek/diriqo/actions/runs/38235290545), oba SUCCESS. Oba decoded job logy potvrzují checkout stejného merge `1a7e02f7` s přesným head `fc5b7761` a základem `0f4f6913`. Sdílený job ověřil 129 balíčků a 1 font před instalací i po buildu a 38 runtime souborů proti archivu. Původní JSON zachovává tehdejší otevřený PR jako historický snapshot.

PR 14 se následně sloučil do Diriqo main `bfa6514e`. GitHub Git Data API potvrzuje pro main, testovaný merge `1a7e02f7` i head `fc5b7761` totožný tree `7615e31861eb9e919e4c232ef8ec65e58f00ef62`. Nové push workflow [CI 38237205748](https://github.com/Semiczek/diriqo/actions/runs/38237205748) a [shared CI 38237205953](https://github.com/Semiczek/diriqo/actions/runs/38237205953) jsou SUCCESS. Jejich logy potvrzují přesný checkout main a opakovaně 1 034 + 11 + 186 testů, build a licenční kontrolu. Nebyl spuštěn žádný ruční rerun; [uložený výpis důkazů](../reports/diriqo-office-main-bfa6514-ci-evidence.log) doplňuje strojový report.

Hub main `12c1803a` má tree `225e63de8614aa21182ef3a2afd1f5cc253ab0fe`, shodný s head `1ce110f8` i testovaným merge `ad626853`. Nové push workflow [main audit-quality 38237219773](https://github.com/Semiczek/jspdhubhotovy/actions/runs/38237219773) i [Office dependency guard 38237219826](https://github.com/Semiczek/jspdhubhotovy/actions/runs/38237219826) jsou SUCCESS. [Webový log](../reports/hub-main-ci-12c1803a-web-tests.log) potvrzuje přesný checkout main, 1 830 testů / 1 823 PASS / 0 FAIL / 7 SKIP a Office SQL 68 PASS. [Build log](../reports/hub-main-ci-12c1803a-hub-build.log) potvrzuje 143 vygenerovaných stran. [PostgreSQL a Android log](../reports/hub-main-ci-12c1803a-postgres-android.log) dokládá 20 sad se 163 PASS a 0 SKIP v čerstvém PostgreSQL 17, dalších 24 backendových PostgreSQL testů bez přeskočení a Android `testDebugUnitTest`, `assembleDebug`, `lintDebug` s výsledkem BUILD SUCCESSFUL za 11 min 41 s. Úspěšný runner následně ověřil XML všech pěti povinných `OutboxLedgerHttpTest` HTTP/PostgreSQL scénářů s nulovým počtem přeskočení, chyb a selhání; XML nebylo při tomto auditu stahováno samostatně. Jde o skutečný main běh bez ručního rerun, nikoli převzetí výsledku PR. Tento CI důkaz nepotvrzuje produkční konfiguraci ani fyzické zařízení.

Pozdější Diriqo základ `4a0de93a` přidává fakturační DELETE invariant, SQL test a dokumentaci. Zelené předchozí PR CI již testovalo spojení s tímto základem. Následující `0f4f6913` přidává unikátnost čísel faktur podle firmy, bezpečné zpracování fakturačních chyb a další testy. Diriqo Office větev jej nedestruktivně začlenila do `fc5b7761`; Office, menu, proxy, POS ani sdílené zdroje/archiv se při merge nezměnily. Logy nového místního běhu: [Vitest](../reports/diriqo-main-invoice-merge-vitest.log), [Office](../reports/diriqo-main-invoice-merge-office.log), [TypeScript](../reports/diriqo-main-invoice-merge-typecheck.log), [lint](../reports/diriqo-main-invoice-merge-lint.log). Fakturační SQL ani jeho souběžný živý test tento místní běh nespouštěl.

## Jediné sdílené jádro a licence

Kanonické zdroje: `Semiczek/diriqo/packages/diriqo-office`, obsahový SHA-256 `d844f69bb86553869de0b0ede504c11910c63fb72e2cc7105dd4ecaf7d274769`. Oba hostitelé používají `vendor/diriqo-office-0.1.0.tgz`, SHA-256 `fc8b602dc57267f504bbd4d02788b8dc349f4cb03d282fe62008e9d0538e5c5a`. Aktuální CI potvrzuje 514 souborů kanonické evidence a shodu znovu sestaveného runtime s archivem. Tento krok neměnil sdílený runtime.

Tiptap OSS a FortuneSheet mají ověřené otevřené základy; kontrola před instalací hlídá lockfile, závislosti, zachované notices, SBOM a vložený OFL font. Nejsou zavedené placené kancelářské pluginy, aktivační klíče ani cloud výrobce pro základní editaci. To neznamená bezplatnou databázovou infrastrukturu nebo absolutní právní imunitu.

## Office v základu a firemní oprávnění

Office je základní funkce všech existujících i budoucích firem. Čtvrtá migrace doplňuje zapnuté nastavení pouze firmám, které jej dosud nemají; existující hodnoty i metadata včetně výslovného `enabled=false` zachovává. Nová firma dostane nastavení ve stejné transakci jako svůj vznik. Replay migrace ani běžná aktualizace firmy dřívější administrátorské vypnutí nepřebijí.

Změna odstraňuje pouze Office podmínku placeného `core.files.upload`. Ostatní placené moduly, jejich ceny, předplatná a DiriPOS oprávnění zůstávají beze změny. `company_id` je součástí datových klíčů, vazeb a zámků souborů, verzí, originálů, návrhů, auditů a idempotentních účtenek. Server i RPC znovu ověřují identitu, aktivní členství, roli a zapnutí firmy. `ownerId` souboru zůstává vynucený v příslušných operacích; individuální sdílení ACL není implementované.

V Diriqo jsou `super_admin`/`company_admin` vlastníci Office, `manager` editor a `worker` čtenář. Čtenář může číst/exportovat oprávněný dokument, nemůže zapisovat ani schválit změnu AI. Diriqo nadále odmítá nesoulad `auth_user_id` s přihlášenou identitou i rozporné legacy `user_id`. Hub ponechává vlastní role a autorizační adaptér. Při změně firmy se starý panel pozastaví; klientské firemní ID samo oprávnění nedává.

[Místní SQL důkaz](../reports/database-base-access-validation.json) obsahuje rollback migrace, zachování vypnutí, vznik nové firmy, RLS a revokované přímé granty, dvě firmy, čtenáře, zápis při zamítnutém placeném evaluatoru, idempotenci, konflikty revizí, zákaz cizí vazby a lidské schvalování. Jde o 140 kontrol přes přesné čtyři migrace; tato fixture sama neprokazuje reálné JWT, tarifní evaluator nebo plánování souběžných databázových relací.

## Nové stagingové důkazy

| Host / vrstva | Výsledek | Report |
| --- | --- | --- |
| Hub RPC | 272 PASS, 0 FAIL, 181 požadavků | [staging-hub.json](../reports/staging-hub.json) |
| Diriqo RPC | 272 PASS, 0 FAIL, 181 požadavků | [staging-diriqo.json](../reports/staging-diriqo.json) |
| Hub veřejný HTTP | 50 PASS | [public-staging-hub-http.json](../reports/public-staging-hub-http.json) |
| Diriqo veřejný HTTP | 48 PASS | [public-staging-diriqo-http.json](../reports/public-staging-diriqo-http.json) |
| Hub čerstvé přihlášení | 24 PASS | [fresh-login report](../reports/staging-hub-fresh-login-dpl_FKGfirrkYgveAENvaKjy2v46pakW.json) |

RPC používají skutečné Auth účty dvou syntetických firem a ověřují odmítnutí cizího přístupu, obnovu verzí, návrhy AI a souběžně odeslané zápisy. Konfliktní uložení má jednoho vítěze, přesný opakovaný klíč nevytvoří druhou změnu a rozdílný obsah pod stejným klíčem se odmítne. Tyto REST kolizní scénáře nejsou úplným zátěžovým benchmarkem. Zdrojové reporty poctivě ponechávají `acceptanceReady=false`; chybějící externí důkaz se nesmí změnit na PASS pouhým součtem testů.

HTTP kontrola zahrnuje přihlášení, Office HTML, skutečný nasazený importní worker, nezměněný originál, DOCX/XLSX export, zachování dvou listů a vzorce SUM, stažení PDF, negativní role/firmy/originy a reprezentativní sešit s 20 000 buňkami. Hub čerstvý login nepředpokládá firemní cookie: uživatel se dvěma členstvími musí firmu vybrat, podvržené ID je odmítnuté a nesmí nahradit poslední oprávněný kontext.

READY stagingové deploymenty v těchto HTTP reportech jsou Hub `dpl_FKGfirrkYgveAENvaKjy2v46pakW` a Diriqo `dpl_3gqkb7FWDueWbi1ii5Mb4dwXGAWL`. [Živý záznam Vercel](../reports/office-staging-deployment-source-20261012.json) potvrzuje SHA Hub `d3ad7cc4a92aa2600357dbc02c85abe0cc7c3c64` a Diriqo `5cf7e73305815c6d81b0749bbd66dd36e0939002`. Jsou to předchozí release revize, nikoli následné main merge commity. Scoped Git diff Office UI/API/adaptérů, sdíleného archivu a čtyř Office migrací je vůči konečnému testovanému stromu prázdný; následný main CI kontroluje také začleněné změny ostatních modulů. Adresy a expirace jsou v [public-staging-targets.json](../reports/public-staging-targets.json). Staging končí 12. 10. 2026 v 19:00 Praha, plán úklidu je 18:55. Rozpočet nebyl prodloužen.

## Produkční migrace a ledger

[Produkční preflight](../reports/office-main-production-preflight-20261012.json) eviduje před zahájením nulový počet Office relací v obou hostech a kontrolu nepřítomnosti názvů `OFFICE_STAGING` v projektových i sdílených Vercel proměnných. Preflight sám není potvrzením následného stavu.

První pokus produkční Diriqo migrace přes konektor skončil technickou chybou `Invalid/expired requestState`; následné čtení tehdy ukázalo prázdný Office katalog i historii. Koordinátor následně provedl všech osm SQL migrací přes přihlášený Chrome. [Živý souhrnný readback z 10:25:44 UTC](../reports/office-production-base-settings-20261012.json) nyní potvrzuje:

| Host | Firmy / enabled | Chybějící nastavení | Office tabulky bez RLS | Trigger pro nové firmy | Přímé EXECUTE triggeru anon / authenticated |
| --- | --- | --- | --- | --- | --- |
| Hub | 4 / 4 | 0 | 0 | 1 | false / false |
| Diriqo | 3 / 3 | 0 | 0 | 1 | false / false |

[Advisor před/po](../reports/office-production-advisors-20261012.json) přidal u každého hostu 11 očekávaných INFO `rls_enabled_no_policy` na uzavřených `office_private` tabulkách, které nejsou přístupné klientům. Přibyly pouze WARN pro záměrná ověřovaná authenticated RPC: Diriqo 3, Hub 4 včetně `office_company_labels`. Nepřibylo varování pro anonymní SECURITY DEFINER EXECUTE ani proměnlivý search_path. Nejde o pokyn přidat na soukromé tabulky veřejné policies. Následná nezávislá kontrola katalogu potvrdila přesná těla funkcí, sloupce, constrainty, indexy, triggery, RLS a účinné granty: Hub 265/265, Diriqo 262/262, bez rozdílů; všechny Office funkce vlastní `postgres`.

**Produkční katalog a migrační historie jsou ověřené.** [Záznam provedení](../reports/office-production-migration-execution-20261012.json) odděluje první Diriqo UI odpověď, která zůstala viset po databázovém COMMIT, od sedmi explicitních úspěšných UI odpovědí. První soubor nebyl spuštěn podruhé; výsledek potvrdilo čtení hostitelských definic. Následný guarded zápis historie nejprve znovu ověřil katalog a konfliktní existující záznam by odmítl. [Nezávislý konečný readback z 10:34:49 UTC](../reports/office-history-verification/production-catalog-history-final.json) potvrzuje 8/8 EXACT; [podrobný postup](OFFICE_MIGRATION_HISTORY_VERIFICATION.md) eviduje omezení. Nebyl proveden syntetický produkční dokumentový DML test.

| Host | Pořadí / lokální migrace | Serverová verze, transcript, hash a readback |
| --- | --- | --- |
| Hub | 1. `20261011140000_diriqo_office.sql` | `20261011140000`, EXACT, 40 641 bytů, SHA-256 `78ea3ad806b58d16a91837531347e97ec951412997ee2fcc754f4c380a4a1d7c` |
| Hub | 2. `20261011184841_diriqo_office_normalized.sql` | `20261011184841`, EXACT, 51 187 bytů, SHA-256 `caa62e220e12779b3833f15fd9505cabd2e45186904c02214cfb13e0f7fa3e4e` |
| Hub | 3. `20261011185515_diriqo_office_receipt_commit.sql` | `20261011185515`, EXACT, 601 bytů, SHA-256 `4bf7b3c713a0f46e2723ef3bc6a605238821f7fe1051767e7236b3815b85ddef` |
| Hub | 4. `20261012091200_office_base_for_all_companies.sql` | `20261012091200`, EXACT, 1 361 bytů, SHA-256 `94a670359b780849dcc129744b6a17c647901a54c93a0c36717b414439106472` |
| Diriqo | 1. `20261011140000_diriqo_office.sql` | `20261011140000`, EXACT, 40 807 bytů, SHA-256 `1fb5885900b7d9da9f041f0820784684d7da5d28ba8d99f35982da8c2dbdc6c1` |
| Diriqo | 2. `20261011184909_diriqo_office_normalized.sql` | `20261011184909`, EXACT, 51 187 bytů, SHA-256 `caa62e220e12779b3833f15fd9505cabd2e45186904c02214cfb13e0f7fa3e4e` |
| Diriqo | 3. `20261011185523_diriqo_office_receipt_commit.sql` | `20261011185523`, EXACT, 601 bytů, SHA-256 `4bf7b3c713a0f46e2723ef3bc6a605238821f7fe1051767e7236b3815b85ddef` |
| Diriqo | 4. `20261012091204_office_base_for_all_companies.sql` | `20261012091204`, EXACT, 2 009 bytů, SHA-256 `fc9d403ccf12b31361ac1adc46c892bf192f15d37de860dd59fdd9c44b2e0d3d` |

Lokální hashe všech osmi souborů jsou v `sourceSha256` [SQL validačního reportu](../reports/database-base-access-validation.json). Konečný ledger spojuje projekt, lokální soubor a hash, serverovou verzi a název. Všech osm záznamů má jediný `statements[1]` obsahující přesné původní UTF-8 byty; byla porovnána délka i SHA-256. UI transport normalizoval CRLF na LF, což katalogová kontrola dovoluje v tělech funkcí, ale uložená historie je bytově přesná. Původní aplikované soubory se nepřepisovaly. Historie byla doplněna samostatně až po ověření výsledného katalogu; tento postup nepředstírá úspěch technicky nefunkčního MCP `apply_migration`.

## Produkční deployment a přihlášená kontrola

[Merge záznam](../reports/office-main-merges-20261012.json), [první produkční UI kontrola](../reports/office-production-deployment-ui-20261012.json) a [konečné nasazení s originy](../reports/office-production-origin-20261012.json) spojují konkrétní `main`, READY deployment a veřejný alias:

| Host | Produkční Office | READY deployment | Git main |
| --- | --- | --- | --- |
| Diriqo | [app.diriqo.com/office](https://app.diriqo.com/office) | `dpl_7kPL3HVvtZ3EnvtwZ4w1CaFdcY1D` | `bfa6514efce88df13abf506eb4c487af054b2868` |
| JSPD Hub | [hub.jspd.cz/office](https://hub.jspd.cz/office) | `dpl_DF6DgMNgfQtFVvuwEuErfChSJPq1` | `12c1803ae2feccc58048e2af2b3853798df53efa` |

Koordinátor v připojeném Chrome ověřil existující přihlášené relace obou hostů: načtení pracovní plochy se správným firemním kontextem, návrat do hlavního menu, odkaz Diriqo Office a opětovný vstup. Zachycený seznam console errors byl v obou případech prázdný. V Diriqo otevřel nabídku šesti šablon a zavřel ji bez vytvoření dokumentu; v Hub byl vidět přepínač firmy. Snímky: [Diriqo](../reports/office-production-diriqo-workspace.jpg), [Hub](../reports/office-production-hub-workspace.jpg).

Při závěrečném ověření chybělo `OFFICE_PUBLIC_ORIGIN` v projektových i sdílených proměnných obou hostů. Doplněno pouze pro Production jako Config: Diriqo `https://app.diriqo.com`, Hub `https://hub.jspd.cz`. Následovalo nové nasazení přesně stejných Git SHA, bez změny zdrojů. Jeden Hub pokus přes API selhal `git_info_fail` bez převzetí produkčního aliasu; následné nasazení přes přihlášený dashboard uspělo. [Podrobný provozní záznam](OFFICE_PRODUCTION_ORIGIN.md) vysvětluje kontrolu a její meze.

Z čistých prázdných pracovních ploch byl v obou hostech přes skutečné UI nahrán sedmibajtový neplatný DOCX `INVALID`. Oba zobrazily očekávané `OFFICE_FORMAT`. To dokazuje průchod kontrolou domény, oprávnění a firemního kontextu a odmítnutí před importní persistencí; neprokazuje úspěšný import. Nevznikl soubor, originál, verze ani importní audit. Tento produkční smoke neobsahoval čerstvé přihlášení, úspěšný zápis/import/export, obnovu ani přepnutí mezi dvěma testovacími firmami. Tyto operace včetně souběhu prokázal izolovaný staging; v produkci nebyly vytvořeny syntetické doklady, firmy nebo účty. Menu ↔ Office je browser důkaz izolované navigace, nikoli provedené pokladní transakce či kompletní vizuální kontrola editorů.

## Provozní meze a návrat

Normalizovaná SaaS persistence odstraňuje souhrnný aplikační limit 64 MiB na firmu. Upload zůstává 3 MiB, JSON požadavek 3 800 000 bajtů a odpověď 4 350 000 bajtů včetně Base64. Historický větší dokument může přesáhnout limit hostitele. Předběžná kontrola odpovědi není atomická se zápisem: selhání doručení není důkaz rollbacku; výsledek se ověřuje pomocí revize a stejného idempotentního klíče. Lokální demo svůj limit 64 MiB zachovává. Disk, zálohy a růst historie vyžadují provozní dohled.

DOCX/XLSX podporují uvedenou podmnožinu a vracejí varování, originály nemění. PDF má samostatnou omezenou sazbu, obrázky nahrazuje alternativním textem. Nativní tisk používá prohlížeč a může mít jiné rozložení. Úplná kompatibilita Office, lokalizace vestavěného spreadsheet menu a desetinné čárky, společná editace v reálném čase ani úplná offline synchronizace nejsou hotové. Diriqent má autorizované typované návrhy se schválením, nikoli obecné SQL nebo automatický zápis do účetnictví.

Globální Office CSS a tisková pravidla se oddělují plným načtením stránky na vstupu i výstupu. Automatické testy kontrolují nativní odkazy a zachování POS navigace; produkční Chrome nyní ověřil přechod Office ↔ hlavní menu. Nativní tiskový dialog, fyzická tiskárna, terminál ani zásuvka ověřené nejsou. Část skutečných stagingových vazeb na zakázky/zákazníky stále vyžaduje explicitní seed; lokální negativní vazbové testy jej nenahrazují. Zděděné nálezy ostatních hostitelských modulů se touto Office změnou nepovažují za vyřešené.

Při problému **vypnout Office pro dotčenou firmu přes autorizovaný přepínač, zachovat uložené dokumenty, originály, verze i audit a opravit vpřed**. Vypnutí blokuje nové operace a nezruší data. Návrat aplikační verze musí respektovat již normalizovaný stav; nelze slepě obnovit původní JSON snapshot po nových zápisech. Tabulky, historie ani firemní data se při návratu nemažou. Produkční provoz nesmí zdědit dočasné stagingové proměnné.

Přepínač `/office/settings` působí pouze na vybranou firmu; pro další dotčené firmy se postup opakuje. Nové firmy nadále dostávají Office v základu. Hub vyžaduje `super_admin` v cílové firmě, Diriqo platformového administrátora s platným aktivním firemním kontextem. Po uložení ověřit `enabled=false` a obnovit menu. Již autorizovaná operace může dokončit před potvrzeným vypnutím; stažený obsah karty se nemaže. Vercel rollback vrací celý host včetně ostatních modulů, proto není prostředkem k vypnutí pouze Office.

Hub main PostgreSQL/Android job skončil úspěšně a jeho log je uložený výše. Výše popsané UI/device a formátové meze i samostatné ověření produkční konfigurace zůstávají platné po zeleném CI.
