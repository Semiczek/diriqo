# Atomický převod běžné nabídky na zakázku — 19. 10. 2026

## Oprava

Původní core cesta ukládala rodiče, podzakázky a přijetí nabídky odděleně. Při selhání podzakázky mohla vrátit existujícího rodiče jako úspěch. Nová cesta ukládá úplný strom, přijetí i soukromý záznam operace v jedné PostgreSQL transakci. Cena, měna a zákazník pocházejí z uzamčené nabídky.

Opakování používá stabilní identitu a normalizovaný obsah požadavku. Stejná operace nebo nové potvrzení stejného obsahu vrací původní zakázku. Jiný obsah se odmítne. Starší zakázka bez záznamu dokončení se nepovažuje za úspěšný převod a neopravuje se odhadem. Přesunutí rodiče pod jinou zakázku neumožní druhý převod. Po smazání zdroje či výsledku zůstává záznam operace zachovaný.

Formulář uchovává nejistý požadavek podle firmy, uživatele a nabídky; po obnovení stránky opakuje stejný obsah. Dvojklik blokuje synchronní zámek. Jediný vybraný den se zachová jako podzakázka a noční rozpis nepřesáhne rodiče. Denní rozpis je omezený na 366 dnů, samostatné dlouhodobé zakázky tím omezené nejsou. Chyba potvrzovacího e-mailu nezpochybní úspěšný vznik zakázky a opakování e-mail automaticky znovu neposílá.

Databáze kontroluje současné členství, roli, aktivní profil, firmu, moduly a časovou platnost oprávnění po čekání na zámky i po zápisech. Identifikátory zdrojových zakázek smí nově vytvořit pouze transakce s předem uloženým soukromým potvrzením. Starý klient tedy nevytvoří neúplný strom. Přímé odpojení živé nabídky se odmítá; dosavadní FK úklid při skutečném smazání nabídky zůstává povolený.

Navazující oprava deleteQuoteAction odstraňuje pouze nabídku. Její položky odstraní existující FK CASCADE v téže transakci. Selhání mazání už neponechá nabídku bez předem smazaných položek.

## Ověření kandidáta

- Vitest: 1802/1802 PASS v 68 souborech, včetně 44 serverových a 18 UI kontrol této opravy.
- Izolovaný PGlite: 61 scénářů + 5 kontrol rollback úklidu PASS. Obsahuje skutečné selhání child INSERT, přijetí nabídky, pozdní odebrání oprávnění, expiraci během zápisu a tiše přeskočené dítě zachycené odloženým constraint triggerem.
- Platformní kontrakty: 18/18 PASS.
- TypeScript, cílený ESLint, git diff --check a produkční Next.js build: PASS.
- Nezávislé statické review našlo regresi mazání položek; výše uvedená oprava a SQL i aplikační testy ji pokrývají.

PGlite používá zjednodušenou Auth/platební infrastrukturu, skutečné core tabulky z bootstrapu a sdílený evaluator testovacích oprávnění. Výsledek není důkazem hosted RLS, platebního původu licence ani souběhu více skutečných spojení.

## Databáze a nasazení

Jediný cílový projekt je testovací Diriqo wfcpfraxiuhuglnuaxqj; Hub se nemění. Read-only preflight zjistil 39 zakázek, 3 nabídky a žádnou dosavadní vazbu source_quote_id. Soukromě jsou uložené otisky obchodních tabulek, definice dosavadních triggerů a FK i výchozí advisors. Jde o cílený záznam rozhraní/stavu, nikoli ověřenou obnovu celé databáze.

Migrace: supabase/migrations/20261019081209_atomic_core_quote_conversion.sql.
Lokální SHA-256: 547D43C36F7FCF18DD330A8730F4096E96DBBF66EED1F9FCE930A88CE585A1D3.
SQL test SHA-256: 098B96648F8068C4FEC73F76FAEF3775F4CB536406C2FAE45CF23422140AB884.

