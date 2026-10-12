# Příprava izolovaného stagingu Diriqo Office

Tento dokument popisuje přípravu testovacího prostředí. Provedený Diriqo staging dokládají `reports/staging-diriqo-provenance.json` a výsledky v [TESTING.md](TESTING.md); tento návod sám nic nezřizuje. Testovací prostředí musí obsahovat pouze syntetická data. Produkční Auth a firemní data se nekopírují a do produkce ani původních lokálních checkoutů se nezapisuje.

## Povinná identifikace cíle

Orchestrátor musí před každým zápisem ověřit konkrétní povolený staging project ref a odpovídající Supabase URL. Samotné `current_database()`, název projektu, klíč nebo lokální env soubor nejsou důkazem stagingu. Produkční project refs musí být výslovně odmítnuty. Hodnoty JWT, hesel a administrátorských klíčů nepatří do reportu.

Nový staging má být vytvořen bez kopie zákaznických dat. Preflight musí běžet pod ověřeným staging DB owner účtem s neomezenou viditelností kontrolovaných tabulek; katalogový výstup musí potvrdit SELECT a neomezenou viditelnost řádků. Nulový počet zjištěný pod běžnou tenant rolí podléhající RLS není důkazem prázdné databáze. Před založením účtů musí kontrola počtů vrátit nulu pro `auth.users`, `public.companies`, `public.profiles` a `public.company_members`. Jiný výsledek vyžaduje zastavení a kontrolu původu dat; tento postup nesmí existující data automaticky mazat.

## Neúplná historie základního schématu

V obou klonech je `supabase/migrations/20260408160615_remote_schema.sql` prázdný. Migrace proto samy nedokládají úplné základní schéma tabulek `companies`, `profiles` a `company_members`. Diriqo obsahuje samostatný `supabase/bootstrap-diriqo-schema.sql`; Hub odpovídající bootstrap nemá. Bootstrap Diriqo není náhradou za skutečné schéma Hubu.

V Diriqo větvi `uaohvikqizlcklcaaier` automatický replay skutečně selhal a vstupní katalog potvrdil chybějící hostitelské tabulky. Následná staging oprava použila bootstrap a přesné hostitelské migrace uvedené s hashi v `reports/staging-diriqo-provenance.json`. Billing zdroj vyžadoval nejprve jeho vlastní definici `support_access_grants`, na kterou odkazuje dřívější SQL funkce; část ověřených zdrojů se provedla transakčně v dashboardu po chybě MCP. Tato výjimka je evidovaná a není vydávána za bezchybný automatický replay ani za úplnou shodu s produkcí. Po kontrole skutečných triggerů vzniklo 8 syntetických Auth účtů včetně odděleného operátora, 2 firmy a 9 členství; nevznikly pozvánkové e-maily ani placená předplatná. Testovací granty mají konečnou platnost uvedenou v reportu.

Před seedem spusťte pouze `scripts/staging-preflight.sql` proti již ověřenému staging cíli. Porovnejte jeho výstup se zdroji níže. Zastavte přípravu, pokud:

- základní tabulka nebo očekávaný sloupec chybí;
- existuje další povinný sloupec bez defaultu, jehož význam nebyl ověřen;
- typ, enum, CHECK, unikátní nebo cizí klíč neodpovídá zamýšlenému vložení;
- Auth trigger, trigger profilu nebo firmy má neověřenou funkci či externí vedlejší účinek;
- nelze jednoznačně určit vazbu Auth uživatele na profil;
- chybí potřebná skutečná capability autorita Diriqo;
- staging obsahuje neidentifikovaná data.

Žádný chybějící sloupec, default, role nebo trigger se nesmí domyslet. Preflight vypisuje definice triggerů a identifikátory funkcí; těla nalezených funkcí je nutné samostatně zkontrolovat před prvním vytvořením Auth uživatele. Nepřítomnost Auth triggeru v lokálních migracích není důkazem jeho nepřítomnosti v databázi. Neaplikujte celý historický strom migrací naslepo na prázdnou databázi a nepoužívejte skripty, které chyby seedování pouze zachytí a pokračují.

