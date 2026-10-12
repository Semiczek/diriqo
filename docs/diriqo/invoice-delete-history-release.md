# P0: uchování fakturační historie při DELETE — 11. 10. 2026

## Rozsah a stav

Migrace `20261011202311_retain_issued_invoice_history.sql` je **aplikovaná pouze v testovacím Diriqu `wfcpfraxiuhuglnuaxqj`**. Přidává `BEFORE DELETE` trigger `guard_invoice_delete` na `public.invoices` a funkci `private.guard_invoice_delete()`. Ochrana je v databázi aktivní; implementace z commitu `11e3a80` je sloučená v [PR #16](https://github.com/Semiczek/diriqo/pull/16), merge `4a0de93a2968221a77e34e641ee839c3bd85c069`. [CI přesného headu 38172332463](https://github.com/Semiczek/diriqo/actions/runs/38172332463) i [CI main 38228027291](https://github.com/Semiczek/diriqo/actions/runs/38228027291) PASS. Produkční Vercel `dpl_B8ShkGM3jiJW2PUWTiXUVaUbAnTr` je READY pro tento merge s aliasem `app.diriqo.com` (ověřeno 12. 10. 2026). Webový kód se touto opravou neměnil; databázová ochrana byla aktivní již před deploymentem. JSPD Hub se neměnil.

Výchozí checkout tohoto celku je main `b411fdab46d6bc6b13d3f2d8cd5f4660243bc68d`. Předchozí dokumentační PR #15 bylo sloučeno; jeho přesný head `f04bff082357b3204b21e6c408af92813140a526` má [CI 38171593447](https://github.com/Semiczek/diriqo/actions/runs/38171593447) SUCCESS. Tento starší CI běh není ověřením nové migrace.

## Původní chyba a zvolená hranice

Živý syntetický baseline test jako `authenticated` správce firmy potvrdil chybějící ochranu fakturační historie při přímém DELETE: **7 kontrol + 5 kontrol úklidu**, vše rollback. Dosavadní kontrola v cestě pro smazání konceptu nebyla společným pravidlem všech zápisů do tabulky.

Nový trigger rozhoduje podle původního řádku a odmítne DELETE chybou `INVOICE_DELETE_FORBIDDEN` / SQLSTATE `42501`, pokud je splněná některá podmínka:

- `OLD.status IS DISTINCT FROM 'draft'`, včetně neočekávaného `NULL` ve starším schématu, které by jej připouštělo;
- `OLD.issued_at IS NOT NULL`;
- `OLD.pohoda_export_status = 'exported'`.

Trigger se uplatní také při referenčním kaskádovém DELETE. Běží jako `SECURITY INVOKER` s prázdným `search_path`, bez privilegovaných čtení, změn dat, existujících tabulkových grantů nebo RLS. Nová interní funkce není veřejná RPC a nemá aplikační EXECUTE granty.

Dosud nevydané a neexportované koncepty lze dál odstranit, včetně období po expiraci licence. Nezměnila se stávající autorita, účetní stavy ani licenční pravidla. Zachován je záznam původního požadavku na vytvoření konceptu po jeho smazání, takže opakování stejného požadavku neobnoví smazaný obchodní objekt.

## Příprava a dopad migrace

Před změnou, v **20:15:55 UTC**, byl ověřen cílový projekt, migrační hlava `20261011195912`, **0 faktur a 5 původních směn**. Cílená záloha relevantních metadat a řádků je ve spravovaném úložišti jako `artifacts/invoice-delete/prechange-20261011.json`. Jde o bod před touto konkrétní změnou, nikoli důkaz úplné obnovy SaaS.

Migrace je aditivní, s pětisekundovým limitem čekání na zámek. Nepřepisuje existující obchodní data. Po aplikaci se pouze název lokálního souboru sjednotil s autoritativní serverovou verzí; aplikovaný obsah se nezměnil. SHA-256 obsahu migrace: `47B3692E5C960D967821D873C0E9D65DDC4EDB43CA976203C43D8450C6F3EE68`.

## Skutečně provedené kontroly

- Lokální PGlite: **21/21 PASS**, včetně starší varianty s NULL stavem a kaskády. Živá databáze NULL stav svým schématem nepřipouští; místní variantu nelze označit za živý NULL test.
- Nové nezávislé review bez sdílené historie nenašlo statický blokující problém. Úzkou runtime hranici následně ověřily skutečné SQL běhy uvedené níže.
- Nová sada `supabase/tests/invoice-delete-history.sql`: **33 kontrol + 10 kontrol úklidu PASS na první běh**. Skutečný kaskádový pokus o odstranění firmy dosáhl nového `invoice_delete_guard`; účetní historie zůstala zachována. Samostatný pokus vlastníka tabulky ověřil samotný trigger. `service_role` nemá na živé tabulce SELECT/DELETE a správně skončil již na oprávnění (`42501`); granty se kvůli testu nerozšiřovaly.
- Ověřeny také worker a cizí firma, legacy/paid/test/expired koncepty, zachování záznamu původního požadavku a atomické odmítnutí smíšeného DELETE: při zahrnutí chráněné faktury se neodstranil ani jinak smazatelný koncept.

| Skutečná SQL sada po aplikaci | Kontroly | Kontroly úklidu |
|---|---:|---:|
| `supabase/tests/invoice-delete-history.sql` | 33 PASS | 10 PASS |
| `supabase/tests/invoice-draft-transactions.sql` | 63 PASS | 6 PASS |
| `supabase/tests/invoice-issue-authority.sql` | 45 PASS | 6 PASS |
| `supabase/tests/invoice-issued-content.sql` | 55 PASS | 5 PASS |
| **Celkem** | **196 PASS** | **27 PASS** |

Všechny čtyři fixtures byly rollback. Regrese zahrnuly také opakování požadavku již smazaného konceptu se stavem `gone` a skutečný DELETE původní zakázky, který zachoval fakturační historii a odpojil `invoice.job_id` na NULL. Závěrečná kontrola potvrdila **0 faktur, 5 původních směn, 0 zbývajících syntetických firem této sady a instalovaný nový guard**.

Výsledky jsou uchované v `artifacts/invoice-delete/live-verification-20261011.json`; osobní cesta není součástí repozitáře. SHA-256 ověřeného nového SQL testu: `6D91789F06684E9C30DD0198A1A057B3CF9672619EB1EE1A035D28BCB2BD0F37`.

Supabase advisors po DELETE migraci mají stejné normalizované nálezy jako před ní; liší se pouze čas pozorování. Celkem **39 INFO pro [RLS bez policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)** tvoří 20 tabulek v private a 19 v public. Dále zůstává 1 WARN k proměnnému search path, 12 anon-executable a 36 authenticated-executable SECURITY DEFINER varování a 1 WARN k ochraně proti uniklým heslům. Důkaz: `artifacts/invoice-delete/advisors-post-20261011.json`. Nový nález nebyl v tomto porovnání přidán; stávající varování zůstávají k jednotlivému posouzení a nepředstavují automaticky potvrzené zranitelnosti.

## Hranice důkazu a návrat

Každá sada ověřuje operace postupně uvnitř jedné databázové relace. **Skutečné fakturační UI ani souběh vystavení proti DELETE zatím tímto reportem ověřené nejsou.** Vlastník tabulky byl testován při běžném DELETE, nikoli při změně nebo vypnutí triggerů.

Značka exportu u konceptu, který nikdy nebyl vydaný, zůstává samostatnou mezerou: lze ji před DELETE resetovat. `TRUNCATE` není tímto řádkovým triggerem řešen; není doložená dosažitelná aplikační cesta. Tyto dvě hranice se nesmějí vydávat za uzavřenou retenci všech dat. Atomická editace konceptu a souběh úhrady/storna zůstávají otevřené P0.

Samostatně ověřená živá metadata tehdy ukázala chybějící unikátnost `(company_id, invoice_number)`: dostupný byl PK `id` a neunikátní index `(company_id, issue_date)`. Kanonický `CREATE TABLE IF NOT EXISTS` omezení na již existující tabulku nedoplnil. Tuto oddělenou chybu následně potvrdila živá baseline a opravila migrace `20261012091656_enforce_invoice_number_uniqueness.sql`; skutečné SQL regrese i souběh dvou přihlášených PostgREST relací prošly. Důkazy a otevřená hranice nového aplikačního hlášení/UI jsou v [samostatném reportu jedinečnosti čísel](invoice-number-uniqueness-release.md). Nejde o účinek DELETE migrace.

Při návratu webové verze ponechat aditivní ochranu historie. Konkrétní potvrzenou kompatibilitní chybu řešit další verzovanou migrací s regresí; již aplikovaný soubor zpětně neměnit. Neodstraňovat automaticky trigger ani neobnovovat staré řádky přes nové obchodní události. Stav 73 scénářů zůstává **1 HOTOVO / 48 ČÁSTEČNĚ / 12 CHYBÍ / 7 CHYBA / 5 NEOVĚŘENO** a komerční připravenost celého Diriqa se netvrdí.
