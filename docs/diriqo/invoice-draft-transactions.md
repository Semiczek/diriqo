# Atomické vytvoření konceptu faktury

Checkpoint 10. 10. 2026. Migrace `20261010191957_add_invoice_draft_transactions` je aplikovaná v testovacím Diriqu `wfcpfraxiuhuglnuaxqj`; číslo odpovídá výsledku poskytovatele. **Vytvoření konceptu z dokončených zakázek je atomické a ověřené v DB. Celá Fakturace ani obchodní připravenost tím nejsou dokončené. Žádná firma nebyla zapojena do licenčního pilotu.**

## Serverový a databázový kontrakt

`app/invoices/actions.ts` používá `createInvoiceFromJobsAtomic` z `lib/dal/invoice-drafts.ts`. Firma pochází z čerstvého serverového kontextu; hidden `companyId` pouze odhalí formulář ponechaný otevřený před změnou firmy. Auth se ověřuje znovu. Klient nepředává ceny, součty, plátcovství, snapshoty ani ID výsledné faktury.

RPC `create_invoice_from_jobs_atomic` má devět argumentů: `target_company_id`, `target_customer_id`, `target_job_ids`, `target_issue_date`, `target_taxable_supply_date`, `target_due_date`, `target_vat_rate`, `target_note`, `target_request_id`. Jako `SECURITY INVOKER` zachovává tenantové RLS a znovu ověří aktuální oprávnění. Přijme 1–200 různých zakázek téže firmy a zákazníka, platná data v letech 1900–9999, splatnost nejdříve v den vystavení, sazbu 0–100 % s nejvýše dvěma desetinnými místy a poznámku nejvýše 10 000 znaků.

Zakázky zamkne v deterministickém pořadí a ověří dokončení, kladnou konečnou cenu, měnu CZK a nepřítomnost aktivní fakturační vazby. Snapshot dodavatele, zákazníka a zdrojové zakázky vytváří z DB se zachovanými camelCase klíči. Pro každou zakázku vzniká řádek s množstvím 1; cena a DPH se zaokrouhlí po řádcích a potom se sečtou. Neplátce má vždy nulovou DPH. Koncept má `currency='CZK'`, `payment_method='bank_transfer'`, rok z data vystavení a zatím nemá vydané číslo ani `issued_at`.

Hlavička, položky, vazby a `private.invoice_draft_requests` vzniknou v jedné transakci. Chyba včetně numerického přetečení nezanechá částečný koncept ani spotřebovaný požadavek. Soukromý helper má vlastní kontrolu Auth/členství a licence, prázdný `search_path` a pouze sám generuje náhodné ID faktury. Nepřijímá klientem zvolený existující doklad.

Idempotence se váže na firmu, request UUID a SHA-256 normalizovaných vstupů včetně seřazených zakázek. Shodné opakování vrátí původní doklad i po jeho pozdějším vystavení; změněný obsah se stejným klíčem vyvolá konflikt. Smazání konceptu ponechá neměnný záznam požadavku bez FK na fakturu: retry hlásí smazaný koncept a nevytvoří náhradu. Návratová data jsou `{invoice_id,status,created}`; DAL odmítá neplatnou strukturu a neočekávané stavy.

## RLS, schéma a historie

- Položky lze číst jen při aktuálním členství a čitelném rodiči ze stejné firmy. Zápisy vyžadují firemního správce; restriktivní policies omezují i případné starší permissive policies. `company_id` položky odpovídá faktuře a při INSERT se může odvodit z rodiče.
- Trigger zamyká autorizovanou rodičovskou fakturu. Finanční položky vystaveného dokladu jsou neměnné. Odpojení smazané zdrojové zakázky smí pouze nastavit `source_job_id=null`; částky i snapshot zůstanou stejné, také po expiraci pilotní licence. Smazání konceptu zůstává možné po expiraci.
- Exportní vazba vyžaduje správce a stejnou firmu faktury i exportu; rodiče nelze přepsat. Doplněny jsou `payment_method`, `is_vat_payer`, `vat_note`, `pohoda_external_id`, `pohoda_last_export_id` a exportní `error_message`.
- Historické plátcovství a daňové údaje se nedoplňují odhadem. Neznámé `is_vat_payer` detail označí „Neuvedeno“. Případná chybějící firemní vazba položky se odvozuje pouze z jejího rodiče. Před migrací byly faktury, položky, vazby a exporty prázdné; žádný historický finanční obsah se nepřepisoval.
- Stávající explicitní testovací rollout a závislost Fakturace na placeném jádru nebo POS zůstávají zachované; žádné plošné zapojení starších EUR firem.

## Formulář

