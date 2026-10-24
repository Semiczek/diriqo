# Základní nabídky: neměnné verze a atomické operace

Datum: 22. 10. 2026. Rozpracovaný blok C05 navazuje na vydané atomické kalkulace PR #39. Databázová část je migrovaná a ověřená na testovacím Supabase; vydání aplikace a provozní ověření se evidují samostatně. Celý původní cíl není dokončený.

## Chování

Vytvoření nabídky z konkrétní revize kalkulace, synchronizace a uložení konceptu zapisují hlavičku i všechny položky v jedné transakci. Výslovná nulová zákaznická cena zůstává zákaznickou položkou; interní náklady, marže a poznámky se do zákaznických výstupů nedostanou. Databáze počítá desetinné součty, slevu a cenový režim. Neznámé historické DPH se automaticky nedoplňuje.

Publikace zachová neměnnou verzi s identitou, cenami, podmínkami a vlastním odkazem. Další úpravy vyžadují otevření nového konceptu; odkaz na A nikdy neukazuje B. Přijetí má vlastní čas, aktéra a důkaz, zájem zákazníka není přijetím. Převod na zakázku vyžaduje konkrétní přijatou verzi a opakování nevytvoří další zakázku. Původní C01 potvrzení lze pouze obnovit.

PDF vykresluje všechny položky a dlouhé texty přes více stran, včetně české diakritiky, měny, podmínek a identity vybrané verze. Čtení historie a export nezávisí na oprávnění k novým placeným zápisům. Staré nabídky jsou výslovně označené jako historický obsah zachycený při migraci; nevymýšlí se datum jejich původního vydání ani chybějící částky.

Odeslání nabídky nejprve rezervuje jedinou operaci. Opakovaný nebo nejistý požadavek neposílá další e-mail. Portálové i zaměstnanecké požadavky porovnávají očekávaného aktéra se současným přihlášením. Veřejný formulář validuje údaje před uložením rozpracované operace, aby neplatný telefon nezablokoval opravu.

## Dosavadní ověření

- Celá aplikační sada: 2 420 / 2 420 testů, 82 souborů PASS.
- TypeScript a produkční build: PASS, 107 / 107 generovaných stránek.
- ESLint: 0 chyb, 3 původní varování.
- Office: 62 PASS, 1 volitelný SKIP kvůli rozdílu připnutého PGlite 0.5.8 a dostupného 0.5.9. Platformní kontrakty: 18 PASS.
- Finální lokální SQL: 115 scénářů + 5 kontrol úklidu po rollbacku + 21 kontrol migrace neprázdné databáze PASS. Schéma používá skutečný generovaný součet položky. Hostovaná sada: stejných 115 scénářů + 5 kontrol úklidu po rollbacku PASS.
- Nezávislé kontroly: legacy revize, claim po smazání nevydaného konceptu, ochrana změny přihlášení, skutečné NULL částky a zobrazení verzovaných reakcí. Nálezy opravené a zahrnuté v uvedených společných lokálních kontrolách.
- Syntetické PDF s 73 položkami: 11 stran, všechny položky zachované, dlouhý popis pokračuje na další straně, podmínky i závěrečná poznámka zachované; kontrola textových okrajů bez přetékajících znaků. Vizuálně ověřené vybrané strany včetně dlouhého řádku, součtů a podmínek. Není to výstup skutečného zákazníka.
- Skutečný Auth/HTTP souběh: všech 5 scénářů PASS (`create-retry`, `update-race`, `publish-retry`, `delivery-retry`, `conversion-retry`). Každý doložený skutečným čekáním podle owner `pg_locks` na přesné `ctid` a konečnými počty v privátních evidencích operací. Žádný skutečný e-mail ani jiné volání e-mailového poskytovatele se při testování neprovedlo.

## Hostovaná databáze a bezpečný postup vydání

Pouze testovací projekt `wfcpfraxiuhuglnuaxqj`, nikdy Hub. Před změnou je uložený scoped logický snapshot šesti nabídek, tří položek, dvou C01 potvrzení, všech dotčených definic a aktuálních advisors:

- `artifacts/quotes/lifecycle-preflight-backup-20261021.json`, SHA-256 `567c0bf8b53182b352b8abaaef36b378fb4caa710398d3f9e3073554da6daebe`.
- Doplněk tří původních conversion requests, jejich metadat a fingerprintů: `artifacts/quotes/lifecycle-preflight-supplement-20261021.json`, SHA-256 `338153f10eceb870a31692411697490bc215ae71c00604a56cbbcc4d5822d706`.

Jde o scoped logickou zálohu, nikoli úplný PITR backup. Před migrací je poslední hostovaná verze `20261021075759`. Původních 45 zakázek a 10 zákazníků se při tomto bloku nemění. Nové sloupce u jobs, quotes a conversion receipts se při porovnání původních obchodních hodnot odečtou; nelze přímo porovnat celý `to_jsonb` před a po DDL.

Dne 22. 10. 2026 byly na testovacím projektu aplikovány tři migrace s ověřenou shodou SQL těla (SHA-256 po normalizaci CRLF na LF):

