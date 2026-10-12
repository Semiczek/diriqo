# Distribuce a zapnutí modulu

## Připravené checkouty

`integrations/hub` a `integrations/diriqo` jsou oddělené kopie skutečných repozitářů na revizích uvedených v ARCHITECTURE.md. Obsahují serverové guardy, `/office`, `/api/office/files`, read-only `/api/office/context`, přepínač `/office/settings`, navigaci, odhlášení a ochranu rout. Původní checkouty se neměnily. Při přenosu změn zkontrolujte konflikty a zachovejte jejich rozpracovanou práci.

Oba hostitelé používají stejný `vendor/diriqo-office-0.1.0.tgz`. Obsahuje klientský a serverový kód, importní worker, typové deklarace, CSS, licence a SBOM. React zůstává existující peer dependency 19.2.4. Hostitelské lockfile přidávají pouze tuto místní závislost.

Balíček přebalíte po testech příkazem `node scripts/package-integrations.mjs`. Součty jsou v `release/SHA256SUMS` a `vendor/office-integrity.json`. Nekopírujte samotný `dist/` bez licencí, fontu a plného OFL. Sdílené editory se upravují v tomto projektu, nikoli samostatně v obou hostitelích. Změna dokumentace dovoluje nové přebalení, ale aktuální archiv musí mít nové ověřené hashe a nesmí být zaměněn za dříve otestované runtime bajty.

## Next.js a importní worker

Nepřidávejte celý smíšený balíček `@diriqo/office` do `serverExternalPackages`: jeho klientská část a CSS se musí sestavit Nextem. Připravená integrace nechává balíček bundlovat a souborový endpoint běží v Node runtime.

Host předává `importOfficeFileBounded` pevnou URL `node_modules/@diriqo/office/dist/import-worker.js` odvozenou ze serverové instalační cesty. Hodnota nikdy nesmí pocházet z requestu nebo dokumentu. Konfigurace `outputFileTracingIncludes` zachovává worker, jeho ESM `package.json`, soubory `LEGAL.txt` a licenční evidenci. Při změně deployment layoutu upravte tuto důvěryhodnou cestu a ověřte skutečný import v nasazeném prostředí.

Plné lokální buildy a jejich aktuální stav jsou popsány v TESTING.md a `reports/*-next-build.json`. Pro ověření se pouze kopírovaly existující hostitelské závislosti do izolovaných checkoutů; nové hostitelské balíčky se neinstalovaly.

## Veřejný origin uploadu

V obou hostitelích nastavte serverovou proměnnou `OFFICE_PUBLIC_ORIGIN` na přesný veřejný origin daného nasazení bez koncového lomítka, cesty či přihlašovacích údajů. Při nepřítomnosti proměnné dovolí souborový endpoint pouze důvěryhodný Vercel fallback: `VERCEL=1` a platný deployment hostname `VERCEL_URL` končící `.vercel.app`. Chybné výslovné nastavení se nenahrazuje fallbackem; neznámý origin upload odmítne. `NEXT_PUBLIC_APP_URL` ani `SITE_URL` nejsou zdrojem této důvěry.

Reverse proxy musí zachovat přesný veřejný `Host`; forwarded hlavičky se k odvození oprávněného originu nepoužívají. Lokální HTTP je dovolené pouze pro localhost/127.0.0.1/IPv6 loopback, jejich adresy však nejsou zaměnitelné. Mutace ověřují Origin, čtení GET/HEAD jej nepotřebuje. Základní pravidla jsou v [OFFICE_ORIGIN.md](OFFICE_ORIGIN.md).

## HTTP meze a PDF

Připravené hosty přijímají nahraný soubor nejvýše 3 MiB, JSON požadavek nejvýše 3 800 000 UTF-8 bajtů a JSON odpověď nejvýše 4 350 000 bajtů včetně Base64. Multipart má navíc rezervu 65 536 bajtů pro formulář a kontroluje skutečný proud. Obecný 12MiB limit formátového adaptéru není limitem těchto HTTP cest. Limit vyvolá `OFFICE_HOST_LIMIT`, v souborovém endpointu HTTP 413; neobcházejte jej zvyšováním jen klientské hodnoty.

