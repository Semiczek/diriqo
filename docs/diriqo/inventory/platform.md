# Diriqo – platformní mapa mezer podle nové specifikace

Stav k 10. 10. 2026. Pouze čtení zdrojů; žádná změna aplikace, databáze, ceny, účtu ani nasazení. Cíl zdrojového porovnání: `C:\vyvoj\diriqo`, čistý `main`, commit `208c9ead6dface1b0a25bfedd71ff398eb9dd480`. Pracovní kopii připravuje hlavní agent. Podklad: [Vložený text](C:/Users/semis/.codex/attachments/b2680e79-3c1f-40b7-a3b2-e1487dce9a0e/Vložený%20text.txt), kapitoly 3, 4, 7, 8, 9 a platformní části 10, 12, 13. Nové CZK ceny jsou **DRAFT testovací konfigurace**, nikoli schválený živý ceník.

## Závěr pro první implementaci

Existující identitu, firmu, členství, registraci a Stripe napojení zachovat. Diriqo má funkční stavební části, ale současné `company_modules` představují uživatelská nastavení, nikoli důkaz zakoupené schopnosti. Počet pracovníků, status předplatného, role a modulové přepínače se nyní vyhodnocují odděleně. Nový licenční model proto musí vzniknout vedle starého, s výslovnou kompatibilitou EUR předplatných.

Nejmenší první dávka je čistý, testovatelný kontrakt platformy: známé produkty a schopnosti, oddělený verzovaný DRAFT katalog, rozhodovací funkce s výchozím odmítnutím a výslovný adaptér stávajícího EUR modelu. Sama tato dávka **není** dokončená fáze 1 ani opravená ochrana produkce. Než se nový model připojí k obchodním zápisům, je nutná navazující databázová ochrana členství a systémových rolí a první celá vertikála včetně přímých SQL/RPC cest. Kritické riziko stávající administrace nelze opravit pouze skrytím tlačítka nebo novým TypeScript typem.

## Jak číst stavy a důkazy

- **Existuje**: konkrétní část je doložena zdrojem; neznamená to, že prošla integrační akceptací.
- **Částečně**: základ existuje, ale proti požadavku chybí konkrétní podmínka či cesta.
- **Chybí**: ve zkoumaném cíli nebyla nalezena implementace požadovaného kontraktu; přesná budoucí jména jsou návrh.
- **Vyžaduje ověření**: zdroj sám neprokazuje rozhodný stav, pořadí instalace, účinek či právní rozsah.

Označení E01–E15 níže jsou konkrétní zdrojové balíčky: obrazovka / server / tabulka / SQL / guard. T0 znamená, že mezi sedmi existujícími testovacími soubory není nalezen odpovídající test daného požadavku. T1 jsou pouze unit testy pomocných funkcí rolí, T2 pouze validace vybrané firmy, T3 pomocné funkce pozvánek. Nejsou to integrační testy RLS ani dvou firem. Testy se v této nové etapě nespouštěly; dřívější pokus v auditním prostředí skončil před spuštěním testů na infrastruktuře (`spawn EPERM`), tedy není dokladem prošlých scénářů.

## Konkrétní zdrojové balíčky

