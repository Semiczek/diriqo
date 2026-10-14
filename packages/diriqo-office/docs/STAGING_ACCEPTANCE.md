# Diriqo Office – staging a hranice ověření

> **Historický protokol. Aktuální Git release nahrazuje zdejší interpretaci aktuálního stavu:** [GIT_RELEASE.md](GIT_RELEASE.md) a `reports/git-office-release.json` uvádějí nové přesné commity, deploymenty a výsledky. Níže zachované starší testy dokládají pouze původní běhy; automaticky neprokazují nově nasazené přihlášené UI.

Závěrečný protokol 11. 10. 2026: **AUTOMATED_STAGING_PASS_UI_NOT_VERIFIED**. Databázová kapacita, izolace, oba nové webové buildy, skutečné HTTP a PDF kontroly jsou dokončeny. **Nové UI v Chrome není vizuálně ověřené; uživatel výslovně přijal dokončení s tímto omezením.** Produkce, zákaznická data a provozní pokladna se neměnily. Dočasné weby používají samostatné Supabase větve se syntetickými firmami a účty.

Veřejné cíle jsou v `reports/public-staging-targets.json` a [PUBLIC_STAGING.md](PUBLIC_STAGING.md). Přesnou vazbu deploymentu, archivu zdrojů, serverových otisků uploadu a runtime potvrzuje `reports/normalized-deployments.json`; shodu souborů a následné důkazy znovu kontroluje souhrnný skript. Stav READY ani starý browser report se samostatně nepovažují za důkaz aktuálního UI.

