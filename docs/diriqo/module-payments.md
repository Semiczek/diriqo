# Modulové platby a zakoupené schopnosti

Stav 10. 10. 2026: platební autorita i rezervace prvního nákupu jsou aplikované a ověřené v testovací databázi Diriqa. Webhook, validátor, loader, katalog, checkout a nákupní obrazovka jsou implementované lokálně. **První nákup je za výchozím vypnutým přepínačem, funguje pouze v testovacím režimu a celý průchod se skutečným Stripe dosud není ověřený.** Nový katalog DB je prázdný, žádné ceny nebyly zveřejněné ani vytvořené ve Stripe a neproběhla skutečná platba. Doménové moduly a vynucování jejich nároků nejsou touto dávkou dokončené.

Aktuální obchodní záměr je placené jádro a samostatně pořizované doplňky s automatickým zápisem nároku po potvrzené platbě. Záznam zakoupeného nároku sám nenahrazuje doménové oprávnění, použitelnou funkci ani kontrolu země, role, objektu a rozpočtu.

Nový checkpoint přidává společnou kontrolu 23 firemních operací, sedm akcí zakázek, jejich PATCH a serverové vstupy nové zakázky/faktury. Modulový přepínač ani viditelnost v menu nejsou licencí. Migrace `20261010193801_add_module_capability_authority` je aplikovaná v testovací DB: chrání přímý INSERT zakázky, neměnnost identity a explicitní zapojení firmy/produktu. Nových 90 DB asercí i opakování 271 předchozích prošlo. Stávající firmy se automaticky nepřevádějí a stránky předplatného i historie zůstávají dostupné podle dosavadních rolí. [Přesný rozsah a meze](module-operation-authority.md).

Navazující migrace `20261010190442_add_invoice_issue_authority` přidala první úzkou doménovou kontrolu: založení a první vystavení faktury v explicitním testovacím pilotu vyžaduje placenou fakturaci a jádro nebo POS. Atomické vystavení propojuje fakturu, číslo, zakázky a neměnný původ. Migrace `20261010191957_add_invoice_draft_transactions` následně doplnila atomickou tvorbu konceptu, potřebná pole a RLS položek/exportních vazeb. Soukromý rollout zůstává prázdný; platba sama stávající firmu do pilotu nepřevádí. Aktuální hranice: [invoice-draft-transactions.md](invoice-draft-transactions.md).

## Datový kontrakt

Migrace `20261010091159_add_paid_module_entitlement_authority` byla aplikovaná přes Supabase MCP v projektu `wfcpfraxiuhuglnuaxqj`. Do Hubu se nezapisovalo. Verze souboru odpovídá skutečné verzi poskytovatele.

Navazující migrace `20261010093313_add_module_checkout_sessions` byla aplikována stejnou cestou. Přidává rezervaci prvního nákupu; stávající EUR předplatná nepřevádí.

| Objekt | Účel a přístup |
|---|---|
| `public.module_offers` | Neměnný snímek produktu, Stripe ceny, měny, částky, režimu, schopností, policy verze a historie. Měnit lze pouze zveřejnění. Zpočátku prázdný; žádný DRAFT ceník se automaticky nepřevádí na prodejnou nabídku. |
| `public.module_purchase_orders` | Neměnná vazba firmy, nabídky, zákazníka Stripe a případné pokladny. Předplatné se připojí jednou při ověřené platbě. Založení objednávky vyžaduje publikovanou nabídku a rezervující RPC; service role nemá přímý INSERT. |
| `public.company_module_entitlements` | Přidávaná placená období s původem, schopnostmi a intervalem historie. Obnova vytváří další záznam; nepřepisuje staré období. Člen firmy má pouze SELECT podle aktuálního členství a RLS. |
| `private.module_payment_events` | Neměnná evidence identifikátoru události a režimu, hashe obsahu, objednávky a výsledného nároku. Není dostupná běžným klientům. |
| `public.module_billing_customers` | Neměnná vazba firmy a režimu na samostatného zákazníka modulových plateb ve Stripe. Přímý klientský přístup není povolený. |
| `public.module_checkout_sessions` | Rezervace firmy, produktu, nabídky, režimu a původního správce; jednou připojená relace Stripe, její URL a stav. Service-only RPC řídí přechody; místní čas sám nic neuvolňuje. |

