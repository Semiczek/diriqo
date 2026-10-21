# Historické údaje zákazníka v běžné nabídce — kandidát 21. 10. 2026

## Stav

Lokální kandidát pro původní C02-02: „Změna aktuální adresy zákazníka nezmění adresu v již vydané nabídce.“ Migrace je aplikovaná v hostované testovací databázi a skutečné SQL sady prošly. Aplikační kandidát ještě čeká na nasazení na app.diriqo.com. C02-02 zůstává v akceptační matici CHYBA, dokud neproběhne přihlášené ověření nasazené aplikace. Celkový stav zůstává 4 HOTOVO / 49 ČÁSTEČNĚ / 4 CHYBA / 11 CHYBÍ / 5 NEOVĚŘENO.

## Chování

Při prvním zpřístupnění odkazu nebo vydání běžné nabídky databáze atomicky uloží identitu zákazníka včetně názvu, fakturační adresy, IČO, DIČ, e-mailu a telefonu. NULL hodnoty se zachovávají. Pozdější úprava zákazníka ani vrácení nabídky do konceptu tento záznam nepřepíše. Opakované zpřístupnění zachovává původní token a údaje.

Nový koncept nemá veřejný token. Odkaz vzniká výslovnou akcí Zpřístupnit odkaz; otevření detailu ani editoru token nevytváří. E-mailová cesta připraví historickou identitu před zápisem zprávy a před voláním poskytovatele. Při odmítnutí oprávnění se odeslání nespustí. Samotné zpřístupnění neoznačuje nabídku jako odeslanou. Stav ready sám o sobě historické údaje nezamyká.

Interní detail, interní PDF a zákaznický portál používají uložené historické údaje. Veřejný odkaz a jeho PDF dostávají historické jméno přes dosavadní RPC; neveřejná adresa ani kontakt se tím nezveřejňují. Kontaktní e-mail pro novou odpověď v portálu patří aktuálně přihlášenému uživateli. Nezveřejněné PDF je výslovně označené jako koncept.

Starší nabídky dostávají stav legacy_unknown. Jejich původní adresu nelze bezpečně rekonstruovat z dnešního zákazníka, ani když mají nyní stav draft. Rozhraní proto uvede, že původní údaje nejsou uložené. Migrace nevytváří domnělou historickou adresu.

## Oprávnění a integrita

Publikace kontroluje skutečného uživatele, aktivní profil a členství, roli manager/company_admin/super_admin, aktivní firmu, modul a schopnost core.quotes.create. Oprávnění a časová platnost se znovu ověřují po čekání na zámek a po zápisu. Serverová akce odmítá formulář pocházející z jiné aktivní firmy.

Trigger chrání samotný snapshot, stav, čas i auditního aktéra také proti přímému zápisu. U zachycené či historicky neznámé nabídky zakazuje změnu identity zákazníka a firmy. Skutečné FK ON DELETE SET NULL při odstranění zákazníka zůstává funkční; ruční odpojení žijícího zákazníka se odmítá. Auditní identifikátor autora se nemaže při odstranění profilu.

Společný regresní test aplikuje skutečné migrace atomického převodu a historické identity. Převod nového konceptu vyžaduje i oprávnění k vydání nabídky; chybějící oprávnění nebo pozdní expirace vrátí úplný rollback včetně snapshotu a podzakázek.

## Dosavadní lokální důkazy

- Historická identita: PGlite 67 scénářů, 3 kontroly skutečného stavu před migrací a 3 kontroly úklidu PASS.
- Převod s oběma migracemi: všech 61 původních scénářů, 8 nových integračních scénářů snapshotu a 5 kontrol úklidu PASS.
- Čtení historické identity, portál a PDF: 32 cílených testů PASS; PDF testy kontrolují textové operátory skutečně vygenerovaného bufferu, nejde o vizuální prohlídku.
- E-mailová integrace: 17 testů PASS nad skutečným handlerem a DAL, s mockovaným RPC a poskytovatelem. Žádný skutečný e-mail nebyl odeslán.
- Mapování chyb převodu: 48 cílených testů PASS.
- Finální společný lokální běh po posledních změnách: 1868/1868 aplikačních testů v 71 souborech, 18/18 platformních kontraktů, TypeScript bez diagnostik a ESLint 20 změněných souborů bez chyb či varování PASS. Platformní běh vypsal neblokující Node upozornění MODULE_TYPELESS_PACKAGE_JSON. Produkční build finálního aplikačního kandidáta také PASS, 107/107 statických stránek. Následná změna SQL testu opravila pouze očekávání nulového výsledku při RLS odmítnutí, aplikační kód se neměnil.
- Nezávislé statické review migrace nenašlo doloženou blokující chybu v rozsahu identity, tenantů, FK, opakování, rolí, expirace a pořadí zámků s převodem. Nejde o důkaz skutečného souběhu více databázových spojení.

PGlite používá zjednodušenou Auth a platební infrastrukturu. Nepotvrzuje hostované RLS, skutečné souběhy, původ placené licence ani práci přihlášeného uživatele na nasazeném webu.

## Databázový postup a obnova

Jediný cílový projekt je testovací Diriqo wfcpfraxiuhuglnuaxqj. Hub se neupravuje.