Migrace je aplikovaná v testovacím Diriqu. Skutečná hosted SQL sada se zapnutými asercemi prošla 61 scénáři a 5 kontrolami rollback úklidu. První volání konektoru vrátilo neplatný requestState; před opakováním bylo ověřeno, že žádná testovací relace neběží a obchodní otisky se nezměnily. Po úspěšném běhu zůstává 39 zakázek a 3 nabídky se stejnými otisky jako před migrací, 0 potvrzení konverze, 0 testovacích firem a 0 pomocných testovacích funkcí. Migrační historie byla po uložení původního záznamu sjednocená s CLI verzí 20261019081209; SQL tělo se neměnilo. Aplikační změna zatím není nasazená. Mezi kroky staré otevřené formuláře převodu bezpečně selžou. Neodstraňovat registry po vytvoření skutečných záznamů; opravy databáze řešit následnou migrací. Návrat aplikace na starý převod neobnovuje kompatibilitu s bezpečnostními guardy.

## Zbývající akceptace C01-02

Skutečný souběh je doložen níže. Ještě zbývá přihlášený průchod formulářem a opakování po ztracené odpovědi na přesné nasazené revizi. Samostatná hranice je potvrzení obsahu nabídky změněného v jiné kartě: tento kontrakt nepřidává očekávanou revizi nabídky.

PR #34 obsahuje kandidáta 5c728ba4d564abf3aa311750357262f925709c05. Jeho GitHub CI verify a oba Office běhy prošly. Advisors po migraci přidaly pouze dvě očekávané informační položky RLS bez policies pro privátní registry s odebranými právy; jiné kategorie zůstaly stejné. To není celkový bezpečnostní audit produktu.

Původních 73 scénářů a jejich znění zůstává zachováno. C01-02 není bez úplného důkazu označen HOTOVO; tento balík neprokazuje celkovou komerční připravenost Diriqa.
## Skutečný souběh a uzavření přístupů, 19. 10.

Dvě nezávislé Auth relace provedly dva ověřené souběhy v testovacím projektu. PostgreSQL pozoroval oba skutečné čekající backendy za zámkem stejné firmy; zámek ihned uvolnil rollback testovací podtransakce. Časové limity rolí se neměnily.

- První kolo: PID 746469 / 746473 za bariérou 746472, 09:28:03.004384 UTC. Dvě HTTP 200, právě jeden created=true a jeden replay, stejný rodič 8a041141-9c3b-425a-ab49-20d20cbbf063 a přesně dvě podzakázky. Cena, měna, termíny, vazby i původní obsah nabídky ověřeny.
- Druhé kolo: PID 746529 / 746530 za bariérou 746531, 09:33:11.937709 UTC. Původní požadavek HTTP 200 / created=false; změněný obsah HTTP 409 / PT409. Úplný snapshot před/po konfliktu totožný.
- První pokus o pozorování druhého kola nestihl bariéru. Neúspěch zůstává uložený. Pokračování použilo stejnou operaci nad již existující zakázkou, ověřilo otisk dokončeného prvního kola a přihlásilo dvě čerstvé relace. Nevytvářelo další nabídku ani zakázku.
- Testovací firma 588f3293-610b-4cfe-996b-1e14a5231f9b zůstává s auditními důkazy; 0 aktivních členství, profil neaktivní, grant revokovaný, moduly vypnuté, účet zablokovaný, 0 Auth sessions. Soukromý rollout zůstává zachovaný, aby neobnovil legacy přístup. Původních 39 zakázek a 3 nabídky ostatních firem mají shodné otisky podle původního algoritmu.

Řízené artefakty: artifacts/core-quote-concurrency-complete-20261019.json, SHA-256 5094b0ad90d2117bd61e3ba7d03f9346708e9c5e768fadf5f2b6a04428d9d453; samostatný preservation report zachycuje původní hashovací algoritmus. Přihlášený webový průchod po nasazení ještě čeká.
