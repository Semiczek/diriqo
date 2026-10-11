# P0: atomická mobilní práce — 11. 10. 2026

## Rozsah a stav

Výchozí auditovaná revize `cd9291e3414891de7603ec79d1a219f200903993`. Migrace `20261011191250_atomic_mobile_work.sql` je **aplikovaná pouze v testovacím Diriqu `wfcpfraxiuhuglnuaxqj`**, schémata public/private. Oprava směn z [PR #10](https://github.com/Semiczek/diriqo/pull/10) a nezávislá oprava Mailgun z PR #11 jsou sloučené. Aplikační přechod na RPC je **nasazený na `app.diriqo.com` v revizi `35c24a2d2a046bbed8cc1f07a997d1fa63b3b1be`**; Vercel deployment `dpl_ET6ZRtDDCZoU4au1pDoA5ZMCade1` má stav READY a přiřazenou tuto doménu. Hub se neměnil.

Jeden pracovník může mít ve firmě nejvýše jednu skutečně běžící směnu (started_at není null, ended_at je null). Databázový unikátní index chrání i jiné zapisující cesty. Nová autentizovaná RPC zpracuje start, stop a dokončení práce v jedné transakci; odvozuje pracovníka z Auth, ověřuje aktuální členství, přidělení, licenci i přepínač modulu. Starty i dokončení stejné identity/firmy sdílejí zámek. Datum směny odpovídá časovému pásmu firmy.

Ukončení vlastní existující směny je možné po ztrátě licence či přidělení, stále však vyžaduje aktivní členství. Opakovaný start během běžící směny vrátí stejné ID. **Pozdní start po již ukončené směně je nová operace; trvalý request-ID ledger zde zaveden není.** Stop a dokončení opakovaně zachovají původní časy.

## Příprava migrace a návrat

Před změnou ověřen projekt `diriqo-prod / wfcpfraxiuhuglnuaxqj` (uživatelem označené testovací Diriqo), PostgreSQL 17.6, předchozí migrační hlava `20261011175514`, žádná běžící směna ani duplicita. Cílená lokální záloha `work/p0-audit/pre-atomic-mobile-work.json` zachytila 5 směn, 31 přiřazení, 26 zakázek, indexy/policies a relevantní funkce v 19:03:58 UTC. Obsahuje existující data, proto není v Gitu. Jde o cílený bod před touto aditivní migrací, nikoli důkaz obnovy celého SaaS.

CLI `supabase 2.120.0 migration new atomic_mobile_work` vytvořilo soubor; po aplikaci byl název sjednocen s autoritativní verzí serveru. Aplikovaný SQL obsah se zpětně nemění. Migrace nepřepisuje historické záznamy; při existujících duplicitách selže místo automatického mazání.

Bezpečný návrat aplikace: vrátit předchozí deployment a ponechat aditivní index/RPC. Původní zápisy zůstávají kompatibilní, konflikt duplicit odmítne index. Neprovádět automatické odstranění indexu ani obnovu celé staré tabulky přes nové obchodní události.

## Skutečné kontroly

- `node node_modules/vitest/vitest.mjs run tests/mobile-worker-actions.test.ts`: **23/23 PASS**. Mockované síťové/guard hranice, skutečné Server Actions; chybná oprávnění, ztráta licence, konflikt, neplatné odpovědi, uppercase UUID a nejistý transport.
- `node node_modules/typescript/bin/tsc --noEmit`: PASS.
- `node node_modules/eslint/bin/eslint.js app/moje-prace/actions.ts tests/mobile-worker-actions.test.ts`: PASS.
- `supabase/tests/atomic-mobile-work.sql` přes execute_sql: **27 DB asercí + 3 kontroly úklidu PASS**. Skutečné role authenticated/anon/service_role, syntetické firmy A/B a rozdílné role, přidělení, cizí směny, odvolání členství/grantu, deaktivovaný modul, transakční výsledky, datum firmy, unikátní index i pro privilegovaného zapisovatele. Všechny fixtures tohoto souboru rollback.
- `node --test --test-isolation=none tests/platform-foundation.test.mjs`: **18/18 PASS**, zachovaných 73 scénářů.
- Nezávislý review opravil kontrolu licence po čekání na zámek, kanonizaci UUID a únik transportní chyby. Po opravách bez dalšího blokujícího nálezu v tomto úzkém rozsahu.
- Čistý GitHub CI pro [PR #10 / běh 38169091592](https://github.com/Semiczek/diriqo/actions/runs/38169091592), [PR #11 / běh 38169119462](https://github.com/Semiczek/diriqo/actions/runs/38169119462) a [sloučený main / běh 38169427378](https://github.com/Semiczek/diriqo/actions/runs/38169427378): **lint, TypeScript, testy a build PASS**. Poslední běh odpovídá nasazené revizi `35c24a2d2a046bbed8cc1f07a997d1fa63b3b1be`.

## Souběh dvou skutečných spojení

Samotná dvě paralelně vyvolaná MCP volání nebyla důkazem: server je provedl postupně. Proto použit `scripts/test-mobile-work-concurrency.mjs` se dvěma skutečnými Auth přihlášeními syntetického účtu a souběžnými PostgREST RPC.

Příkaz: `node scripts/test-mobile-work-concurrency.mjs --fixture=<lokální-dočasné-přihlášení.json> --case=same --delay=35000 --output=<evidence.json>`. Soubor fixture obsahuje email/password a syntetické UUID; nepatří do Gitu ani do výpisů. Přihlášení byla po běhu odhlášena.

Samostatná SQL relace držela pouze advisory lock pro danou syntetickou identitu/firmu a pravidelně četla `pg_locks` / `pg_stat_activity`. Zámek ihned uvolnila, když se objevila dvě čekající spojení:
- bariéra PID **1609018**, od 19:28:08.986609 UTC;
- v 19:28:33.862576 UTC současně čekaly **PID 1609020 a 1609021**, stav active, wait_event advisory, začátky dotazů 19:28:33.623994 a 19:28:33.796395;
- HTTP požadavky začaly 19:28:30.518 a .520 UTC, oba HTTP 200; jeden reused=false, druhý true; **stejné shift_id `434f2efc-1f4e-480d-9cce-651d1f69fbd1`**.

Druhá dvojice `--case=different --delay=0` v 19:35:24.269/.270 UTC: jeden HTTP 200, druhý HTTP 400 / `WORK_ANOTHER_SHIFT_RUNNING`; závěrečná DB aserce potvrdila právě jeden běžící časovač a nulové globální duplicity. Zde se samostatný vzorek PID nepořizoval; důkaz dvou blokovaných DB spojení patří první dvojici.

Před úspěchem byly zaznamenány transportní výpadky, příliš pozdní bariéra a prvotní chybná Auth fixture bez created_at/updated_at. Tyto pokusy nejsou PASS. Po úspěchu odstraněny pouze dvě syntetické firmy a jeden syntetický účet; závěrečná kontrola zachovala původních **5 směn**.

## Přihlášený průchod nasazeným webem

Dne 11. 10. 2026 proběhl v My Diriqo na `app.diriqo.com` skutečný průchod jako Adam Admin / Diriqo Demo: **start → obnovení stránky → stop → Hotovo**. Po obnovení zůstala právě jedna běžící směna; UI potvrdilo zastavení a dokončení a následně deaktivovalo start i Hotovo. Nešlo o nové přihlášení; použita již přihlášená relace.

Použita pouze syntetická zakázka `defc75ba-9bce-4d62-81cc-f09879d335bc` a přiřazení `240af06a-cd57-4aa6-a038-be18190f782d`. Následné čtení DB potvrdilo:

- směnu `bfdb7708-6817-4daa-98b9-514bc4aaba9f`, start `2026-10-11T19:49:16.993Z`, konec `2026-10-11T19:49:54.585013Z`, stav `completed`;
- dokončené přiřazení v `2026-10-11T19:50:23.516571Z`;
- zakázku ve stavech `waiting_check` / `partially_done`.

Po kontrole výsledků byly odstraněny pouze přesné syntetické záznamy směny, přiřazení a zakázky. Úklid ověřil firmu, označení, nulovou hodnotu, interní příznak a dokončený stav; závěrečné DB kontroly: preserved_shift_count = 5, remaining_fixture_jobs = 0. Původních pět směn zůstalo zachováno. Snímek dokončeného webového průchodu je uložen jako místní důkaz, bez osobní cesty v repozitáři.

## Omezení a další ověření

Přihlášené HTTP→Auth→PostgREST→PostgreSQL i nasazené Next UI mají výše uvedený skutečný důkaz. C04-01 zůstává **ČÁSTEČNĚ**: souběh je doložen dvěma skutečnými RPC/DB spojeními, zatím však ne současným ovládáním dvou webových karet nebo dvojklikem v nasazeném UI. Fyzický Android pilot a zachování dat po odhlášení a novém přihlášení zůstávají neověřené; nelze je odvodit z obnovení stránky.

Starší administrativní zápisy, mzdové RLS, historické sazby a úplná revokační/souběhová matice ostatních domén jsou samostatné otevřené úkoly. Žádný závěr tohoto reportu neprokazuje připravenost celého produktu.
