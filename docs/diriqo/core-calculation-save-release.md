# Atomické ukládání kalkulace

Datum: 21. 10. 2026. Stav: rozpracovaná oprava CREATE + UPDATE; databázová migrace aplikovaná do testovacího projektu, odpovídající aplikace zatím nenasazená.

## Problém a výsledné chování

Živý formulář odmítal kalkulaci kvůli chybějícím sloupcům. Původní DAL navíc zapisoval hlavičku, položky a historii odděleně. Pouhé doplnění sloupců by umožnilo neúplné dokumenty při chybě dalšího zápisu.

Nové vytvoření i editace používají jedinou ověřenou databázovou transakci. Editace pod očekávanou revizí nejprve zachová přesný předchozí obsah v historii. Konflikt dvou editací nepoškodí stávající dokument. Opakování stejné operace vrací původní výsledek; jiné údaje se stejným potvrzením jsou konflikt. Chybějící výsledek se automaticky neobnovuje.

Součty určuje databáze z desetinných vstupů. Výslovná nulová zákaznická cena a interní materiál za 1 Kč zůstanou dvěma řádky s marží -1 Kč. Prázdná částka není nula, neplatný vyplněný řádek se nevynechá. Formulář používá stejnou přesnou aritmetiku a zachovává požadavek při nejisté odpovědi či reloadu.

## Oprávnění a historie

- Stejná pravidla pro vytvoření i editaci: aktuální Auth, aktivní profil a členství, company_admin/super_admin, existující core.quotes.create. Nezavádí závislost na placeném skladu, fakturaci, POS nebo AI.
- Přímé neatomické tabulkové zápisy jsou uzavřené. RLS čtení interních nákladů a verzí je omezené na oprávněné správce; čtení historie zůstává dostupné i bez současné licence.
- Historický neznámý typ nebo DPH zůstane NULL. Měna se při úpravě automaticky nepřevádí. Snapshot verze obsahuje původní hlavičku a identitu původních položek.
- UI pending je vázané na firmu, profil a zákazníka nebo konkrétní kalkulaci. Po potvrzeném uložení se před navigací znovu ověří aktivní firma.

## Evidence před migrací

Testovací projekt pouze wfcpfraxiuhuglnuaxqj. Čerstvý preflight: všechny čtyři kalkulační tabulky mají 0 řádků; běžná obchodní data existují a nesmějí se měnit. Metadata sloupců, přesnosti, FK, ACL a RLS jsou soukromě uložená v artifacts/calculations/atomic-save-preflight-20261021.json, SHA-256 0171fec98c7a525391f658fe61a92ea5e8948d144335782195c387dec7961b70.

Snapshot dotčených řádků a konfigurace, včetně původních advisors: artifacts/calculations/atomic-save-preflight-backup-20261021.json, SHA-256 49641a8ecdb10865d0ac0f77eedb9c8064e1da1481f49700ade4862123da13fc. Jde o scoped logický snapshot prázdných kalkulačních tabulek a jejich konfigurace, nikoli tvrzení o úplném PITR backupu celého projektu.

Původní obchodní fingerprinty a Auth předpoklady jsou v artifacts/calculations/original-business-fingerprints-20261021.json, SHA-256 979c43c384e7f59badb428e07d1681ceaf2660caf164ce5380d30ba517150703. Pozdější Auth souběh použil vlastní označenou syntetickou firmu. Původní data byla po testech ověřena proti těmto fingerprintům beze změny.

## Ověření a vydání

Průběžný stav, před uzavřením PR aktualizovat podle skutečných výsledků:

| Vrstva | Stav |
|---|---|
| Serverové akce | 21 cílených testů PASS; jeden RPC, scope, revize, safe errors, nejistý retry |
| Sdílený kontrakt a DAL | 125 cílených testů PASS |
| Formulář a obnovení požadavku | 27 testů PASS; včetně zachování revize původně načtených hodnot při refreshi |
| SQL | Lokálně 104 scénářů + 5 rollback cleanup + 5 kontrol zachování migrace PASS; 13 lokálních paid scénářů + 2 cleanup. Hosted A/B: 85 scénářů + 10 cleanup PASS. Zbývajících 19 hosted kontrol licence a late-failure rollbacku není potvrzeno: konektor vrací invalid_request_state. |
| Typy, úplné testy, build | Finální Vitest 2106/2106 v 76 souborech PASS, včetně 47 regresí důkazu souběhu; celý ESLint 0 chyb / 3 původní navigation warnings; diff check PASS; Next build včetně TypeScript a 107/107 stránek PASS nad nezměněným aplikačním kódem |
| Hosted migrace a SQL | Migrace aplikovaná, přesné tělo ověřené a verze historie sjednocená na 20261021075759. A/B PASS; C včetně menších částí a DDL nástroje nedostal platnou odpověď. Ověřeno žádné běžící testy, dočasné funkce/triggery, testovací firmy ani verification migration z těchto neúspěšných požadavků. |
| Skutečný souběh | 4/4 skutečné Auth/HTTP scénáře PASS: create retry, create conflict, update retry, update race. Doložené přesné pg_locks klíče a blokovací řetěz dvou aktivních RPC. U editace úplný preimage a právě jedna nová revize. |
| Nasazení a přihlášené UI | Neprovedeno |

