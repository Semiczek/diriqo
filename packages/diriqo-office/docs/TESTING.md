# Ověření a akceptační scénáře

Výsledky se vedou zvlášť pro sdílený balíček, skutečné zdroje izolovaných hostitelů, lokální PostgreSQL fixture, vzdálené staging RPC, lokální Next host a veřejný deployment s prohlížečem. Aktuální stav, počty a identifikaci konkrétního běhu uvádí `reports/validation.json` a [STAGING_ACCEPTANCE.md](STAGING_ACCEPTANCE.md). Tento dokument popisuje pokrytí a opakování; nepovýší lokální test ani připravený zdrojový archiv na veřejnou akceptaci.

## Automatické kontroly sdíleného balíčku

`npm test` nepotřebuje interní hostitelské checkouty. Ověřuje transakce, dvě firmy, role, vypnutý modul, idempotenci, konflikty revizí, historii, neměnné originály, vazby, AI návrhy a lidské schválení. Formátové testy kontrolují DOCX/XLSX roundtrip, reprezentativní velký sešit, CSV injection, XSS, XXE, ZIP bomby, makra, CRC a cesty v archivu. Skutečný OSS parser má testy běžných výpočtů a chyb; graf vzorců ověřuje cykly, rozsahy, dlouhé závislosti a výsledky neaktivního listu. Tiptap testy používají skutečné schéma tabulek. Regrese opakovaného importu, browser ESM importu Reactu a číselných řetězců FortuneSheet zůstávají samostatné.

`tests/restore-dialog.test.mjs` spouští skutečné obsluhy OfficeWorkspace s deterministickými React hooks, časovači a RPC adaptérem. Ověřuje pojmenovaný DOM dialog, zrušení a Escape, připnutí CAS po uložení skutečného draftu, zneplatnění při editaci/pending-cell/změně transportu nebo oprávnění, dvojité potvrzení, konflikt a opakování neznámého síťového výsledku se stejným klíčem. Zpožděná odpověď nesmí přepsat novější práci a remount shodného obsahu nesmí přidat falešné uložení. Stejný harness prokazuje, že UI schválení potřebuje jen soubor v odpovědi, nikoli druhou kopii obsahu návrhu. Nejde o simulaci skutečného browser focus trapu nebo čtečky obrazovky.

`npm run license:check` ověřuje přesný schválený graf v lockfile, zachované notices, SBOM, font/OFL a vložená fontová data. Nová závislost neprojde bez nové odpovídající evidence ani tehdy, když její metadata uvádějí MIT. `tests/host-package-assets.test.mjs` spouští skutečný distribuovaný checker proti omezenému testovacímu archivu a ověřuje odmítnutí změněného či chybějícího fontu, OFL a evidence. `npm run build` sestavuje klienta, samostatně načítané editory, server a importní worker. Logy v `reports/` platí vždy pro uvedený běh, nikoli automaticky pro pozdější změnu zdrojů.

## Kontraktní testy skutečných hostitelů

Připravte oddělené Git checkouty `integrations/hub` a `integrations/diriqo` na přesných base revizích z `release/DELIVERY.json`, zkontrolujte a aplikujte příslušný Office patch podle [ENABLEMENT.md](ENABLEMENT.md). Potom spusťte z kořene sdíleného balíčku:

```sh
npm run test:hosts:check
npm run test:hosts
```

Spouštěč požaduje skutečné kontextové guardy, proxy, Office klienty, HTTP limity, souborové endpointy, logout/login a cesty pro přepnutí firmy. Pro srovnání proxy matcherů používá také již připravený runtime Next daného checkoutu. Chybějící zdroj/runtime, symlink nebo checkout vydávající nadřazený repozitář za vlastní skončí `HOST_TEST_SETUP_REQUIRED`; nikdy nejde o přeskočený úspěch. Kontrola vypíše skutečné HEAD revize, jejichž shodu s manifestem je nutné ověřit při přípravě. Sama nic neklonuje, nestahuje ani neinstaluje.

Hostitelské testy používají skutečné zdroje a inertní auth/Next porty. Pokrývají Office-only přístup zaměstnance, přísnou identitu, logout POST a cookies, legitimní login, tenant očekávání, přepnutí firmy a ochranu draftu. Guard testy ověřují přesné staging refy/originy, zamítnutí produkce, nepovolených cest a metod, chybného či vypršeného UTC data a zachování původního chování při vypnutém staging režimu.