| ID | Obrazovka / funkce / data a poslední lokální SQL / guard a test |
|---|---|
| E01 Identita a firma | `/register`, `/onboarding/company`; [RegisterForm.handleSubmit](C:/vyvoj/diriqo/app/register/RegisterForm.tsx:31) volá Supabase `signUp`, ukládá pouze záměr plánu do metadata; [onboarding action](C:/vyvoj/diriqo/app/onboarding/actions.ts:169) ověřuje `getUser()` a volá RPC. Poslední verzovaná definice [create_onboarding_company](C:/vyvoj/diriqo/supabase/migrations/20260510173000_add_company_country_identifiers.sql:106), `SECURITY DEFINER`, kontroluje `auth.uid()` na ř. 141; vytváří `companies`, `company_members`, settings/modules/mailbox v jedné SQL funkci. Nemá operation ID. Lookup profilu má i větev shodného emailu na ř. 245. T0. |
| E02 Kontext a role | [getActiveCompanyContext](C:/vyvoj/diriqo/lib/active-company.ts:69): `getUser()` ř. 78, aktivní členství ř. 108–127, ověřená volba cookie ř. 134–136, alternativní výběr firmy podle poslední zakázky ř. 140–164. [server-guards](C:/vyvoj/diriqo/lib/server-guards.ts:24): `requireAuthenticatedUser`, `requireCompanyRole`, `requireHubAccess`, `requireWorkerAccess`, `requirePortalAccess`; žádné capability ani billing rozhodnutí. `company_members` / `profiles`. [T1](C:/vyvoj/diriqo/tests/auth-guards.test.ts:11), [T2](C:/vyvoj/diriqo/tests/active-company-switch.test.ts:10). |
| E03 Role v DB a superadmin | Poslední verzovaná `is_company_admin` je [20260425190000:38](C:/vyvoj/diriqo/supabase/migrations/20260425190000_proposed_role_separated_rls.sql:38), dovoluje `company_admin`,`super_admin`; samostatný [bootstrap:70](C:/vyvoj/diriqo/supabase/bootstrap-diriqo-schema.sql:70) navíc `manager`. [company_members_admin_write](C:/vyvoj/diriqo/supabase/migrations/20260425190000_proposed_role_separated_rls.sql:237) je `ALL`, neomezuje novou hodnotu role. [is_super_admin](C:/vyvoj/diriqo/supabase/migrations/20260509110000_add_saas_billing_subscription_model.sql:167) i [requireSuperAdmin](C:/vyvoj/diriqo/lib/superadmin.ts:14) odvozují platformní autoritu z libovolného firemního členství `super_admin`. `/admin/companies` po guardu čte přes service role. Zde T1 nestačí; T0 přímá DB eskalace. |
| E04 Moduly | `/settings/company`; [COMPANY_MODULE_KEYS](C:/vyvoj/diriqo/lib/company-settings-shared.ts:1), duplikovaný seznam v serverovém [company-settings](C:/vyvoj/diriqo/lib/company-settings.ts:5). [getCompanyModules](C:/vyvoj/diriqo/lib/company-settings.ts:284) začíná všemi 12 klíči `true`, při DB chybě je zachová a chybějící řádky upsertuje jako zapnuté. [requireCompanyModule](C:/vyvoj/diriqo/lib/module-access.ts:10) testuje pouze tento přepínač. `company_modules`: poslední verzovaná definice [20260506170000:236](C:/vyvoj/diriqo/supabase/migrations/20260506170000_add_company_settings_module.sql:236), CHECK připouští 17 historických klíčů, default true, unique(company_id,module_key); policies ř. 452–462 dovolují členům číst a firemním adminům měnit. Neobsahuje zdroj nároku, cenu, dobu ani produkt. T0. |
| E05 EUR tarify | `/billing`, `/pricing`, `/settings/company`; [plans](C:/vyvoj/diriqo/lib/plans.ts:31): Starter/Growth/Business/Scale, 19/39/79/149 EUR měsíčně, 190/390/790/1490 ročně, 5/15/30/50 worker míst. [normalizePlanKey](C:/vyvoj/diriqo/lib/plans.ts:98) neznámý vstup převádí na Starter; enterprise/custom na Scale. SQL poslední změna [20260517170000](C:/vyvoj/diriqo/supabase/migrations/20260517170000_align_billing_plans_to_four_tiers.sql:1): přepis starých klíčů a upsert `billing_plans` bez historie ceny. T0. |
| E06 Předplatné | [getCompanySubscription](C:/vyvoj/diriqo/lib/subscription.ts:93) čte `company_subscriptions`, [getOrCreateTrialSubscription](C:/vyvoj/diriqo/lib/subscription.ts:122) přes service role upsertuje 7denní trial Starter; [isSubscriptionUsable](C:/vyvoj/diriqo/lib/subscription.ts:197) agreguje trial/active/past_due/canceled, past_due tolerance 3 dny ř. 185. SQL [20260510120000](C:/vyvoj/diriqo/supabase/migrations/20260510120000_add_company_subscriptions_mvp.sql:3), později plány E05. Starší tabulka `subscriptions` nadále v SQL existuje. [disable_subscription_hooks](C:/vyvoj/diriqo/supabase/migrations/20260510131000_disable_subscription_hooks_for_auth_mvp.sql:1) ruší automatický trial a capacity triggery. [requireActiveSubscription](C:/vyvoj/diriqo/lib/subscription.ts:214) a [ensureBillingAccessForPage](C:/vyvoj/diriqo/lib/billing.ts:87) nemají obchodní callsites. `/api/billing/status` pouze stav vrací. T0. |
| E07 Stripe | [create-checkout-session POST](C:/vyvoj/diriqo/app/api/stripe/create-checkout-session/route.ts:22) ověřuje identitu a `company_admin/super_admin`, vybírá EUR price ID z env a metadata firmy; [webhook POST](C:/vyvoj/diriqo/app/api/stripe/webhook/route.ts:239) ověřuje podpis. [syncSubscription](C:/vyvoj/diriqo/app/api/stripe/webhook/route.ts:139) dělá poslední upsert podle firmy; subscription událost používá přímo svůj objekt ř. 260–264, invoice událost nejprve načítá subscription ř. 206–212. Chybí processed-event ledger a pravidlo pro starší událost. Návrat checkout=success sám nemění status. T0. |
| E08 Počet a personální model | [getActiveWorkerCount](C:/vyvoj/diriqo/lib/subscription.ts:301) počítá aktivní členství s role=worker. Neměří plná místa ani samostatné aktivní osoby bez účtu. `worker_payment_settings` existuje s company/profile scope ([SQL:163](C:/vyvoj/diriqo/supabase/migrations/20260506170000_add_company_settings_module.sql:163)), ale fallback čte globální `profiles` ([company-settings:334](C:/vyvoj/diriqo/lib/company-settings.ts:334)); změna sazby [finance action:210](C:/vyvoj/diriqo/app/workers/%5BworkerId%5D/finance/actions.ts:210) mění globální profil. Worker detail má agregace filtrované profile_id bez firmy. [worker invite tests](C:/vyvoj/diriqo/tests/worker-invites.test.ts:41) testují token/telefon/text/stav; neoddělení vztahů mezi firmami. |
| E09 Země/jazyk | [company-country-config](C:/vyvoj/diriqo/lib/company-country-config.ts:1) má pouze jména, výchozí jazyky/měny a popisky identifikátorů, fallback `ZZ/en/EUR`; neznámou zemi zachová s fallbackem [ř. 354](C:/vyvoj/diriqo/lib/company-country-config.ts:354). `/settings/company` [save action:187](C:/vyvoj/diriqo/app/settings/company/actions.ts:187) mění country/default_language/default_currency/locale; guard admin. SQL E01 ukládá tyto hodnoty, ale timezone pro mnoho zemí včetně US skončí Praha [ř. 224](C:/vyvoj/diriqo/supabase/migrations/20260510173000_add_company_country_identifiers.sql:224), billing default 21 % a FV ř. 369–385. T0 zemský kontrakt. |
| E10 Doklady | `/invoices`; [create action:359](C:/vyvoj/diriqo/app/invoices/actions.ts:359) natvrdo CZK, customer/supplier snapshot ř. 369–370; vydání volá `next_invoice_number` ř. 470, následný update ř. 494 bez atomické podmínky status=draft. Poslední verzovaný guarded RPC [20260425223000:147](C:/vyvoj/diriqo/supabase/migrations/20260425223000_add_invoices_and_pohoda_export.sql:147) je potřeba porovnat s [bootstrap:929](C:/vyvoj/diriqo/supabase/bootstrap-diriqo-schema.sql:929), který guard nemá. T0 idempotentní vydání / místní daňový profil. |
| E11 Soubory | `/api/job-photos`; [web path](C:/vyvoj/diriqo/lib/job-photo-storage.ts:59) má job/category/id. GET read signing používá admin po scope kontrole, POST signing session klient [route:476](C:/vyvoj/diriqo/app/api/job-photos/route.ts:476). Samostatné storage patche, např. [patch-job-photo-storage-pipeline](C:/vyvoj/diriqo/supabase/patch-job-photo-storage-pipeline.sql:1). Výsledná politika je závislá na pořadí aplikace; dřívější read-only živý důkaz hlavního agenta vyžadoval company/job/category. T0 odvolání/signed URL/tenant útok. |
| E12 Audit a právo | [logSuperadminAction](C:/vyvoj/diriqo/lib/superadmin.ts:28), `superadmin_audit_log` v [20260509110000](C:/vyvoj/diriqo/supabase/migrations/20260509110000_add_saas_billing_subscription_model.sql:228). Dílčí audit zobrazení detailu firmy a admin akcí, ne jednotný autorizační audit všech citlivých cest. `legal_document_versions` + `user_legal_acceptances`: [20260517190000](C:/vyvoj/diriqo/supabase/migrations/20260517190000_add_legal_compliance_system.sql:3), poslední cookie změna 20260721140000. Tyto tabulky nejsou katalog cen ani verze daňových pravidel. T0. |
| E13 Základ a UI | 92 app page, 43 route.ts v předchozím inventáři. Jobs, customers, workers, shifts, calendar, absences, advances, quotes/calculations, invoices, portal, email, costs; DiriPOS/stock/fleet/AI-credit domény v cíli nejsou. Přepínač modulů se nepromítá do kompletního seznamu datových cest; viz samostatný seznam níže. `/jobs` [page:838](C:/vyvoj/diriqo/app/jobs/page.tsx:838) čte více tabulek v klientu bez company_id/paginace. |
| E14 Migrace a import | `supabase/migrations/20260408160615_remote_schema.sql` je prázdný základ, vedle migračního proudu `bootstrap-diriqo-schema.sql` a samostatné patch soubory. [DEPLOYMENT_DIRIQO](C:/vyvoj/diriqo/DEPLOYMENT_DIRIQO.md:13) na neúplný základ upozorňuje. Ve zkoumané platformní části není obecný tenantový import ledger/checkpoint protokol ani claim zaručující replay celého schématu. T0 čistá instalace. |
| E15 Testy | Sedm souborů v `tests/`: auth-guards, active-company-switch, worker-invites, public-token-security, economics, worker-payroll, labor-calculation. Dominuje testování pure helperů. Nenalezena platformní sada catalog/entitlements/Stripe replay/RLS/device/country. CI existence neprokazuje, že tyto akceptace proběhly. |

