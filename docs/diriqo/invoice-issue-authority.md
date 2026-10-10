# Pilot licence a atomické vystavení faktury

Stav 10. 10. 2026. Migrace `20261010190442_add_invoice_issue_authority` je aplikovaná v testovacím Diriqu `wfcpfraxiuhuglnuaxqj`. **Ověřený je úzký řez založení/prvního vystavení a atomického mazání konceptu. Celý modul Fakturace ani vytvoření/export z UI nejsou dokončené. Žádná firma není do pilotu zapojená.**

## Hranice změny

- `private.invoice_module_rollouts` obsahuje explicitní nastavení firmy, dovoluje pouze `livemode=false` a nemá přístup pro `anon`, `authenticated` ani `service_role`. Zapojení je operace vlastníka DB; tabulka je prázdná. Firma bez záznamu zachovává legacy licenční režim. EUR ceny a smlouvy se nepřevádějí.
- Zapojená firma potřebuje aktuální placený grant `invoicing.invoice.issue` a placený základ Diriqo nebo POS ve stejném režimu. Kontrola používá databázový čas, firmu, rozsah, verzi politiky a platnost; klientský přepínač ani minulý grant nestačí.
- `app/invoices/actions.ts` a `lib/dal/flow.ts` používají společný `issueInvoiceAtomic` z `lib/dal/invoices.ts`. Server ověří Auth a předá pouze ID aktivní firmy a faktury. `issue_invoice_atomic` znovu ověří členství/oprávnění a zamkne fakturu; opakování již vystaveného dokladu nespotřebuje další číslo.
- Databázové triggery kontrolují také přímý INSERT a první přechod do vystaveného stavu. Vystavení faktury, přidělení čísla, změny souvisejících zakázek a zápis do `private.invoice_issue_authorizations` probíhají v jedné transakci. Soukromý neměnný původ obsahuje firmu, fakturu, entitlement, okamžik vystavení a Auth aktéra. Migrace před DDL odmítá schéma, kde `invoices.issued_at` není `timestamptz`.
- `next_invoice_number` zachovává veřejné rozhraní, ale před přidělením kontroluje aktuální oprávnění a pilotní licenci. Nepilotní firma stále potřebuje oprávněného správce.
- `delete_invoice_draft_atomic` nejprve zamkne a ověří nevystavený/neexportovaný koncept, pak provede závislé mazání v jedné transakci. Vystavená faktura se nesmí částečně rozebrat před selháním na neměnném původu. Akce už před RPC nemaže děti ani neresetuje zakázky; UI nabízí „Smazat koncept“ pouze pro koncept.

Historické SELECTy, exportní metadata a úhrada dříve vystavené faktury nedostaly plošný požadavek na dnešní placený grant. Jejich vybrané DB přechody byly ověřeny, **nikoli úplná retenční, exportní nebo settlement politika**. Tvorba/úprava konceptu, storno a úhrada dál používají více aplikačních požadavků; atomické jsou v této dávce vystavení a mazání konceptu. Úpravy položek a všechny další doménové cesty nejsou tímto pilotem licenčně uzavřené.

## Ověření

Evidence: [invoice-issue-20261010.json](evidence/invoice-issue-20261010.json), reprodukovatelná sada `supabase/tests/invoice-issue-authority.sql`.

| Kontrola | Výsledek a omezení |
|---|---|
| Fakturační DB sada | **45/45 asercí + 6 kontrol úklidu PASS**. Oprávnění/režim/závislosti, přímé zápisy a čísla, retry, vybraná historie/exportní metadata/úhrada, mazání konceptů a rollback faktury/číselné řady/zakázky při selhání zápisu původu. Hlavní fixtures vráceny rollbackem. |
| Předchozí DB sady po migraci | Znovu **31 platforma + 59 platba + 73 checkout PASS**. Celkem **208 DB asercí + 11 kontrol úklidu** hlavních sad (5 checkout, 6 fakturace). |
| Aplikační testy | **44 nových testů PASS**, celkem **503/503 v 18 souborech**. Oba vstupy vystavení, serverový scope, bezpečné chyby/odpovědi a atomické mazání konceptu. |
| Build a lint | **PASS**; kompilace 10,9 s, TypeScript 20,9 s, **83/83 stránek**, cílený ESLint PASS. |
| Stav po testech | Všech osm platebních, checkout a nových soukromých fakturačních tabulek prázdných; RLS a ACL ověřeny. |

Dvourelační pokus použil PID 1508316 a 1508317. První skončil v `19:05:40.254517 UTC`, druhý začal až v `19:05:41.093626 UTC`. Obě volání vrátila stejné číslo, právě jedno `issued:true`, číselná řada zůstala na 1 a zakázka ve stavu `due`. **Časy se nepřekrývají: jde o důkaz opakování, skutečný souběh zůstává neověřený.**

Tento samostatný pokus na rozdíl od hlavní rollback sady dočasně commitnul syntetickou nepilotní fixture. Následně byla uklizena; ověřeno odstranění firmy, faktury, zakázky, zákazníka, profilu a Auth uživatele. Tyto výsledky úklidu jsou v evidenci vedené odděleně od 11 kontrol hlavních sad.

## Advisor a kompatibilita schématu

- Nové soukromé tabulky mají INFO `rls_enabled_no_policy` záměrně: žádné klientské policies, odebrané ACL a žádný přímý klientský přístup. Nepřidávat obecnou povolující policy jen pro odstranění hlášení. [Vysvětlení a doporučená náprava 0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Stejné INFO na **veřejných** `invoice_items` a `pohoda_export_invoices` je funkční mezera: klientské operace potřebují přesně vymezené tenantové policies. V kombinaci s chybějícími sloupci `invoices.payment_method`, `is_vat_payer`, `vat_note` a dalšími poli očekávanými aplikací to brání tvrzení o ověřeném celém UI vytvoření/exportu. [Náprava 0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- `next_invoice_number` má WARN `authenticated_security_definer_function_executable`. Již před touto změnou šlo o veřejné definer RPC pro přihlášené; nová definice přidává kontrolu oprávnění a pilotní licence a používá prázdný `search_path`. Rozhraní bylo přezkoumáno a omezeno na `authenticated`; varování není vydáváno za odstraněné. [Vysvětlení a náprava 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Další krok a stav předání

Nejprve sjednotit schéma s aplikací, doplnit tenantové RLS a atomickou tvorbu/úpravu konceptu. Poté ověřit celý přihlášený tok, všechny přístupové cesty, retenční pravidla historie, vypořádání dřívějších událostí a skutečný souběh transakcí. Historická EUR práva doložit před převodem existujících firem.

Žádný ze 73 celých akceptačních scénářů nebyl touto dílčí evidencí označen jako splněný. Neproběhlo zapojení zákaznické firmy, skutečná platba, push ani deploy. Tato implementace nezapisovala do Hubu; nehodnotí stav souběžné práce jiných úloh v jeho checkoutu.