## Ověřené zdroje a minimální kontrakty

| Oblast | Hub | Diriqo |
| --- | --- | --- |
| Firma | `app/super-admin/companies/page.tsx`, `buildCompanyPayload`: vyžaduje název; kompletní DB kontrakt musí potvrdit katalog | `supabase/bootstrap-diriqo-schema.sql:115`: `id uuid` s defaultem, `name text NOT NULL`, časová razítka s defaultem |
| Profil | `app/workers/new/page.tsx:221`: nový Auth uživatel se váže přes `auth_user_id` i `user_id`; kompletní NOT NULL/defaulty musí potvrdit katalog | bootstrap `:139`: `id uuid` s defaultem, `full_name text NOT NULL`, nullable `auth_user_id` a `user_id` odkazující na Auth, základní sazby s nulovým defaultem |
| Členství | aktivní členství používá `company_id`, `profile_id`, `role`, `is_active`; Office role viz další tabulka | bootstrap `:155`: oba cizí klíče, `role text NOT NULL`, `is_active boolean NOT NULL`, unikátní dvojice firmy a profilu |
| Office identita | `lib/office/context.ts` a host adaptér Office SQL | `lib/office/context.ts`: profil musí mít `auth_user_id = auth.uid()`; `user_id` smí být NULL nebo stejná hodnota |
| Modul | samostatné `public.office_settings`, výchozí vypnuto | stejné sdílené Office nastavení; navíc capability kontrola pro zápis |

Diriqo migrace přidávají `currency`, `locale`, `timezone` s defaulty (`20260506170000_add_company_settings_module.sql`), `plan_key` a `is_demo` s defaulty (`20260509110000_add_saas_billing_subscription_model.sql`), nullable identifikátory země a firmy (`20260510173000_add_company_country_identifiers.sql`) a stav pracovníka `worker_status` (`20260513100000_add_worker_invites.sql`). Stav pracovníka může být NULL, `invited`, `active` nebo `disabled`. Tyto lokální zdroje jsou vodítkem pro kontrolu katalogu, nikoli oprávněním předpokládat shodný staging.

Office nezavádějte jako neověřenou hodnotu do starého `company_modules.module_key`. Používá vlastní nastavení a autentizované `office_set_enabled`.

## Účty a role

Každý host dostane vlastní běh se dvěma firmami A a B. Pro každý běh vygenerujte nový krátký `runTag` složený z malých písmen, číslic a pomlčky. Identity mají tvar `office-<host>.<runTag>.<a|b|platform>.<actor>@office-staging.invalid`. Jména mají například tvar `Office staging <runTag> A owner`; nevyplňujte skutečné osoby, IČO, adresy, bankovní údaje ani zákazníky.

| Testovací aktér | Hub role členství | Diriqo role členství | Office právo |
| --- | --- | --- | --- |
| A/B owner | `company_admin` | `company_admin` | vlastník |
| A/B editor | `manager` | `manager` | editor |
| A/B reader | `user` | `worker` | čtenář |
| A AI | `manager` | `manager` | editor s AI identitou |

Spouštěč vyžaduje přesně sedm testovacích účtů: `ownerA`, `editorA`, `readerA`, `ownerB`, `editorB`, `readerB`, `aiA`. Každý patří právě jedné firmě. Osmý, oddělený konfigurační účet může obsloužit obě firmy a nepatří do souboru credentials spouštěče:

- Hub: aktivní členství `super_admin` podle skutečného host adaptéru.
- Diriqo: samostatný aktivní záznam v `private.platform_admin_grants`; tenant role sama platformní oprávnění neuděluje. Pro průchod stránkou `/office/settings` potřebuje navíc aktivní tenant členství `company_admin` v příslušné firmě.