**Poznámka k E10:** ani poslední lokální migrační definice ani bootstrap samy neprokazují živý stav. Viz kapitola o SQL níže.

## 3 – Platforma, licence a schopnosti

| Požadavek specifikace | Stav | Co v cíli existuje / konkrétní mezera | Guard / test |
|---|---|---|---|
| Sdílená identita, firma a členství, nikoli další POS zákaznická DB | Částečně | E01/E02: `auth.users`→`profiles`→`company_members`→`companies`; základ použitelný. DiriPOS zařízení a společný prodejní katalog nejsou implementované. | Identita a role ano; P02/P04 T0. |
| Sdílená zařízení, audit, licence, soubory, notifikace, usage | Částečně | Soubory/email/dílčí audit E11/E12; samostatná device principal, authoritative entitlement ledger a usage ledger chybí. | Role/RLS dílčí; P01/P05/P06 T0. |
| Samostatně obchodovatelné Diriqo core a POS | Chybí | E05 má pouze čtyři company EUR tarify stejného produktu; E13 neobsahuje POS. Onboarding zakládá job-related settings a všechny moduly. | Nový POS nesmí vyžadovat `diriqo_core`; P04 T0. |
| Stabilní product codes `diriqo_core`, `inventory`, `invoicing`, `smart_quotes`, `fleet`, `ai_assistant`, `pos` | Chybí | Současné `jobs/.../invoices` E04 jsou historické modulové klíče. Nestačí je přejmenovat: základní nabídka se nesmí stát celá placeným smart_quotes. | Známý registry chybí; P03/P16 T0. |
| Jemné schopnosti a technické vs obchodní závislosti | Chybí | E04 zná jen boolean modul. Neodlišuje invoice.read/issue, POS sale/settle, OCR/chat, history/export/new-write. | T0; registry musí rozlišit účel operace. |
| Současné splnění země, nároku, členství/device, akce a scope | Chybí | E02, E04, E06 jsou oddělené; není centrální autorizace skládající všech pět podmínek. | T0; ani SQL entitlement helper. |
| Obor pouze navigace/předvolby; sdílená data nedávají skryté náklady | Částečně | Role a tabulkové politiky existují, ale není průkazná akční/field-level matice pro katalog/nákupní cenu/mzdu. Oborový profil jako explicitní konfigurace nenalezen. | P01/P03/P12 T0. |
| Základní zákazníci a položky použitelné více produkty bez dvojího placení | Částečně | `customers`, calculations/quote položky existují; společný item master s rolemi quote/sales/stock a suppliers není. | Nové propojení vyžaduje tenantové FK a scope. |
| Kompletní list/detail/create/filter/page/export/error/mobile kontrakt 3.1 | Částečně | E13 má reálné obrazovky a formuláře. Např. jobs klientské dotazy nemají aktivní firmu/paginaci; nelze potvrdit úplný modulový kontrakt. | P07/P22/P25 T0. |
| Validovaný target, expected version, operation ID, standardní důvody odmítnutí | Částečně | Role guard vrací 401/403; některé formuláře prověřují target firmu. Nejednotný business error model, CAS/operation ledger chybí (E10). | P01/P05/P18/P23 T0. |
| UI/API/DAL/direct DB/RPC/export/import/storage/jobs/AI stejně vynucují | Chybí | Pouze 13 callsites E04; mnoho přímých Supabase čtení a zápisů. Nový TS guard sám přímé cesty nezavře. | P03 bez integrace nelze prohlásit za hotový. |

