# Společné uložení hlavičky a položek faktury — 12. 10. 2026

## Změna

Úprava konceptu dříve nejprve uložila hlavičku a součty a následně jednotlivé položky samostatnými požadavky. Selhání pozdějšího zápisu mohlo ponechat neúplnou změnu. Nová aplikační cesta volá jedinou databázovou transakci: buď se uloží celá faktura, nebo žádná její část.

Stejná transakční cesta obnovuje dodavatele z nastavení firmy. Přepočítá položky i hlavičku při změně režimu DPH, zachová ruční poznámku a metadata snapshotů. Při přechodu na plátce nevymýšlí nové sazby pro existující položky. Množství a jednotkové ceny vstupují jako desetinné řetězce; autoritativní zaokrouhlení probíhá v PostgreSQL numeric. Například 0,05 × 0,70 se zaokrouhlí na 0,04. Historické vydané doklady se nepřepočítávají.

Detail načítá hlavičku a položky v jednom databázovém snapshotu. Vrací i neprůhledný SHA-256 otisk úplného uloženého obsahu. Uložení, obnova dodavatele a první vystavení pod zámkem faktury porovnají tento otisk s načtenou verzí. Změna z jiné karty vede k řízenému konfliktu; neznámý výsledek spojení se automaticky neopakuje. Formulář při chybě zachová rozepsané hodnoty a nabídne načtení aktuálního stavu.

Server ověřuje přihlášení a aktivní firmu. Databáze znovu ověřuje aktuální oprávnění po získání zámku, licenci, stav konceptu, přesný seznam položek, povolená pole, data a číselné rozsahy. Nové funkce jsou SECURITY INVOKER; nevzniká nový privilegovaný zapisovač. Stávající RLS, tabulková oprávnění, ochrana vydané historie a staré RPC kontrakty zůstávají kompatibilní.

Vedlejší oprava čtení ekonomiky upřednostňuje kanonickou částku i tehdy, když je nulová. Staré pomocné sloupce tak nemohou vrátit tržbu, kterou úprava právě vynulovala. Databázové aliasy se odhadem nepřepisují.

## Rozsah důkazu

Ověřovaný cíl je výhradně Diriqo `wfcpfraxiuhuglnuaxqj`; JSPD Hub se nemění. Cílená záloha před změnou v 10:18:06 UTC obsahuje 18 relevantních definic funkcí, pět triggerů a seznam migrací. V té chvíli bylo 0 faktur a 0 položek. Jde o zálohu dotčeného rozhraní, nikoli o prověřenou obnovu celého produktu.

Migrace `20261012102910_atomic_invoice_draft_updates.sql` je aplikovaná v testovacím Diriqu. Lokální SQL soubor má SHA-256 `02DAC3454F47FE09DEAEFA3494868FC4C3FE70295D2959CA3CFD2D133CC8DFD8`. Nevytváří ani nemění obchodní řádky. Před aplikací existovala pouze samostatná syntetická souběhová fixture (jedna faktura, dvě položky).

| Ověření | Výsledek |
|---|---|
| Nové skutečné SQL testy `invoice-draft-updates.sql` | 77 kontrol + 9 kontrol úklidu PASS |
| Dosavadní skutečné SQL: tvorba, vystavení, vydaný obsah, mazání historie, unikátnost čísla | 223 kontrol + 35 kontrol úklidu PASS |
| Celkem skutečné SQL se zapnutými asercemi | **300 + 44 PASS**, všechny fixtures rollback |
| Aplikační unit testy včetně integrace aktuálního Office | **1075/1075 PASS**, 43 souborů |
| Kompatibilita Office | 11/11 release kontraktů a kontrola integrity balíčku PASS |
| Platformní kontrakty | 18/18 PASS |
| TypeScript a lint | PASS; po poslední změně dvou formulářových TSX znovu cílený lint a TypeScript PASS |
| Izolovaný PGlite smoke | 16/16 PASS; lokální stuby nenahrazují skutečné RLS |
| Nezávislá statická kontrola kandidáta | Bez potvrzeného blokujícího nálezu |

Nová SQL sada prokazuje i skutečné pozdní selhání: hlavička a první položka se uvnitř volání zapíší, existující ochrana vazby zakázky odmítne druhou položku a celé volání vrátí předchozí zápisy. Nejde jen o předběžně odmítnutý formulář. Dále se ověřuje mezifiremní přístup, role, odebrané oprávnění, vypršelý/odebraný modul, podvržená pole a identity, neplatná čísla a data, oba směry změny DPH a zastaralé vystavení. Aktuální revize se v kontrolní větvi vystaví; tato fixture také končí rollbackem.