CLI vytvořila migraci 20261021075759_atomic_core_calculation_save.sql (Git/LF SHA-256 d45a62d1cce5e15d2867482973815e3ac431f9ce3fb666670d7e7bd9ca22570f; původní lokální raw SHA-256 DEECDFD117CC27362AE762AB4F6EC09F212AFC7A78810951D89BD3196E013F89). Je aplikovaná pouze do určeného testovacího projektu. Provider původně zaznamenal verzi 20261021081812; po záloze záznamu a přesném porovnání SQL byla verze transakčně sjednocená se souborem, tělo migrace beze změny. Záloha historie: artifacts/calculations/applied-migration-history-before-alignment-20261021.json, SHA-256 6335de215598dee60f12dd334c3bcca38b8f1359025c9bc0c88e3dabfa91e915. Kontrola po migraci: artifacts/calculations/applied-migration-postcheck-20261021.json, SHA-256 c9856aa7ef17fb6cdb639e5729d19b90e34d87be27be3fbe86f9b199da292a4d. Po prvním kratším SQL pokusu jsou všechny původní obchodní fingerprinty beze změny, kalkulace a syntetické firmy mají 0 záznamů. Zbývajících 19 hosted kontrol SQL je stále nutné dokončit. Skutečný Auth/HTTP souběh byl následně dokončen. Odpovídající aplikace musí následovat; staré formuláře nesmějí obejít RPC. Souběh používá dvě skutečné Auth relace, přesné operační zámky v pg_locks a pozorovaný řetěz čekajících backendů. Databázové pořadí se vyhodnocuje v serverových hodinách, HTTP překryv v místních monotónních hodinách; domény hodin se neporovnávají a mapování Auth session na PID se netvrdí. Všechny relace byly odhlášeny a syntetické přístupy deaktivovány.

Při problému uchovat nové sloupce, historii i receipt a opravit kompatibilní cestu. Návrat k původnímu neatomickému klientu není obnovená funkčnost; nepovolovat kvůli němu přímé zápisy, nemažte dokumenty ani auditní historii.

## Hosted souběh a zachování původních dat

Evidence: artifacts/calculations/real-auth-concurrency-20261021.json, SHA-256 a36dad9cd9d23e3fbf5704c4f5cd8dd440c752b6a84474e618adc7e5322f44ca. Create retry: 200/200, jeden dokument a původní receipt; create conflict: 409/200; update retry: 200/200, jediná revize 2; update race: 200/409, jediná revize 2. Obě editace zachovaly přesnou původní hlavičku i položky v historii. Každý scénář používá jednorázové run/operation IDs; existující výstup nebo claim odmítne před Auth. První v1 pokus vytvořil správně jediný dokument, ale jeho měření nebylo uzavřené kvůli zápisu důkazu do chráněné složky a porovnávání nesynchronních hodin. Tento pokus není vykázaný jako PASS a nebyl opakován se stejnou operací.

Úklid a původní data: artifacts/calculations/concurrency-cleanup-original-data-20261021.json, SHA-256 79d5b8b59437a41b7814c110c85c6880ef9727f1833fc79901e3b28a635b159f. Účet zakázán, heslo otočeno, relace odvolané; 0 aktivních členství/grantů/relací. Zachováno 5 syntetických kalkulací, 2 verze a 5 receipts jako auditní důkaz. Původní fingerprinty zakázek, nabídek, zákazníků, firem, profilů a členství jsou shodné.

Hosted A/B evidence: artifacts/calculations/hosted-atomic-save-chunks-ab-20261021.json, SHA-256 7b573784b7387fd4b7e37d18a5740762ba20acfad1ff74b09c54eebf565bc36c. Zdroj SQL má raw SHA 29b5c78c3c8690d1623fcf35eb2eb8c68b059e4213c5a527091266baee2fe4cd; přenositelný canonical LF SHA je 8cca70b5b6e90aa4690c3064699e7408f878da8e51a1a751c2db77a06286f208. Exportér ověřuje normalizovaný hash a zachovává i raw hash, takže LF/CRLF checkout nemění pokrytí.

Před sloučením a nasazením zůstává dokončit hosted C (19 kontrol), následně CI přesného commitu a přihlášený UI průchod po vydání. Konektorovou chybu nelze vydávat za PASS; náhradní cesta přes SQL editor čeká na dokončení přihlášení uživatelem.

## Otevřené hranice

Tato oprava sama neuzavírá celý zákazník → kalkulace → nabídka → zakázka → faktura proces. Kalkulace → nabídka a synchronizace nabídky stále mají samostatné neatomické zapisovací cesty; jejich oprava a ochrana vydaného obsahu jsou další povinné kroky původního cíle. Současný převod filtruje nulové prodejní řádky, což není důkaz chyby atomického uložení ani dokončení bezplatné nabídky.

Původní akceptační matice zůstává 5 HOTOVO / 49 ČÁSTEČNĚ / 3 CHYBA / 11 CHYBÍ / 5 NEOVĚŘENO. Žádný celý scénář se tímto rozpracovaným blokem nově neuzavírá.