## 4 – Obchodní model a DRAFT CZK katalog

| Požadavek | Stav | Cíl / změna oproti dnešku | Guard / test |
|---|---|---|---|
| Zachovat dosavadní EUR smlouvy a oddělit nový katalog | Vyžaduje ověření + návrh | E05 pevná EUR mapa existuje, ale nemá explicitní catalog_version. Nový CZK katalog musí být vedle ní a nikdy nesmí projít starým `normalizePlanKey`. | Snapshot/regrese všech EUR klíčů, price env a intervalů; T0. |
| Solo 299:1/0, Team 699:3/10, Company 1299:5/30 plných/pracovních míst, stejný core | Chybí | E05 měří jen workers 5/15/30/50; E08 nemá full-user vs worker capacity. Tyto CZK hodnoty patří jen do draft fixtures. | P21 T0. |
| Manažer s docházkou není druhé pracovní místo, pracovník bez loginu se počítá, archiv ne | Chybí | Počítá se role=worker v aktivním členství. Profil a pracovní vztah nejsou konzistentně odděleny; E08. | Cap counter nad pracovním vztahem, ne auth loginem; P02/P21 T0. |
| +full seat149, +10workers199; capacity za období, žádná skrytá fakturace | Chybí | Žádné subscription items, potvrzení změny, účinné období či dodatkové kapacity. Zrušené membership limit triggery E06. | Atomic capacity check při aktivaci/zvýšení role, T0. |
| Downgrade od dalšího období, výběr archivace, zachovaná owner billing správa | Částečně | Billing owner role E07, cancellation flag E06; budoucí změna capacity/bezpečná volba archivu nejsou. | P11/P21 T0; zachovat posledního admina transakčně. |
| Inventory299/3 warehouses; invoicing199; smart_quotes299; fleet199/5 +29; AI199/100 credit | Chybí | Neexistuje nárok a množství pro jednotlivý produkt, ledger kreditu ani capacity asset model. Část invoice/quote business UI existuje (E10/E13). | P03/P21 T0; žádné změny EUR. |
| Inventory jednou za firmu pro core i více POS; suppliers bez dalšího poplatku | Chybí | Současné company scope je vhodný základ, ale není sdílený product entitlement a usage model. | P21 T0. |
| Explicitní náhled ceny/období, schválená aktivace a verzovaný proration | Chybí | Checkout EUR funguje, nenahrazuje subscription change proposal/snapshot ceny a množství. | P10/P21 T0. |
| POS per logical register, jeden prodejní device, bezpečná výměna; report/PIN není core seat | Chybí | Cíl nemá device/register model, POS tariffs ani oddělený device principal. | P04/P19/P21 T0. |
| Mini100/mo nebo1000/yr; Classic399; Gastro699 a skutečné rozdíly schopností | Chybí | Není POS; zatím pouze draft katalogové popisy. Daňový/hardware/offline support není automaticky zahrnut obchodním jménem. | P18/P19/P25 T0. |
| Mini dovolí opravu starého prodeje; vyšší tarif druhé pokladny nepřenese schopnosti | Chybí | Potřeba `settle_prior_event` a register-scoped licence, nikoli univerzální firemní POS boolean. | P18/P21 T0. |
| Trial30 dní jednou/firmu, explicitní trial produkty, omezené AI | Částečně | E06 má 7 dní a Starter, starý patch 14 dní; nová pravidla nesmí zpětně prodloužit/přepsat existující trial. | Atomic one-time grant a time injection test; T0. |
| Roční10% sleva kromě Mini; Solo3229,20; AI měsíční grant i u annual | Chybí | EUR roční cena odpovídá10 měsíčním cenám, jiný model. CZK počítat v haléřích podle konkrétní verze; bez přepisu EUR ročního ceníku. | P21, hranice zaokrouhlení, T0. |
| Customer portal a restricted accountant bez full seat, plná účetní práce placená | Částečně | E02 portal zvláštní auth je přítomný, počítání seats není; accountant role/per-action režim chybí (`CompanyRole` jen4 role). | P01/P21 T0. |
| Home legal profile zahrnut, jazyk a obor zdarma, pravidla verzovaná | Chybí | E09 umí nastavení a popisky, ne zemskou schopnost/verzi ceny/trial/grace. | P12/P25 T0. |