Všech šest tabulek má RLS. Nabídky, objednávky a rezervace jsou dostupné pouze serverové service roli; klienti nemohou přímo vytvářet ani měnit nároky. RPC `public.apply_paid_module_invoice` a nová checkout RPC jsou spustitelná pouze vlastníkem a `service_role`. Nemění `company_subscriptions` ani staré `company_modules`.

Produktové kódy jsou `diriqo_core`, `inventory`, `invoicing`, `smart_quotes`, `fleet`, `ai_assistant`, `pos`. Schopnosti se ověřují proti přesné verzi registru `diriqo-capabilities-v0.1`. POS objednávka musí mít `register_id`; ostatní produkty jej nemají. Tato vazba ještě není úplnou správou pokladních zařízení.

## První nákup a návrat do aplikace

`DIRIQO_MODULE_CHECKOUT_ENABLED=true` zapne nový checkout pouze společně s `DIRIQO_MODULE_BILLING_MODE=test`. Chybějící přepínač, jiná hodnota nebo režim `live` nákup nepovolí. Výchozí katalog vrátí `enabled: false` a prázdný seznam bez volání Stripe. Tento přepínač nenahrazuje následnou obchodní akceptaci ani publikaci nabídek.

`GET /api/billing/modules/catalog` po čerstvém ověření identity a firemního správce načte pouze publikované testovací nabídky. Každou cenu porovná s kanonickým Stripe Price a produktem. V1 podporuje pevnou licencovanou měsíční/roční cenu v CZK/EUR, množství 1, bez trialu, slev a dodatečné daně. Checkout podporuje jádro, sklad, fakturaci, chytré nabídky a vozidla; AI/POS jsou zatím odmítnuté. Veřejná odpověď obsahuje `companyId`, `enabled` a nabídky `{id, product, offerKey, unitAmount, currency, billingInterval}`, nikoli interní finanční vazby nebo klientem ovládané schopnosti. Neshoda a neúplné načtení vracejí nedostupnost, nikoli odhadnutou cenu.

`POST /api/billing/modules/checkout` přijímá striktně `{offerId}`. Autentizovanou identitu a firmu získá server; klientské `X-Diriqo-Company` jen porovná s čerstvým firemním kontextem. Změna firmy vrací `409 company_changed`. Přesný Origin musí odpovídat důvěryhodnému `NEXT_PUBLIC_APP_URL`; návratové URL se neodvozují od hlavičky Host ani klientského vstupu. Další konflikty mají vlastní kódy a nejsou automaticky změnou firmy.

Service ověří nabídku, cenu a zákazníka Stripe. `reserve_module_checkout` znovu autorizuje současného správce a atomicky zajistí jednu rezervaci firmy/produktu/režimu. U doplňků vyžaduje odpovídající placené jádro; sklad a fakturace mohou vycházet i z POS. Stejná nabídka obnoví stejnou objednávku, jiná nabídka pro obsazený rozsah vyvolá konflikt. Jiný aktuálně oprávněný správce firmy může rezervaci obnovit; původní autor zůstává zachovaný.

Stripe customer a Checkout Session používají stabilní idempotency keys. Provider odpověď se kontroluje proti objednávce, zákazníkovi, ceně, částkám, režimu a expiraci; následně se relace jednou připojí přes `record_module_checkout_session`. `close_module_checkout_session` přijme pouze kanonicky načtený stav complete/expired. Neznámý výsledek poskytovatele ani místní timeout rezervaci neuvolňují. Dokončená rezervace zůstává uzavřená pro další první nákup; řízené opětovné předplatné a širší lifecycle jsou navazující práce.

`/billing/modules` zobrazuje základ a šest samostatných doplňků. U nepublikovaných oblastí uvádí „Připravujeme“, při vypnutém přepínači „Nákup modulů zatím není spuštěný“. Ceny zobrazuje pouze z ověřeného katalogu. Návraty `?checkout=returned` a `?checkout=cancelled` jsou neutrální; nárok vznikne až ověřenou platbou. Stav lze ručně obnovit. Chyba 503 není prázdný nákupní seznam, změna firmy blokuje nákup, souběžný klik je blokován a nejasná odpověď vyžaduje obnovení stavu. Čtení má 30sekundový a příprava platby 60sekundový klientský timeout; timeout není důkazem zrušeného nákupu.

## Průchod potvrzené platby

