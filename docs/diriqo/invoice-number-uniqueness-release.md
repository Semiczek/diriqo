# P0: jedinečné číslo faktury ve firmě — 12. 10. 2026

## Rozsah a stav

Migrace `20261012091656_enforce_invoice_number_uniqueness.sql` je **aplikovaná pouze v testovacím Diriqu `wfcpfraxiuhuglnuaxqj`**. Databáze nyní vynucuje `UNIQUE (company_id, invoice_number)` pod názvem `invoices_company_number_uidx`. Oprava schématu je aktivní. Implementační checkpoint je commit `8855e36`. Navazující bezpečné zobrazení konfliktu v aplikaci je lokálně ověřené; PR, jeho CI a nasazení této nové aplikační změny při tomto checkpointu ještě čekají. JSPD Hub se neměnil.

Poslední potvrzený webový release je předchozí [PR #16](https://github.com/Semiczek/diriqo/pull/16), merge `4a0de93a2968221a77e34e641ee839c3bd85c069`. [CI přesného headu 38172332463](https://github.com/Semiczek/diriqo/actions/runs/38172332463) a [CI main 38228027291](https://github.com/Semiczek/diriqo/actions/runs/38228027291) mají PASS. Vercel `dpl_B8ShkGM3jiJW2PUWTiXUVaUbAnTr` je READY pro tento merge s aliasem `app.diriqo.com`. Jde o důkaz vydání předchozí ochrany DELETE, nikoli nasazení nového zobrazení konfliktu čísla.

## Původní chyba a pravidlo opravy

Živá tabulka měla pouze primární klíč `id` a neunikátní index `(company_id, issue_date)`. Kanonický `CREATE TABLE IF NOT EXISTS` sice obsahoval jedinečnost čísla, existující tabulku však nedoplnil. Skutečný baseline test jako oprávněný správce potvrdil duplicity při tvorbě a úpravě konceptů i vůči stornované faktuře: **12 kontrol + 8 kontrol úklidu**, vše rollback. Dosavadní kontrola konfliktu v cestě pro vystavení fungovala, ale nepokrývala všechny zápisy do tabulky.

Nové omezení je společné pro INSERT a UPDATE bez ohledu na aplikační cestu:

- stejné nenulové číslo smí být v jedné firmě právě jednou, bez ohledu na stav faktury nebo rok;
- jiná firma může mít stejné číslo;
- nenumerované koncepty s `invoice_number = NULL` zůstávají povolené ve více řádcích;
- porovnává se uložená hodnota; migrace čísla nepřeformátovává ani nepřečíslovává.

Migrace v transakci zamkne tabulku, ověří definici již existujícího stejnojmenného omezení a teprve potom případně přidá chybějící constraint. Shoda názvu bez odpovídající validní, okamžité unikátnosti přes přesné dva sloupce nestačí. Při odlišné definici skončí `INVOICE_NUMBER_CONSTRAINT_DEFINITION_MISMATCH`; při existujících duplicitách `INVOICE_NUMBER_DUPLICATES_REQUIRE_REVIEW`. Ani jedna větev automaticky nemaže, neslučuje nebo nepřečíslovává data. RLS, granty a oprávnění se nemění.

## Příprava a dopad

Před změnou v **09:13:32 UTC** vznikla cílená záloha relevantních metadat a řádků. Bylo ověřeno **0 faktur, 0 jejich položek, 0 vazeb, 0 číselných řad a 5 původních směn**. Čerstvá kontrola v **09:16:44 UTC**, těsně před aplikací, potvrdila stejné počty. Jde o bod návratu pro tuto konkrétní změnu, nikoli důkaz úplné obnovy SaaS.

Použitý `lock_timeout` je **5 sekund**, `statement_timeout` **30 sekund**. Zámek brání vložení duplicity mezi kontrolou a vytvořením omezení; během migrace může krátce zdržet práci s tabulkou. Žádné historické obchodní řádky nebyly přepsány. SHA-256 aplikovaného obsahu migrace: `9C9D29F34284D207522E503FDDC43C6B992BE1EF78D117CA06B033FB5D47F787`.

## Aplikační hlášení konfliktu

Sdílené mapování pro vystavení i aktualizaci hlavičky konceptu rozpoznává skutečná pole PostgREST `code` a `message`: SQLSTATE `23505` spolu s přesným názvem `invoices_company_number_uidx`. Zachovává také existující aplikační chybu `INVOICE_NUMBER_CONFLICT`. Uživateli vrací „Toto číslo faktury už v aktivní firmě existuje.“

Mapování nečte databázové `details` s konfliktní hodnotou. Jiné unikátní konflikty ani podobné názvy omezení se za konflikt čísla nevydávají. Po konfliktu hlavičky se neprovádějí zápisy položek ani revalidace; akce nevrací úspěch. Tím se neřeší samostatná neatomicita celé editace hlavičky a položek.

## Provedené kontroly

- Nové nezávislé posouzení kandidáta nenašlo konkrétní blokující problém v migraci ani v bezpečném mapování aplikační chyby. Lokální PGlite ověření: **20/20 PASS** na PostgreSQL 18.3; živý cíl používá PostgreSQL 17.6 a má samostatné skutečné SQL důkazy níže.
- Cílené aplikační testy: **137 PASS**, včetně přesného mapování, odmítnutí nesouvisejících chyb, oprávnění a zastavení následných zápisů/revalidace po konfliktu. Celá lokální sada: **1034/1034 PASS ve 42 souborech**. TypeScript a lint PASS.
- Skutečné SQL sady po aplikaci běžely se zapnutými asercemi. Každá sada ověřuje operace postupně uvnitř jedné databázové relace.

| Skutečná SQL sada po aplikaci | Kontroly | Kontroly úklidu |
|---|---:|---:|
| `supabase/tests/invoice-number-uniqueness.sql` | 27 PASS | 8 PASS |
| `supabase/tests/invoice-draft-transactions.sql` | 63 PASS | 6 PASS |
| `supabase/tests/invoice-issue-authority.sql` | 45 PASS | 6 PASS |
| `supabase/tests/invoice-issued-content.sql` | 55 PASS | 5 PASS |
| `supabase/tests/invoice-delete-history.sql` | 33 PASS | 10 PASS |
| **Celkem** | **223 PASS** | **35 PASS** |

Všech pět fixtures bylo rollback. SHA-256 nové SQL sady: `5D4A756CA38B321D6B7B59A95A66B8C55FB52DD2A40C1E39AD5ADCBB02D0948A`. Spravované důkazy před změnou, baseline, živé verifikace a nezávislého review jsou v kolekci `artifacts/invoice-number/` z 12. 10. 2026; osobní cesta není součástí repozitáře.

Normalizované Supabase advisors jsou před a po změně shodné; nepřibyl nový nález. Zůstává **39 INFO [RLS bez policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)**, z toho 20 private a 19 public tabulek; dále 1 WARN proměnného search path, 12 anon-executable a 36 authenticated-executable SECURITY DEFINER varování a 1 WARN ochrany proti uniklým heslům. Stávající varování vyžadují jednotlivé posouzení a sama nepředstavují potvrzené zranitelnosti.

## Skutečný souběh dvou přihlášených relací

První pokus přes MCP byl ve skutečnosti serializovaný; tento pokus není důkazem souběhu. Následující samostatný test `scripts/test-invoice-number-concurrency.mjs` použil dvě skutečné Auth relace a paralelní PATCH požadavky přes přímé PostgREST rozhraní. Transakční bariéra bez změny DDL nebo grantů umožnila ověřit jejich překryv: v **09:27:57.498555 UTC** vlastník spojení PID 56344 pozoroval současně aktivní spojení `authenticator` PID 56347 a 56348, obě čekající na `Lock / transactionid` blokovaný PID 56344.

Po uvolnění bariéry skončil požadavek A **HTTP 409 / SQLSTATE 23505** s očekávanou zprávou obsahující přesný název omezení a požadavek B **HTTP 200**. Závěrečná kontrola našla právě jednu fakturu s požadovaným číslem; celý řádek neúspěšného požadavku včetně poznámky zůstal beze změny. Tím je doložen skutečný řízený konflikt při souběžném přidělení stejného čísla dvěma konceptům i skutečný tvar PostgREST chyby pro aplikační mapování.

Obě Auth relace byly odhlášeny. Přesný úklid odstranil pouze syntetický Auth účet, profil, firmu, zákazníka a dva koncepty této zkoušky. Následná kontrola potvrdila 0 zbývajících relací/identit této fixture, **0 faktur a 5 původních směn**. Soukromý soubor s fixture heslem byl odstraněn. Důkazy: `artifacts/invoice-number/http-concurrency-verification-20261012.json` a `artifacts/invoice-number/http-concurrency-queries.sql`. SHA-256 ověřeného skriptu: `D2BEB2B6509EE9AFDA095967B57DABE45A95572D2DCC6310F726D72B1A1524E5`.

## Hranice důkazu a návrat

**Přihlášené fakturační UI zatím není tímto checkpointem prokázáno.** Doložený souběh přidělení čísla přes PostgREST nenahrazuje ostatní závody fakturačních operací. Lokální testy aplikačního hlášení nejsou důkazem jeho nasazení nebo zobrazení v prohlížeči.

P0-11 je opravený v rozsahu databázového pravidla jedinečnosti a jeho uvedených testů. Atomická editace konceptů, souběh úhrady/storna, širší fakturační lifecycle a hranice ochrany DELETE zůstávají samostatně otevřené. Stav původních 73 scénářů se nemění: **1 HOTOVO / 48 ČÁSTEČNĚ / 12 CHYBÍ / 7 CHYBA / 5 NEOVĚŘENO**. Komerční připravenost celého Diriqa se netvrdí.

Při návratu aplikační verze ponechat databázové omezení. Potvrzenou kompatibilitní chybu řešit novou verzovanou opravnou migrací s regresí; již aplikovaný soubor zpětně neměnit. Neodstraňovat ochranu ani automaticky neslučovat, nemazat či nepřečíslovávat účetní data.