## 7 a 8 – Země, firmy a autorizace

| Požadavek | Stav | Zjištění / zdroj | Guard / test |
|---|---|---|---|
| Nezávisle země právních pravidel, UI jazyk, měna, timezone, obor | Částečně | E09 má samostatné sloupce země/jazyka/měny/timezone. Defaulty některých zemí nesprávně předpokládají Prahu; industry chybí. | P12 T0. |
| Verze a účinnost zemských pravidel, snapshot rozhodné konfigurace dokladu | Částečně | E10 ukládá customer/supplier snapshot, ne versioned country adapter/tax rules. Hardcoded CZK/21/FV nejsou důkaz podpory země. | P12 T0. |
| Jeden tenant = právní subjekt; provozovny nesdílejí cizí účetnictví ani neduplikují licenci | Částečně | `companies` základ ano; explicitní model provozoven a produktových kapacit v platformě nenalezen. | Tenant composite FK a P01/P04/P21 T0. |
| CZ první, EN UI, status nepodporováno/test/ověřeno pro zemi×citlivou funkci | Chybí | Country list je pouze konfigurace. Není capability support matrix ani guard odmítající neověřený regulovaný tok. | P12/P25 T0; sazby zde záměrně právně neposuzovány. |
| Změna země ovlivní budoucí operace, nikoli historii | Částečně | Snapshot dokladu pomáhá, current company settings jsou přímo přepisovány. Chybí řízená účinnost a historická country rule verze. | P12 T0. |
| Společný člověk, oddělená členství a pracovní vztahy | Částečně | E02 memberships ano, E08 globální profile pay fields a některé aggregate queries odporují důslednému company scope. | P02 T0. |
| Email nesloučí pracovní záznamy firem | Vyžaduje ověření | E01 SQL hledá profil i podle emailu; link existujícího profilu a konkrétního firemního vztahu potřebuje explicitní workflow/test. Samotný společný email není důkaz exploitability. | P02, pozvánka + ownership + dual identity test, T0. |
| Jednoznačné vlastnictví každého private záznamu a zákaz cross-company FK | Částečně | RLS a tenant sloupce existují, nejsou jednotné compound FK/guardy pro všechny vazby. E13 klientská agregace počítá union viditelných firem. | P01/P07 T0. |
| Cookie/form company je pouze požadavek; původní editace A po switch B nesmí změnit B | Částečně | E02 cookie ověřuje membership; target/action query musí zachovat původní company. T2 testuje jen ID ze seznamu, nikoli late response a odeslaný formulář. | P05/P07 T0 integration. |
| Všechny autorizační dimenze při každé důležité operaci; revokace platí pro starý token | Částečně | E02 čte aktuální membership, ale E04/E06 nejsou složeny, cache/jobs version chybí. | P03/P05 T0. |
| Explicitní superadmin, oddělený support scope, audit | Částečně – kritická mezera | E03 odvozuje platformní roli z tenant membership. UI změna role E02 zakazuje super_admin, přímá policy E03 stejnou ochranu nemá; dílčí audit E12. | P01/P05, přímý REST/SQL pro běžného admina a managera; T0. |
| UI není bezpečnostní hranice; RPC/definer/service-role mají vlastní scope/akci | Částečně | E03/E10/E11 mají odlišné cesty a SQL varianty. Nestačí dodatečně zavolat guard jen v page.tsx. | Přímé role/grant/RPC testy, T0. |
| Background jobs: actor,company,operation ID,recheck a dokončení staré operace | Chybí | Jednotný job envelope a revocation/settlement contract v cíli nenalezen. | P05/P18/P23 T0. |
| Cache klíče:tenant,role/entitlement version,locale; cancel late response | Částečně | Ověřená company selection existuje; úplná cache/revocation contract ne. E13 jobs dotaz ani nefiltruje vybranou firmu. | P07 T0. |
| Storage/preview/export scoped; žádné nové URL po revokaci, skutečná TTL | Částečně | Serverové signing scope E11 existuje, cesta web uploadu a DB policy nejsou sjednoceny. Nelze tvrdit okamžité odvolání již vydaného URL. | P06 T0. |
| AI stejná datová autorita, oddělený veřejný obsah a firemní historie/index | Chybí | AI služby/tenant retrieval/tool registry v cíli nejsou. Nové shared helpers musí počítat s `actor=system/device/user`. | P08 T0. |
| Žádné implicitní email/JSPD-ID bezpečnostní výjimky | Vyžaduje ověření | V zkoumaných guardech nebyla použita konkrétní interní emailová výjimka; E01 obecná emailová identity fallback větev je jiný problém a vyžaduje test. | P01/P02/P13, nelze tvrdit celorepo negativní důkaz. |