1. `app/api/stripe/webhook/route.ts` ověří podpis původního webhooku a před starší logikou EUR tarifů zavolá `lib/platform/module-payment-handler.ts`.
2. Handler rozpozná modulový tok podle uložených vazeb a značek `billing_flow=diriqo_modules_v1` a `module_order_id`. Pro fakturační událost načte kanonickou fakturu, položky a předplatné od Stripe. Neúplný seznam položek nepovažuje za běžné staré předplatné.
3. `module-payment-validation.ts` porovná potvrzenou událost `invoice.payment_succeeded` s neměnnou nabídkou a objednávkou. Čekající, neúspěšné nebo pouze dokončené checkout oznámení samo neudělí placený nárok.
4. Service-only RPC znovu ověří identitu zákazníka, cenu, měnu, režim, předplatné, peněžní hodnoty a období. Schopnosti převezme pouze z uložené nabídky. Událost a nárok zapíše atomicky.
5. Stejná událost nebo jiný identifikátor události pro totožný obsah stejné faktury/položky vrátí původní nárok. Změněný obsah vyvolá konflikt. Opožděná obnova přidá své období a nezkrátí novější grant.

V první verzi je povolena jedna fakturační položka v množství 1: `unit_amount = line_amount = amount_due > 0`, `amount_paid >= amount_due`. Částky jsou v nejmenších měnových jednotkách. Slevy, promo akce, dodatečné daně, poměrné přepočty a více položek tento tok nepodporuje. Existující objednávka může přijmout platbu/obnovu i po stažení nabídky z nového prodeje.

Modulové události se nepředávají staré synchronizaci jako náhrada chybějícího modulu. Starší EUR větev přijímá jen přesně rozpoznanou cenu; neznámá cena se nepřevádí na Starter. Neúspěšná faktura nepřepisuje staré předplatné pouze podle ID zákazníka. Stripe SDK zůstává na 22.1.1 a API verze na `2026-04-22.dahlia`; žádný upgrade ani zápis do Stripe účtu neproběhl.

## Čtení zakoupených nároků

`lib/platform/module-billing-mode.ts` čte výhradně serverové `DIRIQO_MODULE_BILLING_MODE=test|live`. Chybějící nebo jiná hodnota neposkytne výchozí režim: stav nároků je nedostupný. Režim nesmí určovat tělo požadavku, query parametr ani veřejná klientská proměnná.

`lib/platform/paid-entitlement-loader.ts` používá autentizovaného DAL klienta. Znovu ověří Auth, profil a aktivní členství, poté čte jen příslušnou firmu a režim pod RLS. Kontroluje přesnou strukturu uložených grantů. Stránkuje po stabilním ID, ověřuje přesný počet, duplicity a změny počtu mezi stránkami; nad 10 000 záznamů nebo při nekonzistenci vrátí `unavailable`. Jde o zjišťování neúplného načtení, nikoli transakční zámek všech navazujících operací.

`GET /api/billing/modules` vrací `companyId`, produkt, případnou pokladnu, `purchasedCapabilities`, `isPaidActive` a `paidUntil`; nevydává finanční reference. Zakoupené schopnosti mohou zahrnovat historické čtení po expiraci, proto UI označí aktivní licenci pouze podle `isPaidActive`. Odpověď má `Cache-Control: private, no-store`. Nedostupný snapshot vrátí HTTP 503. Výsledek popisuje nákupní stav, nikoliv obecné povolení provést doménovou operaci. Neprovádí automatický převod starých EUR licencí.

## Ověření a jeho meze

| Ověření | Výsledek |
|---|---|
| `supabase/tests/module-payment-authority.sql` | **59/59 PASS**, skutečné role `authenticated`, `anon`, `service_role`, všechny syntetické fixtures vrácené rollbackem. |
| `supabase/tests/module-checkout-sessions.sql` | **73/73 PASS** a 5 kontrol úklidu; syntetické fixtures vrácené rollbackem. Následné opakování platebních 59 asercí také PASS. |
| Platební validátor | **107 testů PASS**. |
| Handler a webhook | **57 testů PASS**, řízené odpovědi poskytovatele. |
| Placený loader a stavový endpoint | **24 + 8 testů PASS**. Připomínky review k oddělení režimu a stránkování byly opravené; aktivní období je explicitní. |
| Checkout service a commerce routes | **141 + 31 testů PASS**, řízená rozhraní Stripe/DB. Cílený společný běh commerce/status routes má 39/39 PASS. |
| Katalog nabídek | **17 testů PASS**. |
| Fakturační pilot | **45/45 SQL asercí + 6 kontrol úklidu PASS** a **44 aplikačních testů PASS**. Vystavení i mazání konceptu používají atomickou RPC; nejde o celé UI vytvoření/export. |
| Atomická tvorba konceptu | **63/63 DB asercí + 6 kontrol úklidu PASS**. Celý přihlášený tok včetně dalších úprav a exportu tím není prokázaný. |
| Závěrečná lokální sada | **664/664 PASS v 22 souborech za 9,98 s**. Zahrnuje 25 testů zakázkových vstupů a 6 testů licenčního vstupu/panelu nové faktury. |
| Nová autorita firemních operací | Migrace aplikovaná, **90/90 DB asercí + 6 kontrol úklidu PASS**. |
| TypeScript, lint a build | Plný TypeScript a cílený ESLint **PASS**, build po nové licenční dávce **PASS**: kompilace **8,9 s**, TypeScript **24,0 s**, **83/83 stránek za 747 ms**. |

