# Atomický převod běžné nabídky na zakázku — akceptace 21. 10. 2026

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

Migrace je aplikovaná v testovacím Diriqu. Skutečná hosted SQL sada se zapnutými asercemi prošla 61 scénáři a 5 kontrolami rollback úklidu. První volání konektoru vrátilo neplatný requestState; před opakováním bylo ověřeno, že žádná testovací relace neběží a obchodní otisky se nezměnily. Po úspěšném běhu tehdy zůstalo 39 zakázek a 3 nabídky se stejnými otisky jako před migrací, 0 potvrzení konverze, 0 testovacích firem a 0 pomocných testovacích funkcí. Migrační historie byla po uložení původního záznamu sjednocená s CLI verzí 20261019081209; SQL tělo se neměnilo. V tomto migračním mezikroku aplikace ještě nebyla nasazená; guardy odmítají původní oddělené zápisy převodu. Následné nasazení PR #34 je doložené níže. Neodstraňovat registry po vytvoření skutečných záznamů; opravy databáze řešit následnou migrací. Návrat aplikace na starý převod neobnovuje kompatibilitu s bezpečnostními guardy.

## Nasazení a uzavření původního C01-02

[PR #34](https://github.com/Semiczek/diriqo/pull/34) je sloučené jako **b0c37bbdffdf955ed3dcd7aeba4395373875875b**. Release owner dne 21. 10. znovu ověřil main [verify 39231775006](https://github.com/Semiczek/diriqo/actions/runs/39231775006) a [Office 39231775020](https://github.com/Semiczek/diriqo/actions/runs/39231775020): oba SUCCESS. Deployment **dpl_FuSHRb4rsq94qL8FenzzE7FW8FFC** je READY pro tento přesný SHA na app.diriqo.com. Dřívější kandidát 5c728ba4d564abf3aa311750357262f925709c05 měl také úspěšné PR verify a oba Office běhy.

Původní text C01-02 zůstává: „Opakovaný požadavek na převod stejné přijaté nabídky vrátí již vytvořenou zakázku, nevytvoří další.“ **HOTOVO pro tento invariant:** hosted SQL, dva skutečné souběhy níže a přihlášené UI opakování potvrzují stejný úplný strom bez druhé zakázky. Nejde o uzavření celého Core procesu ani komerční připravenosti. Žádný z ostatních 72 scénářů se tímto přehodnocením nemění; původních 73 ID a textů je zachováno.

Přihlášené UI ověření proběhlo 19. 10. v Diriqo Demo s.r.o. na výše uvedeném nasazeném merge: nabídka **7b18b6bc-c8c6-442c-b560-d7f28af67e5c**, rodič **8d6054b3-be36-4024-aebd-28dac33fbe32**. Dvojklik vytvořil jednoho rodiče a dvě podzakázky. Po dokončené odpovědi, reloadu a novém potvrzení shodného obsahu UI zobrazilo „Zakázka již existuje. Další jsme nevytvořili.“ DB potvrdila root=1, children=2, dva aliasy operace a accepted nabídku. Cena byla 0, kontakt bez e-mailu a žádný e-mail se neodeslal. Demo nabídka a strom zůstávají jako testovací evidence.

Doklad: persistent Codex Security artefakt artifacts/quota-pause-20261019.json pro tuto pracovní kopii; doplňkový screenshot C:/Users/semis/AppData/Local/Temp/diriqo-core-quote-paused-20261019.png. Checkpoint při pozastavení správně zaznamenává tehdy rozběhnuté main verify; stav SUCCESS byl doověřen až 21. 10. Toto dokumentační přehodnocení neopakuje aplikační, hosted ani UI testy. Lokální kontrola dokumentů 21. 10.: platformní kontrakty 18/18 PASS, git diff --check PASS; všech 73 unikátních ID a původní texty zachovány, ostatních 72 záznamů proti HEAD beze změny.

## Hranice důkazů

Reload následoval po úspěšně dokončené odpovědi. Skutečná ztráta odpovědi v prohlížeči nebyla vyvolaná; zůstává samostatnou širší UX kontrolou, nikoli dodatečnou branou původního C01-02. Kontrakt také nepřidává očekávanou revizi pro potvrzení nabídky, jejíž obsah mezitím změnila jiná karta. Historické neúplné převody se neopravují odhadem.

Advisors po migraci přidaly pouze dvě očekávané informační položky RLS bez policies pro privátní registry s odebranými právy; jiné kategorie zůstaly stejné. To není celkový bezpečnostní audit produktu ani důkaz platebního původu licence.

## Skutečný souběh a uzavření přístupů, 19. 10.

Dvě nezávislé Auth relace provedly dva ověřené souběhy v testovacím projektu. PostgreSQL pozoroval oba skutečné čekající backendy za zámkem stejné firmy; zámek ihned uvolnil rollback testovací podtransakce. Časové limity rolí se neměnily.

- První kolo: PID 746469 / 746473 za bariérou 746472, 09:28:03.004384 UTC. Dvě HTTP 200, právě jeden created=true a jeden replay, stejný rodič 8a041141-9c3b-425a-ab49-20d20cbbf063 a přesně dvě podzakázky. Cena, měna, termíny, vazby i původní obsah nabídky ověřeny.
- Druhé kolo: PID 746529 / 746530 za bariérou 746531, 09:33:11.937709 UTC. Původní požadavek HTTP 200 / created=false; změněný obsah HTTP 409 / PT409. Úplný snapshot před/po konfliktu totožný.
- První pokus o pozorování druhého kola nestihl bariéru. Neúspěch zůstává uložený. Pokračování použilo stejnou operaci nad již existující zakázkou, ověřilo otisk dokončeného prvního kola a přihlásilo dvě čerstvé relace. Nevytvářelo další nabídku ani zakázku.
- Testovací firma 588f3293-610b-4cfe-996b-1e14a5231f9b zůstává s auditními důkazy; 0 aktivních členství, profil neaktivní, grant revokovaný, moduly vypnuté, účet zablokovaný, 0 Auth sessions. Soukromý rollout zůstává zachovaný, aby neobnovil legacy přístup. Původních 39 zakázek a 3 nabídky ostatních firem mají shodné otisky podle původního algoritmu.

Řízené artefakty: artifacts/core-quote-concurrency-complete-20261019.json, SHA-256 5094b0ad90d2117bd61e3ba7d03f9346708e9c5e768fadf5f2b6a04428d9d453; samostatný preservation report zachycuje původní hashovací algoritmus. Následný přihlášený webový průchod je doložen v akceptačním checkpointu výše; neobsahuje skutečně ztracenou UI odpověď.