Migrace: supabase/migrations/20261021062831_protect_quote_customer_identity.sql.
SHA-256: C8D7AF854AB197FC4E8CB468E0489C5A488D57251C435824094E6FA8B472201C.
SQL sada: supabase/tests/quote-customer-snapshot.sql.
SHA-256: D643065DCFBD950F0C44D42F864F62ECA77072A03800B88EF14AEFAD9895FA03.

Read-only preflight zaznamenal 5 nabídek, 8 zákazníků a 45 zakázek. Soukromé řízené artefakty obsahují původní definice RPC, metadata, advisors, otisky tabulek a úplnou kopii pěti nabídek. Záloha obsahuje veřejné tokeny, proto se nepřikládá do repozitáře.

- artifacts/quote-customer/preflight-20261021.json — SHA-256 544277023c344af3efa785212f159dbf79f07e7f8a9818cf1ca0db7984ce97e1.
- artifacts/quote-customer/pre-migration-quotes-20261021.json — SHA-256 303b9f2cc171e3f3a0f345dec7de0f5a4b894e8230727ab84f546f524c79a4b8.

Před aplikací znovu potvrdit projekt, obsah migrace a nezměněný výchozí stav. Po aplikaci ověřit nové sloupce, přesný záznam migrace, otisky původních polí nabídek (bez čtyř přidaných sloupců), zákazníků a zakázek. Spustit skutečnou SQL sadu i společnou regresi převodu s rollbackem testovacích dat. Porovnat advisors před/po a uložit výsledky.

Po zachycení skutečných historických údajů nové sloupce neodstraňovat. Opravy řešit následnou migrací se zachováním historie; stará aplikace používající živou adresu zákazníka není bezpečný návrat tohoto kontraktu. Cílená záloha není důkazem obnovitelnosti celé databáze.

## Skutečné databázové ověření, 21. 10.

Migrace s výše uvedeným SHA je aplikovaná pouze v testovacím Diriqu. Původní migrační záznam vytvořený konektorem 20261021065155 byl nejdříve uložený do řízeného artefaktu. Jeho celé SQL tělo přesně odpovídalo lokálnímu souboru; po ověření prázdné cílové verze byla sjednocena pouze verze na CLI 20261021062831. SQL tělo a název se nezměnily; MD5 uloženého těla zůstává 441b66f9738624749de344d482294f6b.

Se zapnutými plpgsql.check_asserts prošla hosted sada identity 67 scénáři + 3 kontrolami rollback úklidu. Společná hosted regrese převodu prošla 61 původními scénáři + 8 integračními scénáři snapshotu + 5 kontrolami úklidu. Tři skutečné předmigrační kontroly jsou lokální důkaz PGlite, ne dodatečné hosted tvrzení.

První hosted běh identity správně zabránil worker zápisu, ale test očekával pouze trigger výjimku. Živé RLS místo toho odfiltrovalo UPDATE na nula řádků. Test nyní připouští jen přesné QUOTE_CUSTOMER_FORBIDDEN / 42501 nebo nulový počet dotčených řádků bez výjimky a v obou případech porovnává celý řádek před/po. Produkční guard se neměnil. Upravená sada prošla lokálně i v dočasné lokální variantě se zapnutým RLS. Původní neúspěch zůstává uložený.

První pokus společné hosted regrese vrátil transportní Invalid or expired requestState. Před opakováním bylo ověřeno, že žádná odpovídající testovací relace neběží, původní počty se nezměnily a testovací účty nezůstaly. Opakování přineslo výše uvedený úspěšný výsledek.

Po obou sadách zůstalo 5 nabídek, 8 zákazníků a 45 zakázek. Otisky všech původních polí nabídek (bez čtyř nových sloupců), celých zákazníků a zakázek přesně souhlasí s preflightem. Všech pět starších nabídek má legacy_unknown; žádná dnešní adresa se nedoplnila. Testovací účty obou sad a pomocné fault funkce: 0. Kategorie i počty security advisors zůstaly stejné; tím nejsou dřívější otevřená upozornění vyřešena.

Řízený důkaz: artifacts/quote-customer/migration-and-hosted-tests-20261021.json, SHA-256 25736ab6829912d5cce13a9029d8eb9fa77c8138fa62d5778bf6593a66e23ae5. Závěrečné zachování dat a sjednocená migrační verze jsou doložené samostatným preservation artefaktem.

## Otevřené kroky a hranice

Čeká finální commit/PR/CI, přesné nasazení a přihlášený průchod: vytvořit syntetického zákazníka A, vydat nabídku, změnit zákazníka na B a doložit původní A v nabídce a jejím PDF po novém načtení. Před tím se C02-02 neuzavírá.

Tato oprava neřeší neměnnost celého obsahu a cen nabídky, historickou identitu dodavatele ani celou veřejnou autorizační matici. Dosavadní veřejný RPC nevyhodnocuje revokaci a expiraci tokenu; migrace tento původní predikát nerozšiřuje a jeho náprava zůstává samostatným otevřeným bezpečnostním bodem. Fakturační PDF je jiná cesta a jeho uživatelem odložená oprava není součástí tohoto balíku.