Zápisy existujícího obsahu provádějí předběžnou kontrolu očekávané odpovědi s rezervou pro metadata. Není atomická s SQL mutací; chyba doručení může vzniknout i po úspěšném zápisu při souběžné změně. Zachovejte RPC revize a idempotentní klíče při obnově neznámého výsledku. Detailní hranice jsou v [LIMITATIONS.md](LIMITATIONS.md).

Serverový export `pdf` používá vložený OFL font a vlastní omezenou sazbu, bez fontového souboru načítaného za běhu z disku či externího renderu. Zkontrolujte stažený PDF přes skutečnou nasazenou exportní cestu. Tiskové CSS a nativní dialog jsou oddělenou cestou; podporovaná podmnožina, limity a požadavky prohlížeče jsou v [PDF_EXPORT.md](PDF_EXPORT.md).

## Staging před zapnutím

Automatizovaný staging postup a ochrany proti záměně produkčního projektu jsou v [STAGING_RUNBOOK.md](STAGING_RUNBOOK.md). Před seedem ověřte skutečné katalogy podle [STAGING_PROVISIONING.md](STAGING_PROVISIONING.md); samotné repozitáře neobsahují úplnou výchozí definici všech hostitelských tabulek.

Pro dočasné veřejné ověření platí navíc [PUBLIC_STAGING.md](PUBLIC_STAGING.md). Staging-only nastavení nikdy nezadávejte v produkčním projektu ani produkčním deploymentu. Příprava zdrojů nebo proměnných sama nepotvrzuje veřejný provoz; skutečné výsledky spravuje [STAGING_ACCEPTANCE.md](STAGING_ACCEPTANCE.md).

| Proměnná pouze izolovaného stagingu | Požadavek |
| --- | --- |
| `OFFICE_STAGING_ONLY` | Přesně `1`; v běžném hostu musí být nenastavená. Hodnota `0` staging bezpečně nevypíná, ale znamená chybnou konfiguraci. |
| `OFFICE_STAGING_PROJECT_REF` | Přesný schválený ref pro odpovídající host z PUBLIC_STAGING.md; guard obsahuje pevný seznam a oba produkční refy odmítá. |
| `OFFICE_STAGING_EXPIRES_AT` | Platné budoucí UTC datum přesně `YYYY-MM-DDTHH:mm:ssZ`; aktuálně schválené okno je `2026-10-12T17:00:00Z`. Chybějící, neplatné či uplynulé datum vrací 503. |
| `NEXT_PUBLIC_SUPABASE_URL` | Přesný HTTPS origin schválené větve bez lomítka; je-li nastavena také `SUPABASE_URL`, musí se shodovat. |
| `OFFICE_PUBLIC_ORIGIN` | Přesný HTTPS origin tohoto veřejného deploymentu, nebo při absenci důvěryhodná serverová metadata `VERCEL_URL` konkrétního Vercel deploymentu. Alias je jiný origin. |

Deployment používá jen veřejný anon/publishable klíč své staging větve a běžné uživatelské přihlášení. `service_role`, testovací hesla a lokální soubory `.staging` do něj ani do distribuovaného archivu nepatří. Automatickou registraci a nesouvisející aplikační routy guard odmítá; povoluje pouze explicitní Office/auth/company-switch/logout cesty a nezbytné statické soubory. `/` přesměruje na `/office`. Neznámá nebo chybná konfigurace musí skončit odmítnutím, nikoli návratem k produkčnímu prostředí.

Při nenastaveném `OFFICE_STAGING_ONLY` zůstává původní hostitelské routování zachováno. Vypršení guardu pouze zastaví přístup; úklid samostatných projektů a větví musí proběhnout a být ověřen zvlášť. Časový limit sám prostředky nemaže ani nezastavuje jejich účtování.