Konfigurační účet se nepoužívá jako běžný vlastník v negativních testech. Tím testy nepřekryjí chybu izolace oprávněním platformního administrátora.

## Vytvoření Auth identity a svázání profilu

Použijte existující Supabase Admin API pouze s klíčem ověřeného staging projektu:

```ts
const { data, error } = await stagingAdmin.auth.admin.createUser({
  email: syntheticEmail,
  password: generatedPassword,
  email_confirm: true,
  user_metadata: { full_name: syntheticName },
  app_metadata: principal === "ai" ? { office_principal: "ai" } : {},
});
```

`createUser` podle instalovaného `@supabase/auth-js` neposílá potvrzovací e-mail. Nepoužívejte `inviteUserByEmail`. Hesla generujte náhodně a držte je pouze v paměti nebo v chráněném dočasném úložišti; nevypisujte je. Účty musí zůstat v běžné Auth roli `authenticated`, nikdy `service_role`.

Použijte skutečně vrácené Auth UUID. Po vytvoření účtu ověřte, zda trigger vytvořil profil, hledáním přes `auth_user_id` nebo `user_id`:

- žádný profil: lze vložit profil až podle ověřeného katalogu;
- právě jeden profil: ověřte obě vazby a syntetickou identitu, použijte jeho skutečné UUID;
- více profilů nebo konfliktní vazba: zastavte běh.

Profil se nesmí převzít jen podle e-mailu. V Diriqo vyplňte přímou vazbu `auth_user_id`; fallback přes `user_id` samotný pro Office nestačí. Členství musí být aktivní.

`app_metadata.office_principal` smí nastavit jen staging Admin API. AI test musí použít skutečný přihlášený účet se serverem podepsaným JWT a po změně metadat získat nový token. Hodnota odeslaná klientem v těle Office požadavku není důkazem lidského ani AI aktéra. Kontrolujte účinek v nasazeném Office RPC.

Auth vytvoření a SQL seed nejsou jedna transakce. Po chybě zaznamenejte pouze ID objektů vytvořených tímto během a stav částečné přípravy. Neprovádějte hromadné mazání ani vyhledání a převzetí starších účtů podle názvu.

## Diriqo capability pro skutečný test zápisu

Office zápis používá existující `core.files.upload` přes `get_company_capability_access`. Test musí prokázat skutečnou vynucovanou autorizaci, nikoli pouze výchozí legacy povolení.

Ověřte přítomnost migrací:

- `20261010084407_separate_platform_authority_from_tenant_membership.sql`;
- `20261010193801_add_module_capability_authority.sql`;
- `20261010202807_add_nonfinancial_test_module_grants.sql`.

Host proces musí mít `DIRIQO_MODULE_BILLING_MODE=test`. Staging používá skutečný nefinanční mechanismus hosta: rollout `diriqo_core` s `livemode=false` a časově omezený testovací grant. Nejde o licenci editoru ani trial externího SDK. Nevytvářejte platební objednávky, Stripe data ani fiktivní zakoupené předplatné.

`private.company_module_rollouts` a `private.company_test_module_grants` nejsou zapisovatelné rolí `service_role`. Seed proto vyžaduje ověřené staging DB owner připojení; REST administrátorský klíč sám nestačí. Neobcházejte to změnou grantů či vypnutím RLS.

Po katalogové kontrole lze připravit parametrizovanou transakci s těmito skutečnými hodnotami:

- rollout: UUID testovací firmy, `product='diriqo_core'`, `livemode=false`;
- test grant: UUID stejné firmy, `product='diriqo_core'`, `register_id=NULL`, `policy_version='diriqo-capabilities-v0.1'`, jedinečný `source_ref` běhu, srozumitelný důvod, `origin='manual_grant'`, `state='active'`, `livemode=false`;
- `capabilities=ARRAY['core.files.upload']`;
- konečné `valid_from`, `valid_until` a `history_until`; zvolte například 24 hodin, `history_until=valid_until`. Databázový limit je 720 hodin.