Závěrečná kontrola potvrdila nulu ve všech **12 kontrolovaných tabulkách**, včetně nového rollout registru, požadavků, pilotu a obchodních tabulek. RLS a ACL byly ověřeny; firma nebyla zapojená ani zákaznicky placeně aktivovaná. Pět předchozích SQL sad znovu prošlo: **31 + 59 + 73 + 45 + 63 = 271 asercí a 17 kontrol úklidu**. S novou autoritou je souhrn **361 DB asercí + 23 kontrol úklidu PASS**. Jediný nový nález Advisoru je očekávané INFO k soukromému rollout registru bez klientských politik; ostatní varování se nezměnila, podrobnosti jsou v [kontraktu autority](module-operation-authority.md).

Společná evidence aktuální dávky: [module-operation-20261010.json](evidence/module-operation-20261010.json).

Skutečný Stripe sandbox průchod, přihlášený proklik a současný běh dvou transakcí nebyly ověřené. Skutečná UI komponenta se syntetickými odpověďmi prošla kontrolou vypnutého nákupu, aktivní licence, tlačítka nákupu, neutrálního návratu, konfliktu 409, neznámého stavu 503 a změny firmy. Desktop 1265 × 712 px a mobil 390 × 844 px zobrazily sedm karet; mobil neměl vodorovné přetékání. Závěrečný opakovaný proklik potvrdil neznámý stav při chybě katalogu nebo změně firmy, bez tlačítka nákupu a bez chyb či varování prohlížeče. Nejde o autentizovaný produkční ani Stripe E2E průchod. Hlavní SQL sady běží v jedné relaci. Samostatný fakturační pokus použil dvě backend relace, jejich časy se však nepřekrývaly: dokládá pouze opakování. Jeho dočasná commitnutá nepilotní fixture byla uklizena a odstranění šesti druhů záznamů ověřeno; [uložená evidence](evidence/invoice-issue-20261010.json) tento rozdíl zachovává.

## Navazující práce

- Ověřit implementovaný první nákup, opakování po ztrátě odpovědi a navazující aktivaci ve skutečném Stripe sandboxu. Nabídky zveřejnit až s dokončenými doménovými funkcemi a ověřeným obchodním tokem.
- Rozšířit ověřené úzké zakázkové/fakturační zapojení na ostatní přímé zápisy, veřejné nabídky a pracovní cesty. Současná ochrana nových operací není plnou licenční ochranou produktu; pokladnový POS, rozpočty a retenční/settlement pravidla potřebují vlastní kontext.
- Atomická tvorba konceptu a potřebné tenantové RLS jsou dokončeným základem. Navázat atomickou editací a obnovením dodavatelského snapshotu, ověřit celý přihlášený tok a export. Poté rozšířit pokrytí základních/doménových operací, lifecycle/expirace, retence historie a settlement s doloženým původem. Celé produktové moduly tato dávka nedokončuje.
- Doložit a doplnit historické EUR granty. Nově uložená historie se týká pouze nových placených modulových období.
- Doplnit refundace, odvolání nároku, širší lifecycle, grace a kreditové rozpočty jako samostatně testované operace. Současné neměnné granty se kvůli tomu ručně nepřepisují.
- Ověřit skutečný Stripe sandbox tok, souběžné opakování a obnovu po přerušení; teprve potom hodnotit celou P10 akceptaci. P10 nyní má pouze dílčí důkaz a neprokazuje kreditový ledger.

Změny nejsou commitnuté, pushnuté ani nasazené. Žádná nová placená funkce nebyla zákazníkovi zapnutá a žádný `.env` nebyl kopírován.