## 9 – Billing, spotřeba a životní cyklus

| Požadavek | Stav | Zjištění / zdroj | Guard / test |
|---|---|---|---|
| Serverová autorita a samostatná historie platebních událostí | Částečně | E07 ověřuje podpis, E06 stav v DB; chybí immutable event ledger a transakční projekce práv. | P10 T0. |
| Duplicita a starší webhook nesmí přepsat novější stav ani znovu přidat kredit | Částečně | Upsert jedné subscription omezuje duplicitní řádek, ale nezajišťuje pořadí/effect-once. Kredit dosud není. | P10 T0. |
| Draft bez paid nároku; active;grace;readonly;canceled, různá povolení | Částečně | E06 jiné status enum + jediný `usable`. Chybí read/export/new/settle matice. `canceled` do period_end zůstává usable – užitečná kompatibilita. | P11 T0. |
| Produkt/company/platnost/původ/verze nároku; explicitní bezplatný grant | Chybí | E04 module boolean nemá původ ani platnost; E06 jeden tarif není product entitlement ledger. | P03/P11/P21 T0. |
| Stav účtu vs subscription vs entitlement vs toggle vs člověk | Chybí | Části existují separátně, ale není výslovný kontrakt precedence. Admin toggle nesmí vytvořit zakoupené právo. | P03/P11 T0. |
| Zrušení obnovy zachová uhrazený čas a vyřeší závislé add-ons | Částečně | E06 cancel_at_period_end/period_end; add-on dependency graph a plánované ukončení nejsou. | P10/P11 T0. |
| DRAFT grace7d, historie/export90d, žádný automatický purge | Chybí | E06 má3d a locked boolean. Návrh nesmí hromadně přepsat stávající práva/retence. | Clock-boundary P11; T0. |
| Rozlišení new write/history export/settle prior event; bez členství ani historie | Chybí | Neexistuje typ purpose ani původ settlement události. Stará událost nesmí být obecné licence bypass API. | P05/P11/P18/P19 T0. |
| Offline POS24h signed grant, clock rollback, revokace, bezpečný late sync | Chybí | POS ani device entitlement není v cíli. Worker offline app není dokladem bezpečnosti pokladního protokolu. | P19 T0. |
| Credit append-only reserve/settle/release, atomic balance, operation vs attempt | Chybí | Není ledger/reservation/provider attempt/reconciliation. Nezaměňovat s `job_cost_items`. | P09 T0. |
| Sale credit vs interní provider cost, money integers, pricing version | Chybí | Není AI cenový přepočet/usage table. Náklad firmy a kredit zákazníka jsou dva odlišné pohledy. | P09/P21 T0. |
| Included100/měsíc pouze po úhradě, expirace included, carryover topup100/300/1000 | Chybí | Draft pravidla, grant schedule ani credit lots nejsou. Roční EUR subscription nepřepisovat. | P09/P10/P21 T0. |
| OCR bez chat licence, modul+document scope+budget, jeden zákaznický účinek | Chybí | Žádný OCR/AI capability model v cíli. Kredit není náhradou licence domény. | P03/P08/P09/P20 T0. |
| Technická chyba a unknown result: dohledání, provider cost zachován, capped reservation | Chybí | Není orchestrace ani reconcile stav; timeout nesmí automaticky refund/retry paid call. | P09/P23 T0. |
| Free public help30 zkušebních zpráv + budget/abuse limits, oddělená KB | Chybí | Statická nápověda není konverzační public help service s budgetem. | P08/P25 T0. |
| Cost reporting company/module/period, fixed cost allocation, net revenue stejné období | Chybí | Job/company expenses nejsou náklady provozovatele SaaS za DB/AI/email/payments/support. Není podklad pro tvrzení5×–10×. | P25 T0; 699/5=139,80 a /10=69,90 jsou pouze cílové rozpočty. |

## 10 – Přenos, spolehlivost a ověřitelnost