Grant je neměnný; neprodlužuje se přes upsert. Případné zrušení použije pouze dovolený jednosměrný přechod na `revoked_at` s důvodem, po kontrole skutečného triggeru.

Zavolejte RPC s tokenem běžného člena dané firmy a argumenty `target_company_id`, `target_capability='core.files.upload'`:

| Okamžik | Očekávaný výsledek |
| --- | --- |
| rollout aktivní, grant chybí | `enforced=true`, `allowed=false`, `reason='module_required'`, `livemode=false` |
| platný test grant | `enforced=true`, `allowed=true`, `reason='test'`, `livemode=false` |

V obou případech ověřte také vrácenou firmu a capability. `reason='legacy'` s `enforced=false` nepovažujte za důkaz této kontroly. Čtenář musí zůstat bez Office zápisu i po udělení firemní capability.

## Onboarding a právní obrazovky

Přímá Office autorizace nepoužívá falešný stav zaplaceného předplatného ani automaticky nevyžaduje dokončený onboarding. Běžné přihlašovací přesměrování Diriqo může vést na onboarding podle `user_onboarding_state`; otestujte jej přes existující UI, pokud je součástí průchodu.

`LegalConsentGate` patří do běžného dashboardu Diriqo. Přímá Office stránka nemá samostatný právní SQL guard. Nevkládejte do seedu vymyšlená přijetí podmínek. Pokud úplný UI průchod vyžaduje potvrzení, použijte běžnou právní obrazovku/API se syntetickým účtem a aktuálními verzemi. Existence staršího čísla verze ve zdroji není důvodem je natvrdo seedovat.

## Pořadí ověření

1. Ověřit staging target guard, absenci zákaznických dat a katalog; zkontrolovat zjištěné triggery.
2. Potvrdit konkrétní parametrizovaný seed vůči skutečnému schématu. Nepoužívat odhadované sloupce.
3. Vytvořit nové syntetické Auth identity a jednoznačně je svázat s profily; vložit firmy a aktivní členství v transakci se skutečně vrácenými UUID.
4. Ověřit výchozí vypnutý modul. Konfiguračním účtem zapnout Office jen pro firmy A a B přes existující autentizované RPC. Případné syntetické zakázky vytvořit před capability rolloutem.
5. U Diriqo připravit skutečný testovací rollout a ověřit odmítnutí zápisu bez grantu při již zapnutém Office; jinak kontrolu capability překryje MODULE_DISABLED. Následně použít vlastní nefinanční testovací grant.
6. Přihlásit jednotlivé účty běžným `signInWithPassword`; ověřit token přes `getUser`. Pro skutečné host UI vytvořit běžné SSR přihlášení, protože middleware nepovažuje libovolnou Bearer hlavičku za browser session.
7. Provést čtení/zápisy, konflikty, obnovu verzí, opakovanou idempotentní operaci, kolizi idempotency klíče, cizí firmu, čtenáře, vypnutí modulu a AI návrh. AI schválení musí být odmítnuto; schválí pouze oprávněný lidský účet.
8. Pro souběh použít skutečně nezávislé požadavky/DB session a shodnou očekávanou verzi. Musí uspět právě jeden neslučitelný zápis a druhý vrátit konflikt bez další verze či duplicitního auditu.
9. Uchovat anonymizovaný manifest UUID a výsledky s rozlišením DB RPC, host route a UI. Zaznamenat konečný stav modulů a čas vypršení grantů.

Lokální PostgreSQL fixture s nastavenými claims ani jednosession test PGlite nedokládají skutečné Supabase JWT, SSR přihlášení nebo mezisession souběh. Tyto důkazy musí vzniknout samostatně ve stagingu.

Ukončení testu nesmí automaticky odstranit neznámá data ani projekt. Vyčištění může cílit pouze na objekty explicitně evidované v manifestu daného běhu a respektovat neměnné granty, audit a cizí klíče.