| Host | Veřejné Office | Přesný nový deployment |
| --- | --- | --- |
| JSPD Hub | [Otevřít staging](https://office-staging-bnp1tlyrl-jspdholding-7510s-projects.vercel.app/office) | `dpl_3CusNPbtk7BLPkidaNL7k2XKGN7W` |
| Diriqo | [Otevřít staging](https://office-staging-diriqo-k52ri8idb-jspdholding-7510s-projects.vercel.app/office) | `dpl_9uXxyrzvW6wT9ppdVg5ET8Md773M` |

Přístup vyžaduje přihlášení. Soukromé testovací přístupy jsou v místním `.staging/PUBLIC_ACCESS.md` a nejsou součástí distribuce. Office položka v běžném menu je podmíněna zapnutím modulu pro ověřenou aktivní firmu. Produkční menu zatím zapnuté není. Staging záměrně omezuje ostatní provozní moduly.

## Dokončené testy aktuální databázové cesty

| Kontrola | JSPD Hub | Diriqo |
| --- | ---: | ---: |
| Skutečná Auth/RPC, role, dvě firmy, verze, AI a idempotence | 410 PASS | 410 PASS |
| Souběžné CAS zápisy, jediný vítěz a odmítnutí zastaralé revize | 3 kola PASS | 3 kola PASS |
| Skutečné databázové zámky, nezávislé dokumenty a vypnutí modulu | 11 PASS | 11 PASS |
| Kapacita, konzistence historie, obnova a odmítnutí jiné firmy | 254 PASS | 186 PASS |
| Uložená logická historie jedné firmy v kapacitním testu | 76 593 969 B (73,046 MiB) | 76 593 969 B (73,046 MiB) |

Kapacitní běhy zahrnují 72 původních revizí a následnou obnovu do revize 73. Každá verze byla znovu načtena a obsah porovnán kanonickým SHA-256. Historie přesáhla původní limit 64 MiB, přitom jednotlivý dokument zůstal pod limitem požadavku. Čtenář může povolenou verzi číst, nesmí ji uložit; jiná firma ani podvržené firemní ID nepřejdou autorizací.

Běhy se setkaly s přerušením transportu a lokálním Windows checkpointu. Tyto neúspěšné pokusy jsou uchovány v reportech. Navázání nejprve ověřilo existující soubor a historii a při nejasném výsledku opakovalo přesně stejný idempotentní klíč; nevytvořilo další verzi potají. PASS neznamená bezchybnou síť ani výkonovou záruku pro produkci. Logický objem JSON není fyzicky obsazený disk.

Obě větve doložily skutečný souběh: zamčený dokument nebrání uložení jiného dokumentu stejné firmy; vypnutí modulu čeká na probíhající autorizovaný zápis a následující operace odmítá. Umělý čtecí blokátor uvolnil databázový timeout, zatímco aplikační zápis a vypnutí prošly. Dočasné zámkové a pozorovací funkce byly podle závěrečného katalogového reportu odstraněny.

## Lokální regresní, licenční a SQL důkazy

- **184/184 společných testů**, bez přeskočení nebo selhání: `reports/normalized-shared-tests.log`.
- **90/90 hostitelských testů**: `reports/normalized-host-tests.log`.
- **526** kontrol normalizované izolace, kapacity a backfillu; **247** regresních RPC kontrol.
- **26** kontrol opraveného COMMIT a **10** kontrol privátního katalogu.
- **129 přesných balíčků a jeden OFL font** prošly aktuální licenční kontrolou.
- Shodný runtime je nainstalován v obou místních hostech; SHA-256 `fc8b602dc57267f504bbd4d02788b8dc349f4cb03d282fe62008e9d0538e5c5a`.

SQL kontroly běží v místním PGlite. Nepředstavují další cloudové, JWT nebo vícespojové důkazy. Původní chybu odloženého COMMIT místní engine nereprodukoval; skutečný staging ji zachytil a opravil oddělenou migrací. `reports/database-receipt-commit-validation.json` tento rozdíl výslovně zachovává.

Každá nová tabulka má povinné firemní ID, složené firemní vazby a soukromý přístup přes autorizované RPC. Podrobnosti: [normalizované úložiště](NORMALIZED_PERSISTENCE.md). Starý souhrnný limit v SaaS cestě není; místní Memory/FileStore demo jej zachovává. Jednorázové limity souboru a transportu se neruší.

## Nové veřejné nasazení

Oba nové buildy jsou READY. Na přesných výše uvedených deploymentech znovu prošlo **50 veřejných HTTP kontrol Hub a 48 Diriqo**, včetně skutečného SSR přihlášení, importního workeru, negativních přístupů, importu/exportu a zpracování reprezentativního XLSX s 20 000 buňkami. Nejde o úplný výkonový benchmark.

Oba nové autorizované PDF endpointy poskytly skutečné bajty, které prošly nezávislým parsováním a kontrolou vazby na obnovený dokument. Otisky jsou shodné s dříve vykreslenými PDF; obě výsledné stránky byly znovu vizuálně prohlédnuty. Reporty `output/pdf/public-*-restored-validation.json` obsahují aktuální deployment ID.

**Obnovení a přepínání panelů přímo v Chrome pochází ze staršího runtime a nejsou důkazem nového stránkovaného UI nebo opravené položky menu.** Nový browser report `reports/normalized-staging-browser.json` má stav `NOT_VERIFIED`, přesná nová ID a eviduje výslovné přijetí tohoto omezení uživatelem. Automatické důkazy nesuplují vizuální kontrolu.

Místní testy opravy nabídky ověřily zachování firemního příznaku v cache, načtení příznaku cílové firmy až po kontrole členství, odmítnutí cizí firmy a zachování původního filtru pokladny. Aktuální online podobu zůstává nutné samostatně prohlédnout na přesném novém deploymentu. Chrome nebyl na konci dostupný podporovaným ovládáním; HTTP zůstává jiným druhem důkazu a vizuální PASS se neprohlašuje.

## Tisk a PDF

Skutečný instalovaný headless Chrome a serverový PDF export prošly nezávislým parsováním i vizuální kontrolou všech **15 stran**. Test obsahuje češtinu, A4, okraje, ruční zlom, 36 řádků, buňku vyšší než stránka a dlouhé slovo; obsah se neztratil. Krátký dokument měl 1/1 stranu, dlouhý Chrome 6/server 5, dokument s 50mm okraji 1/1.

Oprava tiskového CSS umožňuje přirozené dělení nadměrné buňky místo téměř prázdné předchozí stránky. Nejde o pixelovou shodu různých sazeb. [Tiskový protokol](NATIVE_PRINT_VALIDATION.md) a skutečné PDF/PNG jsou v `output/pdf/native-print/`. **Nativní dialog uživatelova Chrome a fyzická tiskárna nejsou ověřeny.**

## Pokladna a ostatní moduly

Pět existujících lokálních sad menu/POS prošlo **47/47**. Kontrola vybraných zdrojů nenašla Office změny v pokladních cestách, Android POS a ověřovaných prodejních migracích. Sdílené směrování, autorizace a limit Server Actions mají zdokumentované dopady. Nejde o fyzickou zkoušku kasy, terminálu, synchronizace nebo zásuvky ani o úplnou certifikaci ostatních modulů. [Dopady zavedení](OFFICE_ROLLOUT_IMPACT.md).

Závěrečný katalog skutečných větví potvrzuje odstranění testovacích helperů, soukromí Office a zajištěný odložený trigger. Bezpečnostní poradce však hlásí i převzaté ne-Office objekty, včetně **čtyř Diriqo SECURITY DEFINER views s úrovní ERROR**, dalších funkcí a nastavení Auth. Tyto nálezy nejsou opravené ani vydávané za bezproblémové. Úplný rozsah, odkazy a interpretace jsou v `reports/normalized-staging-catalog-final.json`. Office migrace tyto starší objekty nevytváří; před produkcí je nutná samostatná kontrola cílového schématu.

## Provozní hranice a úklid

Před produkčním nasazením je potřeba schválit konkrétní cíl, zálohu, kapacitu a návrat a provést ruční kontrolu nového UI. Automatické stagingové kontroly jsou dokončené; přijaté omezení UI ani chybějící fyzický test nejsou celkovou certifikací provozu. Kompatibilita DOCX/XLSX je podporovaná podmnožina. Není hotová real-time spolupráce, úplná lokalizace spreadsheet enginu ani celý tiskový a hardwarový matrix. [Omezení](LIMITATIONS.md), [zapnutí a návrat](ENABLEMENT.md).

Externí cloudové ukládání je pouze [poznámka k variantám](EXTERNAL_STORAGE_NOTES.md). Nevznikl nový bucket, objednávka služby ani odesílání dokumentů třetí straně.

Schválené okno končí **12. 10. 2026 v 19:00 Praha**, úklid je naplánovaný na 18:55, strop obou větví je **1 USD**. Plán smaže obě testovací databázové větve a ověří jejich nepřítomnost; webové projekty případně pozastaví, bude-li dostupný odpovídající nástroj. Naplánování ještě není vykonaný úklid. Serverová expirace sama neukončuje účtování.

Strojový souhrn `reports/validation.json` má stav `AUTOMATED_STAGING_PASS_UI_NOT_VERIFIED`, automatický rozsah PASS, celkovou UI akceptaci false a neomezenou produkční připravenost false. Reprodukovatelná místní agregace `node scripts/finalize-normalized-evidence.mjs` kontroluje reporty, aktuální soubory a jejich otisky bez sítě a nic nezapisuje; `--write` zapíše nový souhrn. Historický `reports/public-staging-final-local.json` dokládá předchozí runtime a nesmí se zaměnit za nový závěr. Nebyl proveden Git push ani produkční deployment.

Předání používá neměnný testovaný runtime TGZ s otiskem výše. Nejnovější důkazy, tento protokol a aktuální `docs/ENABLEMENT.md` jsou v kořenové dokumentaci zdrojového ZIP. Vložené dokumenty TGZ nebyly kvůli textovým změnám přebaleny. Při nasazení je rozhodující aktuální zdrojový návod: po core a hostitelském adaptéru aplikovat **normalizaci i oddělenou opravu odloženého COMMIT**, nikoli pouze první normalizační migraci.
