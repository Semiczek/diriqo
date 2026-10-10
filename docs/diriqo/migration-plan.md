# Plán schématu a kompatibility Diriqa

Stav 10. 10. 2026. Výchozí cílová revize `208c9ead6dface1b0a25bfedd71ff398eb9dd480`. Aplikační změny jsou lokální v izolované pracovní kopii, původní checkouty se neupravovaly. Čtyři migrace platformní/platební autority a rezervace checkoutu jsou aplikované v testovacím Diriqu; import dat neproběhl. Fáze 1 zůstává částečně dokončená.

## Prostředí a zachování obsahu

Uživatel označil celé Diriqo za testovací prostředí. Před DB změnou vždy znovu ověřit projekt `wfcpfraxiuhuglnuaxqj`, současné schéma a zálohovací bod. Hub `yrxfozthravgbbcqklzy` není testovací cíl této implementace. Syntetické firmy A/B musí být rozpoznatelné podle vlastní testovací identity, nesmějí se párovat s existující firmou podle jména nebo e-mailu.

Převzetí kódu nenese skutečné zákazníky, pracovníky, přílohy, logy, tokeny ani zálohy Hubu. Zachovat původní data cíle a původ historických EUR nároků. Aktuální lokální baseline byl přenesen z Git stromu bez `.env.local`, závislostí, buildů a necommitnutých souborů. Závislosti byly následně samostatně nainstalovány offline podle stejného lockfile a vznikl lokální build; žádné prostředí ani tajné klíče se nekopírovaly. Historie Git zůstala na původním commitu.

## Provedené migrace

V projektu `wfcpfraxiuhuglnuaxqj` byla přes Supabase MCP úspěšně aplikována migrace `20261010084407_separate_platform_authority_from_tenant_membership`. Stejná verze je potvrzená seznamem migrací poskytovatele a uložená v odpovídajícím souboru `supabase/migrations/`. Číslo nevzniklo odhadem ani ručním tvrzením o účinnosti historického patche.

Následná migrace `20261010085039_preserve_onboarding_country_and_module_defaults` byla rovněž aplikována přes poskytovatele. Reaguje na nezávisle zjištěný rozdíl proti kanonickému onboardingu: zachovává pravidla země, výchozí hodnoty a všech 17 modulových přepínačů. Rozšířené SQL ověření zahrnuje tuto kompatibilitu a skutečné odmítnutí čtení připraveného platformního auditního záznamu.

Platformní grant je soukromý a navázaný na `auth.users.id`, odděleně od firemní role. Žádný operátor nebyl automaticky založen. Existující členství a obchodní záznamy zůstaly zachované. Do Hubu nebylo zapisováno a historický bootstrap nebyl přehrán. Aplikační změny guardu/proxy dosud nebyly nasazené, proto je nutné odlišovat aktuální stav DB od místní verze aplikace.

Reprodukovatelný test `supabase/tests/platform-authority.sql` prošel 31 asercemi ve skutečné databázi pod rolemi `authenticated` a `anon`. Ověřil hranici platformní autority i zachování obou onboarding RPC a přípravy pracovníka. Syntetické identity, firmy, granty a související testovací záznamy byly vráceny rollbackem. Nejde o plnou akceptaci všech firemních objektů, souběhu posledního správce ani přihlášeného prokliku.

Migrace `20261010091159_add_paid_module_entitlement_authority` přidala prázdné tabulky `module_offers`, `module_purchase_orders`, `company_module_entitlements` a soukromý `module_payment_events`. Všechny mají RLS; platební RPC má EXECUTE pouze pro `postgres` a `service_role`. Uložené granty a události jsou neměnné, nové období se přidává samostatně. Existující EUR předplatná ani modulové přepínače se nepřepisují.

Test `supabase/tests/module-payment-authority.sql` prošel **59/59 asercemi** pod skutečnými rolemi `authenticated`, `anon` a `service_role`. Ověřuje potvrzenou platbu, samostatné produkty, vazbu objednávky, duplicity/konflikty, opožděná období, oprávnění a zachování starých záznamů. Test je v jedné relaci a neprokazuje skutečný souběh. Všechny fixtures se vrátily rollbackem; následná kontrola zjistila nulu ve všech čtyřech nových tabulkách i platformních grantech/událostech. Proběhlo obnovení PostgREST schema cache přes `pg_notify`.

Migrace `20261010093313_add_module_checkout_sessions` přidala service-only tabulky `module_billing_customers` a `module_checkout_sessions` s RLS. Přímý INSERT objednávek byl service roli odebrán; objednávka vzniká přes `reserve_module_checkout` spolu s rezervací rozsahu. RPC ověřuje současné členství správce, firmu, nabídku, režim, závislosti a existující placené období. Stejná firma/produkt/režim má jednu neukončenou rezervaci; tentýž nákup lze obnovit. Vazby zákazníka, objednávky a relace jsou neměnné. Pouhé uplynutí místního času rezervaci neuvolní: expiraci musí potvrdit kanonický stav Stripe.

`supabase/tests/module-checkout-sessions.sql` prošel **73/73 asercemi** a 5 následnými kontrolami úklidu. Platební test byl po přizpůsobení fixtures nové cestě tvorby objednávek znovu spuštěn: **59/59 PASS**. Syntetické záznamy byly vráceny rollbackem; tyto testy v jedné relaci nedokládají simultánní požadavky. Verze checkout migrace pochází ze skutečného úspěšného výsledku poskytovatele, nikoliv z ručně odhadnutého čísla.

## Pořadí

