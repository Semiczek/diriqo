# Diriqo Office: dopady zavedení a úroveň ověření

Kontrola 11. 10. 2026 se týká izolovaných pracovních kopií Hub (`9f77597d4112ce929e8664828cd4a4ea0f1b8b41`) a Diriqo (`746800d5d189e7cf9b8c61496edc88755581d7cc`) s aktuálními lokálními změnami Office. Není potvrzením nasazení tohoto přesného zdrojového stavu do produkce. Produkční aplikace, data a fyzická zařízení tato kontrola neměnila.

## Nabídka a přepínání firem

Office se v nabídce zobrazí pouze při `officeEnabled === true`, načteném z `office_settings` pro ověřenou aktivní firmu přes běžného přihlášeného klienta a RLS. Jde o informaci pro nabídku; každý skutečný požadavek Office dále kontroluje oprávnění a zapnutí modulu na serveru.

Nezávislá kontrola našla a opravila zahazování příznaku při normalizaci klientské cache Hub. Příznak nyní přežije cache i opětovné načtení. Sdílený Hub builder pro přepnutí firmy načte příznak cílové firmy až po ověření jejího členství; zapnutá firma A proto nepřenese svůj příznak do vypnuté firmy B. Diriqo odkaz používá existující styl `dashboard-sidebar-link`. Nová oprava nabídky je ověřena lokálním testem skutečných zdrojových funkcí; její nasazení a aktuální zobrazení v host UI musí doložit finální build a browser report.

`tests/host/office-menu-availability.test.mjs`: před opravou dva testy selhaly na chybějícím příznaku, po opravě všech pět prošlo. Kontrolují cache, změnu firmy, odmítnutí cizí firmy před čtením jejího příznaku, chování při nedostupnosti nastavení a původní filtr pokladny.

## Sdílené části hostů

| Oblast | Skutečný dopad | Ověření a omezení |
| --- | --- | --- |
| Proxy a směrování | Přibyly Office cesty, omezené výjimky pro čtenáře a oddělené přihlášené odhlášení. Staging zachytává všechny cesty; normální režim vrací nové nepokryté cesty bez dalšího zpracování a pro ostatní používá původní matchery. | Lokální kontraktní test porovnává normální matchery s instalovaným překladačem Next. Staging nepovoluje běžné provozní moduly. To neprokazuje celý produkční provoz. |
| Přístup čtenářů Hub | Výjimka pracovníka platí pouze pro přesné `/office` a `/api/office` segmenty a jeho ověřenou vybranou firmu. | Deset lokálních testů ověřuje roli, firmu, chybějící/neplatný výběr, zamítnutí zápisu a omezené přesměrování po přihlášení. Nedává obecný přístup k Hubu. |
| Limit Server Actions | `experimental.serverActions.bodySizeLimit: '9mb'` je nastavení celého hostu. | Jde o sdílenou změnu příjmového limitu, nikoliv jen Office. Office má navíc vlastní limity obsahu a importu. Limit konkrétního hostingu může být nižší; změna sama neověřuje kapacitu všech ostatních akcí. |
| Distribuce souborů | File tracing pro `/api/office/files` přidává vlastní import worker a požadované licenční soubory. | Nemění POS API. Finální balíček a host build musí odpovídat přesně testovaným zdrojům. |
| Office databáze | Normalizované úložiště a paginované operace jsou samostatná změna Office. | Stagingové důkazy mají vlastní reporty. Předchozí browser důkaz staršího nasazení není automaticky důkazem nově sestaveného hostu. |

Aktuální souhrnný lokální běh `office-menu-availability`, `staging-proxy` a `hub-office-reader`: **27/27 PASS**. Spuštění:

```powershell
node --experimental-strip-types --test --test-isolation=none tests/host/office-menu-availability.test.mjs tests/host/staging-proxy.test.mjs tests/host/hub-office-reader.test.mjs
```

## Odložený databázový COMMIT

`database/office-normalized-receipt-commit.sql` mění pouze soukromou trigger funkci `office_private.receipt_complete_v2()` na `SECURITY DEFINER`, nastavuje pevný `search_path=pg_catalog` a odebírá přímé spuštění rolím `public`, `anon`, `authenticated` a `service_role`. Tělo funkce používá plně kvalifikovanou tabulku, nepřijímá argumenty a zachovává kontrolu neúplného receipt. Oprava neuděluje přístup ke schématu ani tabulkám klientům.

Root zaznamenal skutečnou stagingovou chybu `42501` při odloženém COMMIT a následné úspěšné vytvoření po této opravě. Její aplikaci do izolovaných větví eviduje `reports/normalized-staging-commit-migration.json`.

Nezávislý lokální runner `tests/database-receipt-commit-runner.mjs` provedl v existujícím PGlite 0.5.8 skutečné transakce `BEGIN → SET LOCAL ROLE authenticated → office_request → COMMIT`, bez resetu role před COMMIT. **Původní chybu PGlite nereprodukovalo.** Report ji proto označuje `NOT_REPRODUCED_IN_PGLITE`; lokální běh se nevydává za RED důkaz produkčního PostgreSQL.

