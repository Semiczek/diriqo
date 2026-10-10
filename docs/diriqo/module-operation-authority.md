# Serverová autorita placených operací

Stav 10. 10. 2026: aplikace má společnou kontrolu 23 firemních operací, první zapojení zakázek a návaznost na fakturační pilot. **Migrace `20261010193801_add_module_capability_authority` je aplikovaná v testovacím Diriqu. Celkem prošlo 361 DB asercí a 23 kontrol úklidu; build, TypeScript a cílený ESLint mají PASS. Závěrečná aplikační sada má 664/664 PASS v 22 souborech.** Nejde o dokončené vynucování licencí v celém Diriqu ani o připravenost k prodeji.

## Skládání produktů a zapojení firmy

Modularita nyní znamená společnou platformu a registr produktů/schopností s oddělenými placenými nároky. Jádro a doplňky lze skládat podle závislostí. Nejde o samostatně instalovatelné pluginy; zápis produktu v registru sám nepotvrzuje hotovou doménovou funkci.

Aplikovaná migrace [20261010193801_add_module_capability_authority.sql](../../supabase/migrations/20261010193801_add_module_capability_authority.sql) přidala v projektu `wfcpfraxiuhuglnuaxqj` soukromý `private.company_module_rollouts` s klíčem firma/produkt. Zapojení je výslovné, pouze pro testovací režim, bez automatického naplnění. Tabulka má RLS a nemá oprávnění pro `anon`, `authenticated` ani `service_role`; řídí ji vlastník DB. Stávající fakturační pilot v `private.invoice_module_rollouts` zůstává uznávaný.

Firma bez záznamu pro příslušný produkt zachovává dosavadní pravidla přístupu. Výsledek `legacy` neprokazuje úhradu ani trial a nepřiděluje nový nárok. Potvrzená modulová platba zapisuje trvalé placené období, ale sama nepřevádí stávající firmu do nového režimu vynucování. Před takovým převodem je nutný doložený migrační kontrakt původních EUR předplatných a historie. Adaptér legacy předplatného zůstává diagnostický; chybějící licenci nenahrazuje automaticky novým trialem.

## Rozhodnutí na serveru

`lib/platform/module-operation-access.ts` ověřuje uživatele přes `getUser()` a volá `get_company_capability_access`. Databáze znovu ověřuje aktivní členství a používá vlastní čas, verzi politiky, firmu, produkt, režim a platné neodvolané placené období. Veřejná odpověď obsahuje jen `company_id`, `capability`, `enforced`, `allowed`, `reason`, `livemode`; nepředává identifikátor grantu jako oprávnění k zápisu. Interní varianta s časovým parametrem není dostupná přihlášenému klientovi.

| Produkt | Podporované nové firemní operace | Placená závislost |
|---|---:|---|
| Diriqo základ | 17: zakázky, zákazníci, pracovníci, sazby, čas, jednoduché nabídky, kalendář, absence, zálohy, soubory, předání a náklady | Samotné jádro |
| Sklad | 2: příjem a pohyb | Jádro nebo POS |
| Fakturace | 1: vystavení | Jádro nebo POS |
| Chytré nabídky | 1: správa šablony | Jádro |
| Vozidla | 2: vozidlo a jízda | Jádro |

Závislost musí patřit stejné firmě, režimu a právě platnému období. Rozhraní nepřijímá klientské granty, ceny, čas ani režim. U zapojené firmy musí serverové `DIRIQO_MODULE_BILLING_MODE` odpovídat DB; chybějící nebo odlišná konfigurace vrací nedostupnost. Nezapojená firma zůstává v explicitní legacy větvi bez požadavku na toto nastavení. Chyba autority nemá povolovací fallback.

`lib/module-access.ts` nyní skládá placené oprávnění s dosavadním provozním přepínačem. Nejdřív ověří licenci, teprve potom čte staré nastavení, jehož loader může doplňovat chybějící výchozí řádky. Zapnutí položky v `company_modules`, její zobrazení v menu ani firemní administrátorská role samy licenci nevytvářejí. Role, vlastnictví objektu, RLS a další doménové podmínky zůstávají samostatně vyžadované.

## Skutečný rozsah zapojení

- `app/jobs/actions.ts`: všech sedm zapisujících akcí kontroluje licenci před doménovými čteními a zápisy. Běžné vytváření, souhrnná zakázka a nová skupina vyžadují `core.jobs.create`; připojení/odpojení, odpojení zákazníka a bezpečné mazání používají `core.jobs.update`.
- `PATCH /api/jobs/[jobId]`: ověřuje `core.jobs.update`; dokončení pomocí `status=done` navíc ověří `core.jobs.close` před prvním zápisem.
- `/jobs/new` má serverovou kontrolu před zobrazením původního klientského formuláře. Zamítnutí nebo nedostupnost nabídne odkaz na moduly i návrat k zakázkám. Zpráva 403 může vysvětlit také změněné členství; netvrdí automaticky, že stačí něco koupit.
- `/invoices/new` obdobně kontroluje `invoicing.invoice.issue` před načtením podkladů. Tvorba a první vystavení navazují na existující atomické RPC a databázové ochrany.
- Existující volání `requireCompanyModule` v kalendáři, jednoduchých nabídkách, kontaktech zakázek a vybraných pracovních financích přebírají novou licenční vrstvu. To neznamená úplné pokrytí těchto oblastí.
- Nový DB trigger při každém `INSERT` zakázky zapojené firmy vyžaduje placené `core.jobs.create` a explicitní roli `company_admin`/`super_admin`; samotný `manager` nestačí. Stejný trigger zakazuje změnu `jobs.id` a `jobs.company_id`, aby nešlo vytvořit záznam v nezapojené firmě a následně jej převést do zapojené. Tato neměnnost identity platí i pro dosavadní firmy.
- Fakturační autorita používá společné vyhodnocení nároků a uznává oba rollout registry. Zůstávají zachované dosavadní zámky, atomické číslování, změna stavu zakázek a původ vystavení. Nová role hranice zakázek nemění starší fakturační význam `is_company_admin`; v ověřené DB tento existující helper zahrnuje také managera.

