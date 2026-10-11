# P0: atomická mobilní práce — 11. 10. 2026

## Rozsah a stav
Základ `cd9291e3414891de7603ec79d1a219f200903993`. Nová migrace `20261011191250_atomic_mobile_work.sql` je **aplikovaná pouze v testovacím Diriqu `wfcpfraxiuhuglnuaxqj`**, schémata public/private. Aplikační přechod na RPC je při tomto checkpointu lokální, čeká na PR/CI a nasazení. Hub se neměnil.

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

## Souběh dvou skutečných spojení
Samotná dvě paralelně vyvolaná MCP volání nebyla důkazem: server je provedl postupně. Proto použit `scripts/test-mobile-work-concurrency.mjs` se dvěma skutečnými Auth přihlášeními syntetického účtu a souběžnými PostgREST RPC.

Příkaz: `node scripts/test-mobile-work-concurrency.mjs --fixture=<lokální-dočasné-přihlášení.json> --case=same --delay=35000 --output=<evidence.json>`. Soubor fixture obsahuje email/password a syntetické UUID; nepatří do Gitu ani do výpisů. Přihlášení byla po běhu odhlášena.

Samostatná SQL relace držela pouze advisory lock pro danou syntetickou identitu/firmu a pravidelně četla `pg_locks` / `pg_stat_activity`. Zámek ihned uvolnila, když se objevila dvě čekající spojení:
- bariéra PID **1609018**, od 19:28:08.986609 UTC;
- v 19:28:33.862576 UTC současně čekaly **PID 1609020 a 1609021**, stav active, wait_event advisory, začátky dotazů 19:28:33.623994 a 19:28:33.796395;
- HTTP požadavky začaly 19:28:30.518 a .520 UTC, oba HTTP 200; jeden reused=false, druhý true; **stejné shift_id `434f2efc-1f4e-480d-9cce-651d1f69fbd1`**.

Druhá dvojice `--case=different --delay=0` v 19:35:24.269/.270 UTC: jeden HTTP 200, druhý HTTP 400 / `WORK_ANOTHER_SHIFT_RUNNING`; závěrečná DB aserce potvrdila právě jeden běžící časovač a nulové globální duplicity. Zde se samostatný vzorek PID nepořizoval; důkaz dvou blokovaných DB spojení patří první dvojici.

Před úspěchem byly zaznamenány transportní výpadky, příliš pozdní bariéra a prvotní chybná Auth fixture bez created_at/updated_at. Tyto pokusy nejsou PASS. Po úspěchu odstraněny pouze dvě syntetické firmy a jeden syntetický účet; závěrečná kontrola zachovala původních **5 směn**.

## Omezení a další ověření
Přihlášené HTTP→Auth→PostgREST→PostgreSQL je skutečný integrační průchod. Není to nové ověření nasazeného Next UI ani fyzického Android telefonu. Ještě ověřit finální commit v CI/build/deployment a ruční start/stop/dokončení v UI. C04-01 se posouvá z CHYBA na ČÁSTEČNĚ do této poslední kontroly.

Starší administrativní zápisy, mzdové RLS, historické sazby a úplná revokační/souběhová matice ostatních domén jsou samostatné otevřené úkoly. Žádný závěr tohoto reportu neprokazuje připravenost celého produktu.