Skript `scripts/test-invoice-draft-update-concurrency.mjs` provedl dvě skutečná Auth přihlášení a souběžné POST požadavky se stejnou revizí. V 10:34:11 UTC databázová bariéra PID 60740 pozorovala dvě aktivní PostgREST spojení `authenticator`: PID 60944 čekal na její transakci a PID 60708 na navazující zámek řádku. Po uvolnění uspěl A (HTTP 200), B skončil HTTP 400 / 23514 / `INVOICE_DRAFT_STALE`. Následná kontrola potvrdila úplnou vítěznou hlavičku, oba řádky, odpovídající součty a nezměněná zdrojová metadata. První testovací bariéra sledovala jen přímé blokování a tuto frontu nezachytila; její neúspěšný pokus se za důkaz souběhu nepovažuje.

Obě úspěšně testované Auth relace byly odhlášené. Syntetické řádky a účet jsou odstraněné, včetně výchozího Office nastavení a jeho technické události přidaných mezitím paralelním rolloutem do této testovací firmy. Žádný Office řádek jiné firmy se neměnil. Po úklidu: 0 faktur, 0 položek, pět původních směn; soukromý soubor s heslem neexistuje. Důkazy jsou ve spravované kolekci `artifacts/invoice-draft/`.

PR #18 je sloučený jako `561513311d9bd59f9227d9d5ce084038f17065be`. Na přesném merge prošlo CI `38238290076` i Office kontrola `38238290062`. Vercel `dpl_6tcoKvAapBf9UUYSdHeYDfpjdFg8` je READY a při ověření obsluhoval `app.diriqo.com` z tohoto commitu.

Přihlášený průchod v Diriqo Demo s.r.o. ověřil dvě současně otevřené karty syntetického konceptu. Karta A uložila poznámku a dvě položky s výsledkem 200,24 Kč bez DPH, 42,05 Kč DPH a 242,29 Kč celkem. Karta B byla odmítnutá jako zastaralá, zachovala vlastní poznámku i rozepsanou cenu 999,99 a nabídla porovnání/načtení aktuální faktury. Databázové čtení potvrdilo kompletní obsah A. Obnova dodavatele zachovala poznámku i součty; nové načtení stránky potvrdilo trvalé uložení. Během uložení i obnovy dodavatele byla společně zakázaná tlačítka uložení, obnovy dodavatele a vystavení. Test nic nevystavil, neexportoval ani neodeslal. Snímek a důkaz jsou ve spravované kolekci `artifacts/invoice-draft/atomic-deployed-ui-20261012.json`.

Tento průchod odhalil navazující chybu: neaktivní návrh e-mailu při obnovení serverového obsahu ponechával starou částku. Oprava obnovuje neaktivní e-mailový formulář podle revize. Po povolení editace e-mailu používá stabilní identitu, aby další obnovení stránky nepřepsalo ručně rozepsanou zprávu. Ověření tohoto následného nasazení má samostatný release důkaz.

Souběh editace a vystavení je zatím doložen pořadovými databázovými testy, nikoli dvěma současnými HTTP spojeními v obou pořadích. Advisors před a po změně neobsahují nový nález pro tyto funkce; starší systémová varování a souběžný rollout Office nejsou tímto fakturačním zásahem plošně auditovány.

## Hranice a návrat

Oprava uzavírá aplikační editaci konceptu a obnovu dodavatele v rámci P0-07. Úhrady, storna a celý účetní lifecycle zůstávají samostatnou prací. Nové RPC nevynucuje transakční součty pro libovolné ručně sestavené přímé zápisy do tabulek; původní tabulkové granty se zde neomezují. Obsahový otisk z takových zápisů zabrání zastaralému uložení přes novou cestu.

Migrace je aditivní a nepřepisuje obchodní řádky. Při opravě aplikace ponechat nové funkce i již existující ochrany historie a čísel. Návrat na starou aplikační verzi by obnovil původní neatomickou editaci, proto ji nelze považovat za bezpečné dlouhodobé řešení. Potvrzenou chybu řešit novou verzovanou opravnou migrací; aplikovaný soubor zpětně neupravovat.

Matice 73 scénářů se bez úplného akceptačního důkazu nemění. Tento dílčí zásah není tvrzením o komerční připravenosti celého Diriqa.