`tests/host/office-http-limits.test.mjs` kontroluje UTF-8 bajty včetně JSON rámce, neplatné hodnoty, hranice souboru a Base64 odpovědi. Používá skutečnou multipart čtečku s proudem překračujícím limit a chybějícím nebo lživým Content-Length; import nesmí začít. Dále ověřuje nadlimitní normalizovaný obsah/varování před uložením, export před auditem, přesné důvěryhodné originy a odmítnutí Host/forwarded aliasů. Velký aktuální/historický obsah nebo návrh musí být při známé velikosti odmítnut před mutací.

Zvláštní test úmyslně simuluje nadlimitní odpověď vzniklou až po commitu: host vrátí chybu doručení, ale zápis již proběhl. Předběžná kontrola velikosti není SQL transakce; test netvrdí rollback. Při obnově neznámého výsledku zůstávají rozhodující revize a idempotentní účtenky.

Sdílené CI neklonuje interní hostitele. Standalone testy, explicitní host suite, plný Next build a skutečný staging jsou oddělené důkazy.

## Lokální PostgreSQL fixture

`tests/database-runner.mjs` provádí skutečnou SQL migraci a hostitelské adaptéry přes již dostupný PGlite. Pokrývá RLS/granty, zákaz přímého přístupu k privátním tabulkám, dvě firmy, role, výchozí vypnutí, modulový přepínač, originály, revize, idempotenci, vazby, validaci a schválení AI návrhů. Diriqo kontroluje přísnou identitu i povolenou/zamítnutou capability. Výsledek konkrétního běhu je v `reports/database-validation.json`.

Každý host dostává novou paměťovou databázi. Fixture obsahuje jen minimální členství, auth/JWT kontrakty a capability; neověřuje Supabase gateway, kryptografickou validaci JWT nebo celý tarifní evaluator. Sekvenční kontrola zastaralých revizí nenahrazuje souběh více spojení a pozorování zámků.

PGlite se s Office nedistribuuje a není součástí jeho licenčního auditu. Existující wrapper uvádí Apache-2.0, vložený PostgreSQL používá PostgreSQL License mimo striktní Office allowlist. Nová instalace do CI vyžaduje samostatný audit; následující příkaz předpokládá již prověřený lokální nástroj:

```powershell
$env:OFFICE_PGLITE_MODULE = 'ABSOLUTNI_CESTA/@electric-sql/pglite/dist/index.js'
node tests/database-runner.mjs
```

Testovací SQL fixture nikdy nepoužívejte jako aplikační migraci nad existující databází.

## Sestavení a lokální HTTP

Izolované checkouty používají vlastní kopii existujících hostitelských node_modules a auditovaný Office archiv. Příprava, verze a hranice kopie jsou v `reports/hub-build-preparation.json` a `reports/diriqo-build-preparation.json`; hostitelský graf se tím nově neschvaluje.

Příkaz `node node_modules/next/dist/bin/next build` běží v odpovídajícím checkoutu se syntetickým staging prostředím a vypnutou Next telemetry. Sestavy obou hostů nespouštějte současně na paměťově omezeném stroji. Reporty `reports/*-next-build.json` a `reports/staging-*-host-build.json` jsou snímky konkrétních zdrojů a prostředí.

Smíšený balíček @diriqo/office se nechává sestavit Nextem. Pevná lokální URL workeru nepochází od uživatele; outputFileTracingIncludes musí zachovat worker, ESM package.json a notices. Po buildu lze spustit `node scripts/verify-host-build.mjs hub` a `node scripts/verify-host-build.mjs diriqo`; ty dočasně spustí izolovaný server na localhostu. `node scripts/verify-host-transport.mjs` kontroluje transportní helpery včetně vypršené relace a neplatné odpovědi.

`node scripts/smoke-demo.mjs` při spuštěném demonstrátoru ověřuje HTTP endpointy, dvě lokální session, role, konflikt, worker import, originál, historii a schválení. Tento průchod není přihlášením do skutečného Hubu/Diriqo. Označené demonstrační dokumenty a šablony jsou ve fixtures; browser důkazy takového běhu mají vlastní reporty v reports.

## Vzdálené staging RPC a veřejný host

Postupy a manifesty jsou v [STAGING_RUNBOOK.md](STAGING_RUNBOOK.md), [STAGING_PROVISIONING.md](STAGING_PROVISIONING.md) a [PUBLIC_STAGING.md](PUBLIC_STAGING.md). Produkční projekty jsou zakázané. Před skutečným během ověřte správný projekt, provenance schématu, časové okno a syntetické identity. Konfigurace přístupových údajů zůstává v soukromé .staging; nevkládá se do reportů ani archivu.

Historické důkazy mají vymezený rozsah:

| Oblast | Reporty |
| --- | --- |
| Skutečné Auth, dvě firmy, role, AI, revize a souběh RPC | reports/staging-hub.json, reports/staging-diriqo.json |
| Výchozí vypnutí, oprávněné zapnutí a zákaz dalších operací | reports/staging-\<host\>-default-enable.json, reports/staging-\<host\>-module-toggle.json |
| Diriqo capability autorita | reports/staging-diriqo-capability-denied.json, reports/staging-diriqo-capability-granted.json |
| Nezávislé pozorování zámků při vypnutí za běhu | reports/staging-\<host\>-inflight-lock-proof.json |
| Vazby a přímé granty | reports/staging-\<host\>-edges.json |
| Lokální Next se skutečnými Auth cookies a vzdálenou DB | reports/staging-\<host\>-host-http.json |
| Rozsah kopírovaného technického schématu | reports/staging-\<host\>-provenance.json, reports/hub-schema-fidelity.json |
| Dřívější browser průchod a kontrola staženého XLSX | reports/staging-diriqo-browser-export.json a související browser reporty |

Tyto reporty se nevztahují automaticky na nový deployment. Starší cleanup prokazuje odstranění předchozích větví; aktuální veřejné cíle a jejich úklid se řídí novými manifesty. Připravený source hash, lokální build a stav READY každý dokazují jinou část. Aktuální veřejný HTTP/browser výsledek se zapisuje samostatně do akceptačního reportu; nezíská PASS jen existencí projektu nebo implementace.

## Opakovatelná UI akceptace

1. Přihlaste správce/editora/čtenáře firmy A a správce firmy B. Ověřte create, edit, save, reopen, soubory druhé firmy a odmítnutí podvržených tenantů přes HTTP i RPC.
2. Ve dvou panelech stejného uživatele otevřete firmu A, ponechte skutečný draft a přepněte aktivní firmu legitimním Office přepínačem. Původní panel musí zachovat draft a odmítnout transport do B. Nová firma se otevře výslovně v dalším panelu. Ověřte také návrat k A, ztrátu relace, odhlášení, změnu oprávnění a opožděný výsledek kontroly.
3. V historii zvolte starší verzi: zkontrolujte název a revize v dialogu, zrušení, Escape, fokus a klávesnici. Potvrzení vytvoří jedinou další revizi. Reopen ani nezměněný remount nesmí přidat další; nová lokální úprava nebo konflikt musí zachovat draft.
4. Ověřte výpadek/retry, pracovní zálohu, opakování stejného idempotentního požadavku a modul vypnutý za platné relace. Zachování draftu v otevřeném panelu není offline synchronizace po zavření prohlížeče.
5. Přes veřejnou autorizovanou cestu importujte DOCX/XLSX skutečným Node workerem, stáhněte originál, exportujte znovu a ověřte bajty. Otestujte skutečné meze uploadu, normalizovaného obsahu a odpovědi.
6. Stáhněte PDF, ověřte obsah a varování. Zvlášť otevřete nativní tiskový náhled, zkontrolujte hostitelské UI, okraje, tabulky a konce stránek. Skutečná fyzická tiskárna, zákaznické dokumenty a úplná browser/device matice jsou další samostatné důkazy.
7. AI návrh smí uložit pouze oprávněný člověk po náhledu rozdílů a kontrole revize. Zápis strukturovaného výsledku do jiného modulu musí použít jeho autorizovanou operaci.

## Stažitelný PDF a tisk

`tests/pdf.test.mjs` ověřuje skutečné xref offsety, CID/Unicode, hash fontu/OFL, neměnnost vstupu, determinismus, limity, dlouhá slova/buňky a odmítnutí aktivních PDF akcí. Samostatný syntetický PDF lze znovu vytvořit pomocí `scripts/pdf-demo.mjs`, zkontrolovat existujícím parserem přes `scripts/verify-pdf.py` a vykreslit již dostupným Popplerem. Podrobný postup, podporované prvky a uložený nezávislý parse/render doklad jsou v [PDF_EXPORT.md](PDF_EXPORT.md) a `output/pdf/independent-validation.json`.

CSS tisk zachovává běžný tok papíru, skrývá okolní UI jen při otevřeném dokumentu a uvolňuje flex/scroll na jeho předcích. Ověření CSS parserem či lokální render serverového PDF neprokazuje browser tiskový náhled. Nativní tisk používá jiné fonty a sazbu než serverový export a musí být posouzen samostatně. Pypdf/Poppler jsou existující testovací nástroje, nikoli nové distribuované závislosti Office.
