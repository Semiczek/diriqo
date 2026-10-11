# P0: atomická mobilní práce — 11. 10. 2026

## Rozsah a stav

Výchozí auditovaná revize `cd9291e3414891de7603ec79d1a219f200903993`. Migrace `20261011191250_atomic_mobile_work.sql` je **aplikovaná pouze v testovacím Diriqu `wfcpfraxiuhuglnuaxqj`**, schémata public/private. Oprava směn z [PR #10](https://github.com/Semiczek/diriqo/pull/10) a nezávislá oprava Mailgun z PR #11 jsou sloučené. První doložený release RPC na `app.diriqo.com` byl `35c24a2d2a046bbed8cc1f07a997d1fa63b3b1be`, deployment `dpl_ET6ZRtDDCZoU4au1pDoA5ZMCade1` READY s touto doménou. Následující dvojklik a souběh dvou webových karet byly ověřeny na revizi **`915705d58d11fcc522dc43c28f55b92af6107505`**. Aktuální produkční revize po samostatném PR #13 je `6c67d9e0cbe9b9a0b5cd22146bae4a2103028db6`, deployment `dpl_9HZ1xqhnVPGj2ajw41oEDL5nSG8y` READY s aliasem `app.diriqo.com`; tím se nepřepisuje revize, na níž proběhl UI důkaz. Hub se neměnil.

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

Dne 11. 10. 2026 proběhl v My Diriqo na `app.diriqo.com`, revizi `35c24a2d2a046bbed8cc1f07a997d1fa63b3b1be`, skutečný průchod jako Adam Admin / Diriqo Demo: **start → obnovení stránky → stop → Hotovo**. Po obnovení zůstala právě jedna běžící směna; UI potvrdilo zastavení a dokončení a následně deaktivovalo start i Hotovo. Nešlo o nové přihlášení; použita již přihlášená relace.

Použita pouze syntetická zakázka `defc75ba-9bce-4d62-81cc-f09879d335bc` a přiřazení `240af06a-cd57-4aa6-a038-be18190f782d`. Následné čtení DB potvrdilo:

- směnu `bfdb7708-6817-4daa-98b9-514bc4aaba9f`, start `2026-10-11T19:49:16.993Z`, konec `2026-10-11T19:49:54.585013Z`, stav `completed`;
- dokončené přiřazení v `2026-10-11T19:50:23.516571Z`;
- zakázku ve stavech `waiting_check` / `partially_done`.

Po kontrole výsledků byly odstraněny pouze přesné syntetické záznamy směny, přiřazení a zakázky. Úklid ověřil firmu, označení, nulovou hodnotu, interní příznak a dokončený stav; závěrečné DB kontroly: preserved_shift_count = 5, remaining_fixture_jobs = 0. Původních pět směn zůstalo zachováno. Snímek dokončeného webového průchodu je uložen jako místní důkaz, bez osobní cesty v repozitáři.

## Dvě webové karty a dvojklik: C04-01 HOTOVO

Původní scénář „Dvojí kliknutí nebo dvě otevřené karty nevytvoří dva současně běžící časovače stejného pracovníka ve firmě.“ je nyní **HOTOVO**. Dne 11. 10. 2026 byly na nasazené revizi `915705d58d11fcc522dc43c28f55b92af6107505` otevřeny dvě skutečné karty `/mobile/my` stejného přihlášeného Adam Admin / Diriqo Demo. Použita pouze nová interní syntetická zakázka s nulovou cenou `ffa8b3ca-2845-475a-be15-a99ac270c87a` a přiřazení `7b9ee6ad-5adf-4e29-8822-bd4a80730fd7`.

| Akce v nasazeném UI | Následný důkaz UI a databáze |
|---|---|
| Souběžný start ze dvou karet v 20:11:49 UTC; oba skutečné kliky spuštěny přes `Promise.allSettled` | Obě karty zobrazily jednu běžící směnu. DB potvrdila právě jeden řádek `9c982ef3-4189-487b-a32e-1fe96bbfaad8`, start `2026-10-11T20:11:49.156858Z`. |
| Stop v `2026-10-11T20:12:16.321223Z` a obnovení druhé karty | První směna zůstala ukončená; druhá karta po obnovení zobrazila 0 běžících směn. |
| Skutečný dvojklik na Start (`clickCount: 2`) | Vznikla právě jedna nová směna `972977d5-ab88-4181-8e16-79be4abe290b`, start `2026-10-11T20:12:42.385781Z`. První směna zůstala ukončená, celkový počet běžících byl 1. |
| Stop v `2026-10-11T20:12:59.219262Z` | DB potvrdila 0 běžících směn. |

Úklid nejdříve ověřil přesnou identitu zakázky/přiřazení a dvě ukončené testovací směny, potom odstranil pouze tyto fixtures. Závěrečná kontrola: `preserved_shift_count = 5`, `remaining_fixture_jobs = 0`, `remaining_fixture_shifts = 0`, `remaining_fixture_assignments = 0`. Původní data zůstala zachována. Snímek `mobile-two-tabs-one-shift.png` je uložen jako místní důkaz; osobní cesta není v repozitáři.

## Omezení a další ověření

HOTOVO platí pro přesný původní invariant C04-01, podložený skutečným DB souběhem i dvojklikem/dvěma kartami v nasazeném webu. Neznamená dokončení celého mobilního produktu. Fyzický Android pilot a zachování dat po odhlášení a novém přihlášení zůstávají neověřené; nelze je odvodit z obnovení stránky. Pozdní nový start po ukončení první směny je legitimní nový časovač, nikoli důkaz trvalé idempotence starého požadavku.

Starší administrativní zápisy, mzdové RLS, historické sazby a úplná revokační/souběhová matice ostatních domén jsou samostatné otevřené úkoly. Žádný závěr tohoto reportu neprokazuje připravenost celého produktu.