- `20261022033222_atomic_core_quote_lifecycle.sql`: `e7707417e253ddc4ac9dd07b9fa1d67c148657fc2c334cdf0dd047394ef6802f`.
- `20261022052955_respect_generated_quote_item_totals.sql`: `cce58e3d77da7b0a4f31febd186f1065dbd354f6f94793da56bcb92543597d10`.
- `20261022053147_preserve_public_quote_response_retry.sql`: `66701745cae82862978e70a0fff48d73d4f06c0a77b8347c066d5a3ebb94c536`.

Hostovaný test odhalil skutečnou chybu `428C9`: `quote_items.total_price` je generovaný sloupec, zatímco původní lokální fixture chybně umožňovala přímý zápis. Samostatná navazující migrace odstranila zápis do tohoto sloupce a sčítá hodnoty vrácené databází. Původní aplikovaná migrace zůstala beze změny. Lokální regrese nejprve původní chybu reprodukuje a vrátí transakci zpět, poté ověřuje opravu včetně desetinného zaokrouhlení a slevy. Druhá navazující oprava dovolí opakovat stejnou veřejnou reakci i při změně HTTP metadat; zachovává první metadata a dál odmítá změnu obsahu nebo identifikátoru návštěvníka. Konečná hostovaná rollback sada prošla 115 + 5 kontrolami. Porovnání původních projekcí se zálohou potvrdilo zachování všech 6 nabídek, 3 položek, 2 C01 potvrzení a 3 záznamů požadavků; počty 45 zakázek, 10 zákazníků a 20 událostí zůstaly stejné. Lokální sada 115 + 5 + 21 PASS ani hostovaná rollback sada samy nedokládají HTTP souběh; ten je samostatně doložen níže. CI, nasazení a přihlášený uživatelský průchod zatím tento checkpoint nedokládá.

Skutečné hostované souběhy jsou doložené v `artifacts/quotes/lifecycle-hosted-concurrency-20261022.json`, SHA-256 `bbfad13a3936ef7eafadc2d46952bcf2c3713c954d31e6730efe7e2664e9cc60`. Všech pět scénářů používá samostatné přihlášené HTTP požadavky; důkaz obsahuje databázové čekání a výsledné počty potvrzení, verzí, rezervací a převodů, nikoli pouze úspěšné HTTP odpovědi.

Po dokončení bylo odhlášeno všech 10 testovacích relací; konečný počet `auth.sessions` je 0. Syntetický profil je neaktivní, jeho členství i granty mají počet 0, účet je blokovaný a heslo bylo změněno. Otisky všech 7 původních obchodních oblastí zůstaly shodné; nové syntetické identifikátory jsou z tohoto porovnání výslovně vyňaté. Přesné původní nabídky, položky a potvrzení operací zůstaly zachované. Tento důkaz nevydává žádnou novou akceptaci C05 ani P16 a nedokládá doručení skutečného e-mailu.

Při problému zachovat immutable verze, rozhodnutí, rezervace a potvrzení; nepovolovat starému klientovi přímé zápisy. Návrat aplikace bez kompatibilních databázových zápisů není bezpečný rollback. Opravit dopředně nebo cíleně obnovit ze scoped zálohy jen po ověření, že nevznikla nová uživatelská data.

## Akceptační hranice

Původní matice zatím zůstává 5 HOTOVO / 49 ČÁSTEČNĚ / 3 CHYBA / 11 CHYBÍ / 5 NEOVĚŘENO. C05, P16 a navazující celý obchodní proces se tímto checkpointem neuzavírají; podmínkou zůstává přihlášené ověření příslušných průchodů v nasazené aplikaci. Ostatní části původního zadání, odložené UX a export faktury zůstávají v cíli.

## Dokončení vydání a akceptace 24. 10. 2026

Výše uvedené neuzavřené hranice a počty popisují historický checkpoint 22. 10. Následná PR #40–42 jsou sloučená a nasazená: `3ed450a2d349cc65e03a5791fcc20abb340611f1`, deployment `dpl_HrdJJEanAPhsSCWqNdh7DhWNhaNf`. CI 40072843882 má 2449/84 PASS, Office 62 PASS + 1 podmíněný SKIP, build 107 stránek, lint 0 chyb / 3 existující varování.

[Živá akceptace C05](core-c05-live-acceptance-release.md) doložila Core-only ruční materiál a PDF 100 + 0 Kč, 427 portálových HTTP/DTO a 17 revokačních kontrol, zachovanou přijatou A 100 Kč po vydání B 250 Kč a zakázku z A. Veřejné PDF A před/po B a konverzi je byte-identické; portálové a veřejné PDF mají odlišný rozsah identity a navzájem se za byte-identické nevydávají. C05-01/02/03 jsou HOTOVO, aktuální matice 8 / 46 / 3 / 11 / 5 v pořadí HOTOVO / ČÁSTEČNĚ / CHYBA / CHYBÍ / NEOVĚŘENO. P16, Smart Quotes a celý produkt zůstávají otevřené.

Privátní manifest: `artifacts/quotes/c05-live-acceptance-20261024.json`, SHA-256 `07caf3fbc90df38b5bef0aa78656786a085c8f0f2a541990fc14e67b90f8be6a`. Tento doplněk přehodnocuje uložené důkazy bez nového běhu testů.