`app/invoices/new/page.tsx` zůstává serverová stránka. Nový `InvoiceCreateForm.tsx` používá `useActionState` s explicitním odesláním `FormData` v transition: ukáže chybu přes `role=alert`, stav ukládání přes `role=status`, zamkne fieldset při odesílání a zachová zadání i request UUID po chybě. Nepoužívá automatický reset formuláře po vrácení akce. UUID vzniká na serveru přes `node:crypto`; v nové firmě/zákazníkovi/měsíci se vytvoří nový kontext formuláře.

Součet zahrnuje skutečně zaškrtnuté zakázky, reaguje na sazbu DPH a aktualizuje také řádkové částky. Jde o náhled; rozhodné ceny načítá DB. UI výslovně nabízí pouze CZK zakázky. Datum je povinné s rozsahem 1900–9999, poznámka má limit 10 000 znaků. Chyba načtení firmy nebo jejího plátcovství tvorbu zablokuje; není vyhodnocena jako neplátce. Chybové zprávy dotazů nezveřejňují interní detaily.

Syntetický browser harness skutečné komponenty ověřil zachování data 31. 10., DPH 12 %, poznámky, jedné vybrané zakázky a náhledu 11,26 Kč po chybě. Simulovaný serverový rerender výměnou request ID propu ve stejně klíčované komponentě zachoval původní UUID i údaje opakování. StrictMode: dva pokusy, dvě přijetí akce; nejde o důkaz dvou DB faktur. V pending stavu jsou vstupy zamčené, při nulovém výběru je odeslání zakázané. Mobil 390 × 844 px neměl vodorovné přetečení dokumentu (375 px) ani formuláře (343 px); 760px tabulka posouvá pouze vlastní kontejner. **Jde o UI se syntetickým serverem, nikoli o přihlášený Next.js nebo skutečný Stripe tok.**

## Ověření a zbývající rozsah

Evidence nové dávky: [invoice-draft-20261010.json](evidence/invoice-draft-20261010.json). Reprodukovatelná DB sada: `supabase/tests/invoice-draft-transactions.sql`.

| Kontrola | Výsledek a hranice |
|---|---|
| Nová DB sada | **63/63 asercí + 6 kontrol úklidu PASS**; syntetické fixtures vráceny rollbackem. Autorizace, scope, vstupy, výpočty/snapshoty, licence, idempotence/tombstone, položky/exportní vazby a absence částečného zápisu. |
| Předchozí DB sady po migraci | Znovu **31 + 59 + 73 + 45 PASS**; součet všech hlavních sad **271 asercí + 17 kontrol úklidu**. |
| Celá aplikační sada | **579/579 PASS v 19 souborech**. |
| TypeScript a cílený ESLint | **PASS**. |
| Build | Závěrečný build po opravě formuláře **PASS**, exit 0, kompilace **10,5 s**, TypeScript **30,4 s**, **83/83 stránek za 1 399 ms**. |
| Interaktivní UI | Syntetický harness **13/13 kontrol PASS** (11 browser kontrol + TypeScript a ESLint) v uvedeném rozsahu; neprokazuje přihlášený aplikační tok. Výsledky jsou součástí společné evidence uvedené výše. |
| Závěrečná DB metadata | Všech **11 kontrolovaných tabulek má 0 řádků**, včetně deníku požadavků, pilotu a obchodních tabulek. RLS všech tří dotčených tabulek zapnuté. Public RPC je invoker a authenticated-only; anon/service role jej nespustí. Klient nemá přístup k soukromé tabulce, service role nemá INSERT; authenticated smí spustit jen příslušný rezervační helper. Legacy profilů s pouze `user_id` a bez `auth_user_id` je 0. |

SQL sada proběhla v jedné relaci; skutečný překryv transakcí tím není prokázaný. Dřívější dvourelační pokus vystavení rovněž doložil jen opakování, protože se časy nepřekrývaly. Jeho oddělená commitnutá fixture i úklid jsou popsány v [předchozí evidenci](invoice-issue-authority.md).

Další práce: atomická editace konceptu a obnovení dodavatelského snapshotu; celý přihlášený průchod a export; lifecycle a expirace oprávnění, historie a vypořádání s doloženým původem; základní doménové operace a celý Stripe sandbox tok. Storno a úhrada nadále nejsou jednou společnou transakcí. Doplněné exportní sloupce/RLS samy nedokládají import do Pohody.

Všech 73 akceptací si zachovává stav: **4 dílčí důkazy, 69 neprovedeno, 0 plných akceptací**. Neproběhla skutečná platba, zápis do Stripe účtu, zapojení firmy, Git push, deploy ani zápis této implementace do Hubu.
