# P0: neměnný obsah vydaných faktur — 11. 10. 2026

## Rozsah a stav

Migrace `20261011195912_lock_issued_invoice_accounting_content.sql` je **aplikovaná pouze v testovacím Diriqu `wfcpfraxiuhuglnuaxqj`**. Na `public.invoices` přidává trigger `guard_invoice_accounting_content` s funkcí `private.guard_invoice_accounting_content()`. Ochrana v této databázi již působí; změna neobsahuje webový kód a nevyžaduje nový webový deployment. Commit/PR a jeho CI při tomto checkpointu ještě nejsou uzavřené.

Oprava chrání finanční a kontaktní obsah již vydaného dokladu na společné databázové hranici. **Neřeší atomickou editaci konceptu, souběh úhrady/storna, ochranu DELETE ani úplný fakturační lifecycle.** Tyto P0 úkoly zůstávají otevřené. JSPD Hub se neměnil.

## Potvrzená původní chyba

Skutečný syntetický test v cílové databázi proběhl jako `authenticated` správce firmy: vytvoření konceptu → atomické vystavení → přímý UPDATE finančního součtu na `999` a nahrazení IBAN ve snapshotu dodavatele. Oba zásahy do již vydaného účetního obsahu **před opravou uspěly**. Celá fixture byla vrácena zpět; test tak doložil konkrétní chybějící invariant, nikoli pouze odhad ze staré migrace.

## Co migrace chrání a co zachovává

Funkce běží jako `SECURITY INVOKER`, s prázdným `search_path`, bez privilegovaných čtení nebo zápisů. Nemění existující tabulková oprávnění ani RLS a nevytváří veřejnou RPC. Oprávnění k nové interní funkci jsou odebrána veřejným aplikačním rolím; její účel je pouze trigger.

- Na aktuálním schématu je chráněno **28 obsahových sloupců**, včetně historických aliasů. Porovnání přes celý záznam chrání standardně také budoucí sloupce; změna obsahu končí `INVOICE_CONTENT_IMMUTABLE` / SQLSTATE `23514`.
- **10 provozních sloupců** zůstává mimo tento obsahový invariant: `status`, `sent_at`, `paid_at`, `cancelled_at`, `updated_at`, `pohoda_export_status`, `pohoda_exported_at`, `pohoda_last_error`, `pohoda_external_id`, `pohoda_last_export_id`. Dosavadní guard nadále ověřuje existující pravidla číslování a přechodů stavů; výjimka z nového obsahového porovnání není nové oprávnění.
- Koncept s `OLD.status = 'draft'` a `OLD.issued_at IS NULL` si zachovává dosavadní editaci a první vystavení. Rozhoduje původní řádek, takže současná změna stavu nemůže odemknout obsah již vydané faktury.
- Vazby `job_id` a `created_by` dovolují pouze historické odpojení z neprázdné hodnoty na `NULL`; přeřazení nebo opětovné připojení jsou zakázané. Odpojení neumožní současně měnit účetní snapshoty. Tím zůstávají kompatibilní stávající FK `SET NULL` a odpojení při bezpečném mazání zakázky.
- `job_id` není na každé podobě schématu. Review odhalil původní nesoulad s kanonickými migracemi; před aplikací byly přidány kontroly existence volitelných JSONB polí. Kanonická varianta bez šesti dodatečných runtime sloupců je součástí lokálního testu.

## Příprava a dopad migrace

Před změnou byl ověřen projekt `wfcpfraxiuhuglnuaxqj`, schéma s **38 sloupci**, definice souvisejících triggerů a předchozí migrační verze `20261011191250`. Tabulka obsahovala **0 existujících faktur**; zaznamenaný fingerprint odpovídá tomuto počtu. Cílená záloha schématu, triggerů a stavu je uložená ve spravovaném důkazovém úložišti jako `artifacts/invoice-content/prechange-20261011.json`, bez osobních lokálních cest v tomto repozitáři.