1. Zmapovat všechny aktuální definice, indexy, FK, RLS, grants, RPC, views a Storage; porovnat migrace s bootstrapem a `patch-*.sql`. Dřívější prázdný živý seznam migrací není důkazem prázdné DB ani souhlasem přehrát bootstrap.
2. Dokončit provozní předání oddělené platformní administrace. DB hranice a základní pozitivní/negativní SQL průchody jsou ověřené; zbývá legitimní explicitní operátor, přihlášená aplikace a souběžné scénáře. Nepřidávat e-mailovou výjimku ani automaticky povyšovat všechny staré `super_admin` memberships.
3. Ověřit celý lokálně implementovaný první nákup: autorizovanou rezervaci, idempotentní checkout, neutrální návrat, potvrzenou platbu a placený stav. Katalog DB zatím zůstává prázdný a DRAFT ceny nezveřejněné. Checkout vyžaduje explicitní `DIRIQO_MODULE_CHECKOUT_ENABLED=true` a současně testovací režim; ostrý režim jej nezapne. Plný průchod ověřit ve Stripe sandboxu před skutečným prodejem.
4. Uložit doložené historické EUR granty a vyřešit neúplné zdrojové záznamy; současný EUR adaptér zůstává pouze diagnostický. Sjednotit serverové vstupy a přímé DB/RPC cesty vybrané schopnosti a teprve po úplné matici přepnout její enforcement. Placený stav ani UI filtr nejsou úplnou doménovou autorizací. Ponechat správu účtu a obnovení služby vlastníkovi.
5. Dokončit C01–C10 bez doplňků. Archivace identit, časové sazby/snapshoty, jedinečný finanční původ, revize, souběhy a idempotence před přenosem dalších domén.
6. Přenášet samostatně sklad, fakturaci, pokladnu, fleet a AI. Sdílené katalogové a rodičovské záznamy před položkami; skladové pohyby append-only. Každý celek má vlastní testy a kompatibilní hranici.

## DB ověření

Před aplikací připravit konkrétní SQL diff a závislosti, rollback nebo opravnou dopřednou migraci, syntetické fixtures a očekávané výsledky. V testu spouštět skutečné role `anon`/`authenticated` s kontrolovanou identitou; běh jako service role neprokazuje RLS. Podle rozsahu ověřit chybu po COMMIT, ztrátu odpovědi, dvě paralelní operace a odebrání oprávnění během práce. Produkční jména, klíče nebo skutečné osobní údaje do důkazů nepatří.

Lokální Supabase CLI, Docker ani PostgreSQL nebyly nalezeny v PATH ani při omezené kontrole běžných instalačních míst. Skutečné SQL ověření proto proběhlo přes Supabase MCP v testovacím Diriqu. Přímá remote DDL operace se eviduje přes migrační nástroj poskytovatele, nikdy jako nezdokumentovaný patch. Není-li dostupné CLI, převzít skutečnou vrácenou verzi ze zdařilého `apply_migration` a ověřit ji přes `list_migrations`; nevymýšlet účinnost podle posledního názvu souboru.

Dosavadních **163 SQL asercí PASS** (31 platformních + 59 platebních + 73 checkout) a 5 samostatných kontrol úklidu doplňuje celá lokální sada **459/459 PASS v 17 souborech**. Po testech zůstalo všech šest nových platebních/checkout tabulek prázdných. Plný TypeScript, cílený lint i závěrečný build **83/83 stránek PASS**, exit 0, prošly. Mockované aplikační testy ani proklik skutečné komponenty se syntetickým API nenahrazují skutečný Stripe a přihlášený aplikační průchod. Úplná matice tenantů, souběhy a všechny licenční cesty se doplní před přepnutím nové placené schopnosti.

Placený loader používá serverové `DIRIQO_MODULE_BILLING_MODE=test|live`, RLS, čerstvou identitu/členství a stránkování podle stabilního ID s přesným počtem. Nad 10 000 řádků nebo při nekonzistenci vrací nedostupný stav místo neúplného seznamu. Tento limit je explicitní provozní hranice, ne splnění scénáře 20 000 položek.

## Kontroly a návrat

Porovnat počty, cizofiremní a osiřelé vazby, stavové přechody, peněžní částky po měně, kapacity a historický přístup. Při návratu aplikace nesmazat přidaná data či nové nároky. Nejdříve zastavit dotčené nové zápisy, zachovat jejich deník, promítnout kompatibilní deltu, ověřit součty a teprve obnovit staršího zapisujícího klienta. Návrat pouze předchozí zálohy není bezztrátový rollback.

Aktuální platební verze přijímá jednu položku v množství 1, kde cena nabídky = částka řádku = dlužná částka a uhrazená částka ji pokrývá. První checkout nabízí pouze pevnou měsíční/roční cenu v CZK/EUR pro jádro, sklad, fakturaci, chytré nabídky a vozidla; POS a AI nejsou v tomto nákupním toku podporované. Slevy, dodatečné daně a poměrné přepočty nejsou podporované. Refundace, odvolání grantu, grace, opětovný nákup po dokončené rezervaci, další lifecycle a kreditové rozpočty vyžadují samostatný doložený návrh a testy; současné neměnné granty se kvůli nim ručně nepřepisují. Žádný Stripe účet, ostrá platba ani SDK/API verze nebyly touto dávkou změněné.

Budoucí import zákaznických dat má tenant, verzi formátu, hash vstupu, mapu identit, společně potvrzovanou dávku a checkpoint. Reconcile a opakované spuštění se ověřují před ostrým importem. Ani testovací klasifikace Diriqa není povolením importovat skutečná data Hubu.