| Požadavek | Stav | Zjištění / zdroj | Ověření |
|---|---|---|---|
| Přesné commity, izolovaná kopie, preserve/copy/redesign pro každou funkci | Částečně | Tento mapovací krok používá přesný clean HEAD, pracovní kopii připravuje root. Migrace Hub domén není v této zprávě provedena. | P15; manifest změn a zdrojových licencí bez dat. |
| Pouze produktový kód a syntetika, žádné interní záznamy/tokeny/logy/backups | Návrhová podmínka | Přenos se zde neprováděl. Fixtures nové platformy nesmějí vycházet z produkčních dumpů. | P13/P25 T0. |
| Reprodukovatelné verzované schema včetně grantů/RLS/functions/storage | Vyžaduje ověření | E14 prázdný začátek + bootstrap/patches, odlišné definice E03/E10/E11. Časové pořadí souborů samo nestačí určit produkční efekt. | Čistý isolated DB replay + katalog assertions; P13/P25 T0. |
| Import ledger,input digest,format version,tenant,checkpoint atomicky s dávkou | Chybí | Obecný import kontrakt nenalezen v platformě; případná konkrétní import UI není tento protokol. | P14 T0. |
| Kompatibilita historických názvů a protokolů | Existuje jako nutná podmínka změny | `hub-access`, `requireHubAccess`, historické SQL tabulky/klíče existují. Nepřejmenovávat automaticky na produktové názvy. | P15 regresní diff; T0. |
| Jeden finanční zdroj, propojení cost/payment/stock/doc | Částečně | E10/E13 část job economy/invoice vazeb; chybí společný nový stock/POS kontrakt. | P17 a doménový audit, T0. |
| Stejné op ID+obsah stejný výsledek, jiné tělo konflikt; concurrent safe | Chybí | E01 onboarding a E10 issuing nemají tento kontrakt; E07 webhook není event ledger. | P10/P14/P18 T0. |
| E-mail/tisk/asynchronní projekce oddělená od business transaction | Částečně | Mail tabulky existují, ale vydání dokladu/odeslání není společný durable outbox kontrakt s effect dedupe. | P23 T0. |
| Paginace/agregace nad celým filtrem,20k katalog, exact money,DST | Částečně | Některé pure economics/labor helper testy, ale E13 bez pagination a tenant filter; nejsou velké syntetické integration tests. | P07/P17/P22 T0. |

## Skutečné callsites dnešního modulového guardu

`requireCompanyModule` má 13 volání v pěti souborech. Nejde o kompletní licenční hranici:

- [jobs/actions](C:/vyvoj/diriqo/app/jobs/actions.ts:439): ř. 439, 743, 887, 973 → jobs.
- [calendar/actions](C:/vyvoj/diriqo/app/calendar/actions.ts:76): ř. 76, 235, 352 → calendar.
- [workers finance/actions](C:/vyvoj/diriqo/app/workers/%5BworkerId%5D/finance/actions.ts:66): ř. 66, 130 → payroll; ř. 180 → workers.
- [job customer-contacts/actions](C:/vyvoj/diriqo/app/jobs/%5BjobId%5D/customer-contacts/actions.ts:81): ř. 81, 176 → jobs.
- [kalkulace/actions](C:/vyvoj/diriqo/app/kalkulace/actions.ts:21): ř. 21 → quotes.

Součet nalezených callsites je **13 v pěti souborech** (4+3+3+2+1). `isCompanyModuleEnabled` volá jen tento guard. `/api/company-modules` přímo volá `getCompanyModules`, stejně jako settings načtení. Billing guardy nemají obchodní volající. Proto nelze v novém kódu pouze přejmenovat `requireCompanyModule` a prohlásit ochranu celé platformy za dokončenou.

## Poslední SQL a rozhodující pořadí

1. **Onboarding:** `20260510173000_add_company_country_identifiers.sql` nahrazuje starší čtyřparametrový `create_onboarding_company` devítiparametrovou funkcí; guard identity a transakce ano, op id/anti-duplicate firm creation ne. Inicializuje téměř všechny legacy modules jako true a country billing defaulty. Nemá nový30denní grant.
2. **Subscription:** `20260510120000_add_company_subscriptions_mvp.sql` je aktivně čtená tabulka; `20260510123000` mění limity; `20260510131000` je následně ruší jako triggery/functions. `20260517170000` mění plan constraints a billing interval. Starší `subscriptions`/`billing_plans` nelze považovat za jediný skutečný runtime zdroj jen podle jejich názvu.
3. **Moduly:** `20260506170000` vytváří preference tabulku a politiky. Při opětovném replay se některé politiky zakládají jen `if not exists`; starší stejnojmenná definice tedy nemusí být nahrazena. Aktuální platný SQL stav nelze odvodit pouhým přečtením posledního souboru.
4. **Role:** verzovaná `is_company_admin` a bootstrap se liší zahrnutím managera. Obě cesty v kombinaci s neomezeným membership-write a platformním `is_super_admin` vyžadují nápravu. Přechozí live read-only audit rodiče potvrdil variantu s managerem a absence role CHECK/triggerů; v této etapě se živá DB znovu nevolala.
5. **SECURITY DEFINER:** subscription transition funkce mají globální účinek na splatné záznamy; opravit execute grants a interní systémovou autoritu. Neznamená to oprávnění měnit libovolný status libovolného řádku. `next_invoice_number` musí mít vlastní company/action kontrolu bez závislosti na tom, že ho obvykle volá bezpečná stránka.
6. **Clean replay:** před první aplikací nové platformní SQL migrace je třeba doložit, z jaké kompletní základny se lokální test DB staví. Nepouštět automaticky všechny historical patche do produkce a nepovažovat jejich existenci za aplikaci.

## Doporučená nejmenší první implementační dávka fáze 1

### Dávka 1A – kontrakt a kompatibilita, bez změny prodeje a stávajících práv

Rozsah může být několik čistých modulů a cílené unit testy; přesná jména jsou návrh, nikoli existující implementace:

1. `lib/platform/capabilities.ts`: jediný registry sedmi produktů a jemných schopností, explicitní purpose `new_operation | history_read | history_export | settle_prior_event`, scope `company | register`, prerequisite metadata. `isCapabilityCode(unknown)` odmítá neznámé vstupy. Nezakládat žádné klíče automaticky při čtení.
2. `lib/platform/catalog.ts` + `catalog-czk-draft.ts`: neměnná identita `catalog_version`, status=draft, currency/minor_units/effective_at, ceny a capacity pravidla ze specifikace. Draft není v checkout ani nav/onboarding volbě. EUR `lib/plans.ts`, env price ID a stávající SQL řádky zůstanou identické. Výsledek ročního Solo přesně322920haléřů; Mini100000haléřů; yearly core90%12měsíců.
3. `lib/platform/access-decision.ts`: čistá rozhodovací funkce vyžadující trusted input snapshot; known capability, current membership/device identity, action permission, country support, entitlement source/version/validity, module operational state, scope a operation purpose. Výstup `{allowed, reason, policyVersion}`. Chybějící/rozbitý nárok nesmí udělit nové právo. Function není sama serverová autorita – loader musí přijít v1B.
4. `lib/platform/legacy-entitlements.ts`: výslovná, omezená kompatibilita stávajících EUR plans a dosavadního významu modulů. Oddělit `legacy_compatibility` od `paid`, `trial`, `manual_grant`. Neodvodit zaplacené inventory/POS/fleet/AI z historického `modules=true`. Nepřevést celý `quotes` automaticky na placené smart_quotes. Neznámý plan zde odmítnout, nepoužít starý default Starter pro nové udělení práv.
5. Testy tabulkové rozhodovací matice: unknown key; missing entitlement; DB-load failure reprezentovaný explicitním error výsledkem; role/company mismatch; ordinary toggle on bez licence; inherited wrong register; disabled after expiry s history vs new; manual grant origin; EUR plan snapshot beze změny; draft CZK nelze koupit; legal unsupported issuing odmítnut; raw UI locale nesmí měnit legal profile. Vše synteticky, bez Supabase či Stripe účtu.

**Akceptace1A:** čisté helper testy, nezměněný EUR ceník a žádný nový produkční callsite který začne udělovat/odebírat reálná práva. Dokumentace výslovně „kontrakt připraven, aplikační a DB enforcement nedokončen“. Neprohlašovat P01/P03/P05 za prošlé z těchto unit testů.

### Dávka 1B – první autoritativní vertikála (nezbytná před reálným zapnutím)

Samostatná kontrolovatelná změna s lokální/sandbox DB. Její první téma má být **členství a platformní role**, protože je předpokladem věrohodnosti ostatních licencí:

- Oddělit platformní administrátory od tenantové `company_members.role`; explicitní serverem spravované assignment/source a auditované support oprávnění. Firemní admin nesmí přidat/změnit platformní roli přes REST/SQL/RPC ani profile link. Historické role migrovat jen z ověřeného seznamu, nikoli slepým povýšením všech aktuálních super_admin membership.
- Změnu role/aktivace/odebrání členství provést transakčně, s company target, last-admin invariantem a očekávanou verzí. Současné count→update v `updateCompanyMemberRole` není ochrana proti závodu dvou adminů.
- Nové tabulky verzovaných nároků a auditních událostí s tenant scope, platností, zdrojem, immutable původem; pouze důvěryhodná serverová/system cesta smí udělovat. Běžný company admin může změnit preference, ne zakoupená práva. Nové test tenants mají explicitní synthetic grants, žádný tichý grant na read.
- Loader aktuálního `AccessContext` navazuje na `getUser()` a ověřenou konkrétní firmu/objekt. Pro nové cesty žádný fallback na jinou oprávněnou firmu. RLS/direct RPC musí mít stejnou autoritu nebo revokované přímé vstupy.
- Integrační testy se skutečnými rolemi v izolované DB: dva tenants, worker/manager/admin/support, self-promotion, forged profile link, cizí membership ID, stale form, concurrent last-admin removal, module off direct API/RPC/read/export/write. Zkontrolovat kompletní přímé grants a katalog SQL definic.

Po1B vybrat jednu obchodní vertikálu a uzavřít její **všechny** vstupy. Fakturace je užitečný budoucí důkaz country+licence+transaction kontraktu, ale není vhodné ji označit za jednoduché připojení guardu: souběžné vydání, číslování, portal/export, email a immutable historie vyžadují samostatný rozsah. Plné nové Stripe lifecycle/event ledger, credit reserve/settle, POS zařízení a regulované zemské adaptéry patří do následných explicitních dávek.

## Zbývající ověření a předání

Tato mapa neopakuje živou DB ani browser. Přenáší přesně vymezené zdrojové závěry a odkazuje na dřívější live evidence pouze tam, kde je to výslovně uvedeno. U právních sazeb, cizích zemí, terminálů ani cen poskytovatelů nečiní aktuální faktické tvrzení. Pro dokončení fáze1 jsou nutné P01/P03/P05 v izolované DB i příslušné aplikační cesty; pro celou platformu zůstávají ostatní P scénáře otevřené podle této matice.

Historické EUR předplatné, firemní data, Hub a produkční Stripe/Supabase zůstaly během tohoto mapování beze změny.


Upřesnění rozsahu od hlavního agenta: uživatel následně výslovně určil celé Diriqo jako testovací prostředí. Tato mapa přesto zůstala pouze čtecí, bez DB mutací či testovacích dat. Hub je nadále mimo zápisy. Nový status prostředí nemění požadavek zachovat historické EUR licence bez implicitního přecenění.