Migrace je aditivní, s omezením čekání na zámek na pět sekund. Žádná existující obchodní data nepřepisuje. Cílený předmigrační snímek není důkazem obnovy celého SaaS.

## Skutečně provedené kontroly

- Živá reprodukce před opravou jako firemní správce: nežádoucí změna vydaného finančního součtu a dodavatelského IBAN uspěla; syntetická fixture rollback.
- Lokální PostgreSQL/PGlite: **57/57 PASS**, včetně kanonického schématu bez šesti runtime sloupců. Jde o lokální databázový důkaz, nikoli náhradu testu oprávnění v nasazeném Supabase.
- První běh `supabase/tests/invoice-issued-content.sql` po aplikaci prošel kontrolami účetního obsahu, provozních změn, historických FK, pracovníka a cizí firmy, poté skončil na nesprávném očekávání testu pro `service_role`. Test očekával obsahový trigger (`23514`), skutečná databáze vrátila `42501 permission denied`, protože tato role nemá SELECT/UPDATE na `invoices`. Šlo o nesoulad testu se skutečnými granty, nikoli o obejití nové ochrany. **Tento běh není označen PASS**; celá fixture byla rollback a počet faktur zůstal 0.
- Opakovaný skutečný test po opravě očekávání grantů: **55 kontrol + 5 kontrol úklidu PASS**. Pro service_role bez tabulkových oprávnění se ověřuje skutečné odmítnutí 42501; samostatný pokus vlastníka tabulky prokazuje samotný trigger (SQLSTATE 23514) a zachování celého původního řádku. Test nevyžaduje rozšíření žádných grantů.

Finální živé SQL ověření a návazné existující regresní sady:

| SQL soubor | Výsledek |
|---|---|
| `supabase/tests/invoice-issued-content.sql` | 55 kontrol + 5 kontrol úklidu PASS |
| `supabase/tests/invoice-draft-transactions.sql` | 63 kontrol + 6 kontrol úklidu PASS |
| `supabase/tests/invoice-issue-authority.sql` | 45 kontrol + 6 kontrol úklidu PASS |

Celkem **163 kontrol + 17 kontrol úklidu PASS**; všechny tři fixtures byly rollback. Regrese zahrnují základní fakturaci u placeného POS, historické dokončení/export po expiraci, retry číslování a rollback. Závěrečná kontrola: `invoice_count = 0`, `work_shift_count = 5`, `residual_fixture_companies = 0`, migrační verze `20261011195912`. Tyto běhy proběhly v jednotlivých relacích a neprokazují současné fakturační transakce.

Souhrn Supabase advisors před/po se nezměnil: 39 INFO k soukromým tabulkám s [RLS bez policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy); WARN pro 1 funkci s proměnným search path, 12 anon-executable a 36 authenticated-executable SECURITY DEFINER funkcí a 1 vypnutou ochranu proti uniklým heslům. Souhrn nepřidal nové varování; stávající nálezy zůstávají k posouzení a nejsou automaticky označené za potvrzené zranitelnosti.

## Návrat a zbývající ověření

Při návratu webové verze ponechat aditivní obsahový trigger. Pokud se zjistí skutečná kompatibilitní chyba, opravit ji další verzovanou migrací po konkrétní reprodukci a testu. Neodstraňovat automaticky ochranu účetního obsahu ani nepřehrávat starou tabulku přes nové záznamy; již aplikovanou migraci zpětně neupravovat.

Ochrana obsahu nemění povolené účetní operace na atomické transakce. Odděleně zůstávají editace hlavičky/položek konceptu, souběh zaplacení a storna s návaznými zakázkami, DELETE, celý prodejní/účetní E2E a daňová akceptace pro konkrétní zemi. Jednorelační SQL test není důkazem současných fakturačních transakcí. Komerční připravenost celého produktu se tímto reportem netvrdí.