Opravená cesta prošla 13 kontrolami pro Hub a 13 pro Diriqo: COMMIT vytvoření/uložení, opakování klíče bez další verze, izolace firem, zachované soukromé granty a odmítnutí skutečně neúplného receipt při COMMIT. Podrobnosti a otisky vstupních SQL jsou v `reports/database-receipt-commit-validation.json`. Tento běh modeluje Auth lokální fixture, neověřuje JWT ani více současných databázových spojení a nic neinstaluje.

Dodatečná přímá kontrola katalogu čerstvého lokálního PostgreSQL/PGlite po všech Office migracích prošla **5/5 pro každý host**. Všech 11 soukromých tabulek má povinné UUID `company_id` a RLS; všech 15 cizích klíčů je validovaných. Každá tabulka má přímou nebo složenou vazbu na `public.companies(id)` a každá vazba mezi soukromými tabulkami zahrnuje odpovídající `company_id`. Role `anon`, `authenticated` ani `service_role` nemají práva na soukromé schéma, tabulky, sekvence či funkce. Skutečné katalogové řádky a otisky migrací ukládá `reports/office-private-catalog.json`; reprodukovatelný runner je `tests/database-private-catalog-runner.mjs`. Jde o lokální katalog, ne odečet nasazené databáze.

Skutečný souběh v normalizovaném Diriqo stagingu samostatně dokládá `reports/staging-diriqo-normalized-lock-proof.json` (11 kontrol): druhý dokument se uloží během blokace prvního, vypnutí čeká na probíhající uložení a následné zápisy/čtení vypnutého modulu jsou odmítnuty. Jde o konkrétní větev a běh uvedený v reportu, nikoliv kapacitní záruku produkce.

## Pokladna, DiriPOS a tisk

Kontrola Git diffu vůči výše uvedeným revizím nenalezla Office změny v Hub `app/gastro/pos`, `app/api/gastro`, `lib/gastro-pos*`, `lib/menu/menuConfig.ts` ani `lib/menu/menuPermissions.ts`. Hub položka Pokladna nadále míří na `/gastro/pos`; viditelnost vyžaduje modul Gastro, odpovídající roli a povolení v menu. Samostatný test potvrzuje odmítnutí při chybějícím Gastro, roli uživatel a explicitním skrytí. Nový Office odkaz v Diriqo nepřidává ani nepřesměrovává pokladnu. Samostatný repozitář DiriPOS tímto omezeným auditem nebyl prověřován.

V izolované kopii Hub se navíc spustilo pět existujících regresních sad beze změny jejich obsahu:

| Sada | Výsledek |
| --- | --- |
| `dashboard-menu-permissions` | 5/5 PASS |
| `pos-sale-projection` | 12/12 PASS |
| `pos-cancellation-return` | 11/11 PASS |
| `android-pos-shift-cash-print` | 5/5 PASS |
| `android-pos-stock-sync` | 14/14 PASS |
| **Celkem** | **47/47 PASS**, nic přeskočeno |

`reports/office-pos-regression.json` obsahuje příkazy, revizi a otisky testů; úplný výstup je v `reports/office-pos-regression.log`. První pokus se standardní izolací Node nemohl spustit podproces (`spawn EPERM`) a neprovedl žádnou kontrolu. Stejné sady následně prošly s podporovaným `--test-isolation=none`; nešlo o selhání aplikace ani prokázanou chybu původní revize. Proto nebylo nutné obnovovat a znovu spouštět baseline. Git potvrdil nezměněné vybrané testy, Android POS, `lib/gastro`, `app/api/gastro` a kontrolované prodejní/storno migrace.

Tyto sady ověřují strukturu skutečných zdrojů a oddělené modely pokladních scénářů v paměti. Nespouštějí Kotlin aplikaci, POS SQL v databázi ani skutečný síťový přenos. PASS tudíž neprokazuje chod pokladny na zařízení.

Veřejné stagingové browser scénáře obnovení dokumentu a přepínání firem jsou zaznamenány v `reports/public-staging-browser.json` a vztahují se k uvedeným deploymentům. Serverový PDF export a vlastní HTML s tiskovým CSS mají nezávislé parse/render důkazy; viz `PDF_EXPORT.md` a `NATIVE_PRINT_VALIDATION.md`.

**Není ověřena fyzická pokladna, platební terminál, tiskárna účtenek, zásuvka, párování, prodejní synchronizace ani fyzický tisk.** Nativní dialog tisku uživatelova Chrome nebyl vizuálně dostupný podporovaným nástrojem. PDF soubor a vlastní headless tiskový render tuto chybějící manuální kontrolu nenahrazují.

## Podmínky před běžným provozem

Po zmrazení zdrojů znovu sestavit sdílený balíček a oba hosty, provést odpovídající testy a zachovat jejich přesné otisky. Ověřit nabídku po přihlášení a přepnutí firmy na finálním nasazení. Zvlášť uzavřít kapacitní důkazy normalizovaného úložiště a provozní limity hostingu; rozpracované běhy nepovažovat za PASS. Produkční nasazení a migrace vyžadují samostatně schválený cílový projekt a běžný postup nasazení, zálohy a návratu. Vypnutí Office je první prostředek omezení jeho provozu; produkční data se kvůli návratu nemažou.