## Meze a dostupnost předplatného

DB má ochranu vytvoření zakázky a neměnnost identity. **Běžné přímé UPDATE/DELETE zakázek ještě nemají plošnou licenční ochranu.** Aplikační kontrola před několika požadavky z těchto operací nedělá jednu transakci. Veřejné nabídky, všechny pracovní vstupy, další alternativní doménové zápisy a návazné operace ještě potřebují úplnou matici ochrany a testů. Existující DB INSERT ochrana zachytí i další vstup vytvoření u zapojené firmy, ale sama neprokazuje funkčnost celého veřejného či pracovního toku.

Pokladnové schopnosti POS, metered AI/OCR, kreditové rozpočty, retence historie, exportní intervaly a vypořádání dřívější události toto nové rozhraní nepokrývá. Čtení a export nelze nahradit kontrolou nové operace. Historické obrazovky se touto dávkou plošně nezamykají; retenční pravidla ještě nejsou dokončená.

Nevzniká globální platební zámek v proxy ani v základních identity guardech. Přihlášení, výběr firmy, nastavení předplatného, katalog, checkout a stav nákupu dál používají své autentizační a rolové kontroly bez požadavku na již zaplacený modul. Firma tak neztrácí cestu k nákupu nebo obnově.

Checkout zůstává výchozím stavem vypnutý, nabídky jsou prázdné a nepublikované. Celý tok skutečný Stripe sandbox → potvrzená platba → doménová operace není ověřený. Neproběhlo ostré účtování, zapojení firem, Git push, deploy ani úprava Hubu.

## Ověření tohoto checkpointu

| Kontrola | Potvrzený stav |
|---|---|
| Závěrečná aplikační sada | **664/664 PASS, 22 souborů, 9,98 s**. Řízené náhrady DB/Stripe nejsou skutečná platba. |
| Zakázkové akce a serverová stránka | **25/25 PASS**: zamítnutí před zápisem, pořadí rolové kontroly, rozdíl create/update a dostupná cesta k předplatnému. Panel testovaný serverovým renderem, nikoli přihlášeným proklikem. |
| Nová faktura – licenční vstup a panel | `invoice-new-module-access.test.ts`: **6/6 PASS**, cílený ESLint PASS a následný TypeScript znovu PASS. Jednotkové testy nenahrazují přihlášený Next.js průchod. |
| Nová SQL migrace a `supabase/tests/module-capability-authority.sql` | Migrace aplikovaná; **90/90 DB asercí + 6 kontrol úklidu PASS**, syntetické fixtures vrácené rollbackem. |
| Předchozí hlavní DB sady | Opakovaně **31 + 59 + 73 + 45 + 63 = 271 asercí + 17 kontrol úklidu PASS**. S novou sadou celkem **361 asercí + 23 kontrol úklidu**. |
| Metadata a oprávnění | **12 kontrolovaných tabulek prázdných**, včetně rolloutů a nabídek. RLS aktivní, klienti/service nemohou měnit rollout ani volat interní časový evaluator. Veřejné RPC je invoker, EXECUTE má z běžných aplikačních rolí pouze authenticated. |
| TypeScript, cílený ESLint a build | **PASS**. Build: kompilace **8,9 s**, TypeScript **24,0 s**, **83/83 stránek za 747 ms**. |
| Přihlášené UI / skutečný Stripe E2E / souběh | Touto dávkou neprokázáno. |

Výsledky SQL sad, metadata, lokální kontroly a přesná omezení jsou uložené v [module-operation-20261010.json](evidence/module-operation-20261010.json).

Porovnání Supabase Advisor před/po přidalo pouze jeden INFO nález: soukromý `company_module_rollouts` má RLS bez politik. Jde o očekávané uzavření klientského přístupu k tabulce řízené vlastníkem, nikoli pokyn přidat veřejnou politiku. [Popis a doporučení Advisoru](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Dosavadní varování se nezměnila.

Další práce: přednostně dokončit licenční pokrytí všech vstupů core a doplňků, lifecycle/expiraci, historii a settlement; následně atomické změny konceptu/snapshotu. Před prodejem je nutný skutečný platební průchod a hotové prodávané funkce. Akceptační manifest se touto dávkou nemění.
