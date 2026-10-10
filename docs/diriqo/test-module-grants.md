# Testovací licence bez platby

Stav 10. 10. 2026: migrace `20261010202807_add_nonfinancial_test_module_grants` je aplikovaná v testovacím Diriqu (`wfcpfraxiuhuglnuaxqj`). Nová SQL sada `supabase/tests/module-test-grants.sql` má **102 asercí + 7 kontrol úklidu PASS**; syntetické záznamy byly vráceny rollbackem. Cílené jednotkové kontroly loaderu a operačního kontraktu mají **117/117 PASS**. Dvě informační hlášky advisoru o nových soukromých tabulkách bez klientských RLS politik odpovídají záměrnému owner-only přístupu. Toto samo nepotvrzuje demo aktivaci ani nasazení aplikace; jejich provedení se dokládá samostatně.

Tato vrstva ukládá skutečné nefinanční licence s původem `manual_grant`. Nevytváří Stripe zákazníka, objednávku, fakturu, placené období ani kredit pro AI/OCR. Aplikace je používá pouze při serverovém `DIRIQO_MODULE_BILLING_MODE=test`; v režimu `live` je loader vůbec nenačte a vrátí prázdný testovací snapshot. Chybějící nebo neznámý režim vrací nedostupný stav. Checkout zůstává samostatně vypnutý.

## Autorita a rozsah

`private.company_test_module_grants` je soukromý registr s RLS a bez přímých oprávnění pro `anon`, `authenticated` i `service_role`. Zápis provádí pouze vlastník databáze. Každá licence má firmu, produkt, přesný seznam schopností a verzi politiky, odkaz na schválení, důvod, čas a databázovou roli zápisu. Platnost je nejvýše 720 hodin; historie má stejnou hranici. POS vyžaduje vlastní `register_id`, ostatní produkty jej mít nesmějí.

Zapsanou licenci nelze prodloužit, přepsat ani smazat. Vlastník ji smí pouze jednou odvolat změnou `revoked_at` spolu s neprázdným `revocation_reason`; čas odvolání určí databáze. Nové období vyžaduje nový samostatný záznam. Změna původního důvodu, rozsahu, schopností či firmy selže.

`public.get_company_test_module_entitlements(target_company_id)` vrací JSON snapshot pouze po kontrole skutečného `auth.uid()`, shodného aktivního profilu a členství firmy. Soukromý read helper je jedinou výjimkou s `SECURITY DEFINER` a má prázdný search path. API neposkytuje žádnou operaci pro přidání licence. Serverový loader navíc ověřuje konkrétní profil žádosti a validuje celý snapshot; neúplná nebo chybná data nepřemění na dostupný modul.

Společná operační autorita nadále podporuje jen 23 firemních operací bez samostatného rozpočtu. Používá čas databáze a soukromý testovací rollout po firmě/produktu. Bez rollout záznamu zůstává výslovná dosavadní větev `legacy`; samotné vložení licence ji nenahrazuje. Placená licence s placenou závislostí má přednost a zachovává původní chování. Testovací doplněk může použít platné testovací nebo placené jádro; sklad a fakturace alternativně odpovídající POS licenci. Placený doplněk bez svého placeného základu se kvůli testovacímu jádru nepřeznačí za platně zaplacený.

Veřejný `get_company_capability_access` stále vrací šest polí; přibývá jen důvod `test`. Interní ID testovacího grantu není veřejným autorizačním tokenem. Role, konkrétní objekt, firemní nastavení a další doménové podmínky se nadále ověřují samostatně. Registrační POS operace, historické operace, settlement a AI/OCR operace s rozpočtem tímto obecným API nejsou nově povolené.

## Faktury a odvolání

Vystavení na testovací licenci zaznamená samostatný neměnný důkaz v `private.invoice_test_issue_authorizations`, včetně vazby na správnou firmu a testovací grant. Placený důkaz v `private.invoice_issue_authorizations` nadále odkazuje výhradně na placený ledger. Faktura, číslo, projekce zakázky a odpovídající důkaz se zapisují v jedné transakci. Selhání důkazu vrátí celý zápis.

Testovací vyhodnocení drží sdílené řádkové zámky nad granty cílové firmy ve stabilním pořadí ID. Tím se revokace grantu nebo jeho testovací závislosti nesmí vložit mezi ověření a navazující transakční zápis. Jednotlivé kontroly se sdíleným zámkem navzájem neblokují. Administrativní hromadná revokace má zamykat ve stejném pořadí; opačné pořadí může skončit databázovým deadlockem a rollbackem vybrané transakce. Toto je návrh a statické posouzení zámků, nikoli důkaz souběhu ve dvou relacích.

## Schválená demo aktivace

Oddělený owner-only skript `supabase/operations/activate-demo-test-modules.sql` smí změnit pouze potvrzenou firmu Diriqo Demo s.r.o. (`10000000-0000-4000-8000-000000000001`). Kontroluje ID i název, odmítne konflikt s ostrým placeným nárokem, uloží sedm grantů s 51 registrovanými schopnostmi na 30 dní a zapojí pět podporovaných produktů do testovací autority. Opakování stejného `source_ref` původní období neprodlužuje. Odpovídající `supabase/tests/demo-test-module-activation-rollback.sql` provede tentýž postup a vždy jej vrátí rollbackem.

POS UUID `d3110000-0000-4000-8000-000000000001` je výhradně testovací licenční rozsah. Není založená ani spárovaná pokladna. Samotné granty nedodávají chybějící aplikace: aktuálně jsou použitelné Core a část fakturace; základní ruční nabídky patří do Core. Sklad, pokročilé chytré nabídky, fleet, AI asistent a POS mají produktový kontrakt, ale jejich kompletní doménové aplikace nejsou touto změnou implementované. AI/OCR licence nepřidává rozpočet a nespouští placené volání.

Migrační soubor sám neaktivuje žádnou firmu. Skutečné aplikování migrace, výsledky rollback testů, jednorázová aktivace firmy a nasazení aplikace se dokládají odděleně.