1. Ověřte hash archivu, licenční CI a produkční build cílového checkoutu. Zkontrolujte skutečný NFT manifest a přítomnost workeru, ESM metadat i notices v deploymentu.
2. Přídavnou migraci `supabase/migrations/20261011140000_diriqo_office.sql` aplikujte nejprve ve staging databázi. Použijte výhradně artefakt správného hostitele: Hub připojuje `office-hub-adapter.sql`, Diriqo má vlastní host hooks. Migrace neodstraňuje stávající tabulky ani role; bez ní je Office nedostupné. Lokální SQL testy již prošly, ale nepotvrzují nasazený Supabase projekt.
3. Proveďte staging scénáře z TESTING.md s reálně přihlášenými klienty, dvěma firmami a souběžnými spojeními. Ověřte privátní schema, přímé RPC, role, flag, identity a Diriqo capability.
4. V Hubu otevřete `/office/settings` jako `super_admin` cílové firmy. V Diriqo použijte skutečného platformového administrátora; samotná firemní role platformový přepínač neopravňuje měnit.
5. Zapněte pouze ověřenou testovací firmu. `office_settings.enabled` je výchozně `false`; chybějící nastavení nebo chyba kontroly znamená odmítnutí přístupu.
6. Vytvořte dokument i sešit, uložte je a znovu otevřete. Ověřte import/export, originál, historii a lidské schválení návrhu. Produkční firmu povolte až po těchto kontrolách běžným schváleným nasazením.

Diriqo vyžaduje profil s `auth_user_id = auth.uid()`; případné `user_id` musí být prázdné nebo shodné s `auth_user_id`. Profil pouze s legacy `user_id` nebo rozpornou identitou Office odmítne. Tato integrace identity uživatelů automaticky neopravuje ani nemigruje. Hub zachovává svůj existující hostitelský způsob mapování identity.

Vypnutí přepínače zachová dokumenty a blokuje čtení i zápisy. Pro běžný provoz aplikujte po core a hostitelském adaptéru také samostatnou přídavnou migraci z database/office-normalized.sql. Nepřepisujte již aplikovanou core migraci. Normalizované úložiště, firemní vazby, kontrola převodu dat a bezpečné podmínky návratu jsou v [NORMALIZED_PERSISTENCE.md](NORMALIZED_PERSISTENCE.md).

### Dodatečná Hub závislost pro názvy firem

Nový Hub Office klient používá `public.office_company_labels(p_company_id uuid, p_company_ids uuid[])` z `database/office-hub-adapter.sql`. Je připojený za společné jádro do připravené Hub migrace. Pokud prostředí již aplikovalo starší verzi Office migrace, samotná výměna klientského balíčku tuto funkci nepřidá: připravte a schvalte samostatný přídavný migrační krok podle workflow daného hostitele. Nepředpokládejte automatické zopakování již evidované migrace a nepoužívejte Hub adaptér v Diriqo.

Funkce poskytuje pouze ID a názvy explicitně vyžádaných firem. Znovu ověří uživatele, Office kontext a zapnutý modul výchozí firmy, omezí jednorozměrný vstup na 1–100 neprázdných UUID a výsledky na aktivní členství se zapnutým Office. Používá pevný `search_path=pg_catalog`; EXECUTE patří pouze authenticated, PUBLIC a anon jej nemají. Původní SELECT politika companies, tabulkové granty a globální role se nemění. Ověřte vlastní/cizí/vypnutou firmu i anonymní zákaz před nasazením klienta; testovací podklady jsou `tests/database-hub-labels.sql` a `tests/host/hub-office-company-labels.test.mjs`. Bez funkce neřešte chybu rozšířením obecného čtení companies.

## Integrace Diriqenta

### Povinné následné migrace persistence

Po jádru a adaptéru aplikujte v pořadí `database/office-normalized.sql` a `database/office-normalized-receipt-commit.sql`. První odstraní souhrnnou hranici 64 MiB oddělením souborů, verzí, originálů a auditu; druhá opravuje privátní odloženou kontrolu při potvrzení transakce. Nestačí pouze aktualizovat klientský balíček. Přesné přídavné soubory jsou v každém integračním patchi ve složce `supabase/migrations`; nesmějí se nahrazovat opakováním dříve aplikované migrace. Postup ověření a bezpečný návrat popisuje [NORMALIZED_PERSISTENCE.md](NORMALIZED_PERSISTENCE.md).

Na serveru sestavte `OfficeAIAdapter` z čerstvě autorizovaného kontextu firmy s principalem `ai`. Nástrojům nedávejte approval handler, service-role klíč ani SQL. Schválení patří přihlášenému člověku a používá idempotentní request s očekávanou revizí. Označení AI identity v důvěryhodných autentizačních claims musí odpovídat připraveným guardům; pouhý údaj od klienta není důkaz identity.

Nákladová metadata mají připravené rozhraní. Office nezavádí tarif, kredity ani placené kancelářské SDK.

## CI a testovací nástroje

Sdílené CI nejprve kontroluje schválenou evidenci a teprve potom instaluje lockfile bez lifecycle skriptů. Nová evidence vzniká při samostatném předinstalačním auditu a review. Hostitelské CI používá `scripts/check-office-package.mjs`, kopii společného `scripts/check-host-office.mjs`: kontroluje archiv, notices, SBOM, hash evidence assetů, vlastní bajty fontu a plný OFL, i změny přímého a nepřímého hostitelského grafu. Kontrola původního grafu znamená jeho nezměněnost, nikoli nový audit všech legacy závislostí.

Typy jsou v `types/`; kontrola může používat existující TypeScript hostitele přes `OFFICE_TSC_PATH`. Lokální SQL runner může používat již přítomný prověřený PGlite přes `OFFICE_PGLITE_MODULE`. PGlite ani jeho PostgreSQL engine nejsou součástí Office archivu či auditu nových Office závislostí. Před novou instalací tohoto testovacího runtime do CI je nutný samostatný audit včetně PostgreSQL License; viz TESTING.md.

## Upřesnění hostitelského přístupu

JSPD mapuje existující roli `worker` pouze na čtenáře Office. Přístup mimo Office se tím nerozšiřuje. Výslovný `active_company_id` musí být platný a odpovídat aktivnímu členství; cizí nebo chybný výběr se odmítá. Jen při úplné absenci cookie může čerstvá Office relace použít jedinou aktivní firmu pracovníka; nula či více možností přístup neumožní. Login přijímá pro návrat pouze přesné `/office`, jinak zachovává původní chování.

Oba hostitelé umožní autentizovanému zaměstnanci přesnou cestu `/logout`. GET nic neodhlašuje; potvrzovací tlačítko spustí Server Action s `signOut({scope: 'local'})`, po úspěchu vymaže volbu aktivní firmy a vrátí přihlášení. Office odkaz otevře odhlášení v novém panelu, aby původní draft zůstal k dispozici. Změna neuděluje další firemní roli.

Office přepínač firmy používá v Hubu existující `/api/active-company/switch`, v Diriqo úzkou `/api/office/company`. Server znovu ověřuje členství a Office oprávnění. Otevřený panel zůstává připnutý k původní firmě, identitě a režimu čtení; zobrazený draft se při změně cookie nezahodí ani nepřenese do jiné firmy. Po ověření změny se transport pozastaví a nabídne zálohu, návrat k původnímu kontextu nebo otevření nového panelu. Ověřte tento průchod se skutečným uživatelem s legitimním členstvím v obou testovacích firmách.

Historie verzí nyní používá vlastní DOM potvrzovací dialog. Před potvrzením ukazuje soubor a přesun mezi revizemi; nový draft nebo změna dokumentu, revize, transportu či oprávnění jej zneplatní. Změna aktivní firmy blokuje hostitelský transport. Nasazený browser průchod musí zvlášť potvrdit fokus, Escape, zrušení, jediné obnovení a reopen bez falešného automatického uložení.

Samostatné `npm test` nepotřebuje hostitele. Pro `npm run test:hosts` připravte skutečné izolované checkouty na revizích z `release/DELIVERY.json`, aplikujte odpovídající patch a připravte jejich již prověřený Next runtime. Potom spusťte `npm run test:hosts:check`. Chybějící checkout, zdroj nebo požadovaný runtime je chyba, nikoli přeskočený test. Příkaz sám nic neklonuje ani neinstaluje. Protokol aktuálního běhu: [STAGING_ACCEPTANCE.md](STAGING_ACCEPTANCE.md).
