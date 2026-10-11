# Diriqo — dokončení a komerční připravenost

Aktualizace 11. 10. 2026. Posuzovaná hlavní větev: `cd9291e3414891de7603ec79d1a219f200903993` (merge PR #9). Tento dokument nahrazuje staré souhrnné tvrzení o 69 neprovedených scénářích aktuálním rozlišením implementace a důkazů. Historické reporty z 10. 10. zůstávají platné pouze pro svůj uvedený rozsah a revizi.

Stav celého produktu: **není dosud doložená připravenost pro prvního komerčního zákazníka**. Existuje podstatně více funkční implementace než v reportu z 10. 10.; nové moduly, online Android vstupy, skutečné SQL kontroly a dílčí přihlášené průchody nejsou plnou akceptací všech pracovních procesů. Tento audit dokumentace sám nespustil živou DB, Stripe ani browser E2E. Stav nové P0 implementace a její aktuální výsledky se doplňuje do samostatného pracovního checkpointu níže; baseline matice se bez důkazu nepřepisuje na HOTOVO.

Identita: pouze `Semiczek/diriqo`, testovací Supabase `wfcpfraxiuhuglnuaxqj`, web `app.diriqo.com`. JSPD Hub `yrxfozthravgbbcqklzy` se neupravuje a jeho provozní data se nepřenášejí. Zachovat původní logo a paletu fialová/modrá/tyrkysová na bílých plochách.

## 1. Aktuální stav modulů

| Oblast | Stav implementace a doložená hranice |
|---|---|
| Core | Zakázky, zákazníci, pracovníci, kalkulace, základní nabídky, kalendář, absence, zálohy a ekonomika existují. Celý tok bez doplňků a po novém přihlášení není uzavřený. Historické snapshoty, některé atomické operace a předání vyžadují práci. |
| Platforma / licence | Oddělená platformní autorita, role firem, capability registry, nefinanční testovací granty, placené granty a audit plateb existují. Úplná matice všech starých core vstupů a komerční lifecycle nejsou uzavřené. |
| Sklad | Položky, dodavatelé, objednávky, částečné příjmy, FIFO, výdeje, převody, rezervace, inventury, přecenění, vyhledávání a export; dílčí reálné SQL v jedné relaci. Chybí úplný importní/supplier invoice tok a měření 20 000 položek. |
| Fakturace | Atomická tvorba, vystavení/číslo a smazání konceptu; snapshoty vydaných faktur a PDF. Úpravy, úhrady/storna, zálohové vyúčtování a POS vazba nejsou plně uzavřené. Žádná země se neoznačuje legislativně připravená. |
| Chytré nabídky | Šablony, knihovna, varianty, marže, vydané verze, veřejný odkaz, přijetí konkrétní verze a konverze správce. E-mail není aktivovaný. Základní core nabídky jsou samostatná starší cesta a nelze na ně přenést důkazy smart quotes. |
| Vozidla | Vozidla/řidiči, jízdy, schvalování, náklady a alokace, dokumenty a CSV. SQL kontroluje PHM bez dvojího započtení. Automatické upomínky a placené navýšení kapacity chybí. |
| DiriPOS | Online samostatný POS bez Core: katalog, konkrétní pokladna, role, směny, prodej, částečné vratky, tisk v prohlížeči a volitelné FIFO. Offline, fyzické tiskárny/zásuvky a terminálové transakce nejsou hotové. |
| Diriqent / OCR | Firemní soukromý chat, serverový kontext, potvrzený návrh zakázky, rezervace/settlement kreditu. OCR jednoho PNG/JPEG/WebP do 3 MB a cca 4 MP; opravený návrh nabídky, export ostatních výsledků. Nejde o univerzální agentní workflow ani PDF/DOCX/XLSX analýzu. |
| Android | My Diriqo a Diriqo Manager 0.1.0-test, online hybrid pro Android 8+. Emulátor a dílčí webové ověření jsou doložené; fyzický pracovní den, kamera a role worker/manager zůstávají pilot. |
| Editory / jazyky | V Diriqu jsou konkrétní kalkulační/nabídkové editory a XLSX exporty, nikoli hotový univerzální dokumentový/tabulkový editor. Aktivní lokalizace cs/en/de. Stav rozpracovaných editorů v dalších větvích/Hubu je nutné nejdříve inventarizovat. |

## 2. Kritické P0 chyby a blokující ověření

Konkrétní kódové vady se odlišují od neprovedeného testu. Následující vady byly ověřeny čtením baseline; u nich se netvrdí nová živá reprodukce ani již nasazená oprava.

| ID | Konkrétní problém | Dopad a další oprava |
|---|---|---|
| P0-01 | Start směny používá SELECT před INSERT bez atomického invariantu. | Dvě zařízení mohou založit souběžné směny. Baseline vada opravena migrací 20261011191250; 27+3 DB kontrol a souběh dvou spojení PASS. Aplikační release čeká. C04-01. |
| P0-02 | Záloha se označí paid před samostatným worker_advances upsertem. | Chyba druhého zápisu zanechá neúplný stav a běžný retry již odmítne. Atomická výplata a idempotentní ledger. C08-02. |
| P0-03 | Calendar update nemá očekávanou verzi; přidělení se maže a vkládá odděleně. | Tiché přepsání druhého vedoucího nebo ztráta přiřazení. Atomická změna s verzí. C06-03. |
| P0-04 | Core převod nabídky zapisuje rodiče a podzakázky odděleně; catch vrací nalezeného rodiče jako úspěch i po selhání potomků. | Neúplná vícedenní zakázka se tváří dokončeně. Samostatná transakční oprava core cesty; smart quote RPC je jiná implementace. C01-02. |
| P0-05 | Základní PDF nabídky načítá dnešní customers místo uloženého snapshotu. | Změna adresy změní pozdější export staré nabídky. Snapshot při vydání a regresní test. C02-02. |
| P0-06 | Ekonomika při absenci historické sazby bere dnešní profilovou sazbu; úplnou absenci převede na nulu. | Historie nákladů se může přepočítat a marže působí úplně bez sazby. Historické sazby a stav neúplnosti. C03-03/C10-02/P17. |
| P0-07 | Úprava konceptu zapisuje hlavičku/součty a položky samostatně; úhrada a storno obdobně oddělují fakturu od zakázek/vazeb. | Selhání mezi zápisy zanechá neúplný účetní stav. Rozšířit již existující atomickou tvorbu/vystavení o editaci, úhradu a storno s konfliktní verzí. |
| P0-08 | Legacy EUR webhook ukládá příchozí subscription objekt bez pořadového konfliktu; modulový handler potvrzuje neuhrazovací lifecycle události bez odpovídající změny nároku. | Opožděný legacy event může vrátit starý stav; nové moduly nemají dokončené refund/dispute/grace. Doložit kanonickou reconciliaci v sandboxu; neměnit cenu ani staré smlouvy odhadem. |
| P0-V1 | Úplné A/B endpoint, RPC, storage a role/revokace pokrytí chybí. | Je to blokující ověření, nikoli samo o sobě důkaz úniku. Provést matici s minimálně dvěma syntetickými firmami a skutečnými rolemi. |
| P0-V2 | Celý Core E2E, skutečný dvouspojový souběh a Stripe sandbox lifecycle nejsou uzavřené. | Neuvádět komerční připravenost; dokončit po cílených opravách. |

Bezpečnostní audit baseline je zatím částečný (68/677 souborů). Potvrzené nálezy: lib/mail/mailgun-signature.ts přijímá nepodepsaný požadavek bez klíče (oprava připravená zvlášť); app/api/customer-portal-users/route.ts umožňuje správci kontaktu měnit globální Auth email existujícího účtu (otevřená oprava). Samotná stará advisor varování se neoznačují automaticky za exploity.

Licenční audit již staticky potvrzuje: limit počtu pracovníků není aktuálně vynucený na zápisové hranici (starý trigger byl migrací odstraněn); fleet limit pěti vozidel naopak DB pod firemním zámkem vynucuje, chybí obchodní nákup další kapacity. POS částečné vratky a kumulativní zaokrouhlení existují a nemají se implementovat znovu. U vydaných faktur SQL guard ve zdrojové migraci chrání číslo/čas vydání, ale ne celý finanční a kontaktní snapshot; účinný živý trigger je nutné ověřit před označením živého exploitu.

## 3. Nedokončené funkce P1

- Fakturační lifecycle: atomická editace/snapshot refresh, částečné úhrady, zálohy/konečné doklady, opravné doklady a POS vazba; uchovat historický daňový režim.
- Core: zákaznická archivace, účinnost sazeb, revize času, auditované zrušení absence, více výplat zálohy, verzované předání a obnova rozepsané práce.
- Stripe sandbox: refund/dispute/grace/resume/cancel, audit nároků, pos-device nákup, AI kredit a kapacity. Skutečné ceny a live platby zůstávají mimo automatický rollout.
- Sklad/fleet: importní původ, dodavatelské doklady, reminder služba; úplná autorita dostupnosti bez nákupních cen.
- Diriqent 2.0: serverově autorizované nástroje, náhled diffu, potvrzení citlivých změn, idempotentní operace, resumable workflow a formáty dokumentů.
- Sdílené editorové jádro: nejdříve inventura existujících větví/komponent v Diriqu a pouze čtení referenčního Hubu. Žádná druhá paralelní implementace nebo sdílení živých dat/credentials.
- Android a POS: fyzický pilot obou rolí/aplikací, konektivita, kamera/dokumenty; POS finanční konzistence před integrací konkrétního hardware.

## 4. Budoucí rozšíření P2

- Slovenština, polština, turečtina, albánština a příprava RTL v centralizovaném i18n; jazyk nesmí měnit zemský daňový režim.
- Samoobslužný POS průvodce, diagnostika a jen skutečně podporovaný hardware; následně kiosk.
- Offline oprávnění/outbox/synchronizace jako samostatný testovatelný celek; žádný obchodní slib offline z nynější online verze.
- Obecné import/export workflow, rozsáhlé dokumentové agentní scénáře a další zemské režimy až po samostatné akceptaci.

## 5. Aktualizovaná matice 73 scénářů

**HOTOVO: 0 · ČÁSTEČNĚ: 49 · CHYBÍ: 12 · CHYBA: 7 · NEOVĚŘENO: 5.** Původních 30 core + 18 modulových + 25 platformních ID a texty jsou beze změny v [acceptance-scenarios.json](acceptance-scenarios.json). Manifest obsahuje pro každý řádek implementaci/soubory, bezpečnost, typ testů, datum zdrojového důkazu, E2E, komerční připravenost a chybějící kroky.

- HOTOVO = celý původní scénář má uzavřený relevantní důkaz; v tomto checkpointu žádný.
- ČÁSTEČNĚ = implementace nebo dílčí testy existují, úplný průchod chybí.
- CHYBÍ = konkrétní požadovaná část toku není implementovaná; neznamená neexistenci celého modulu.
- CHYBA = nalezená konkrétní vada aktuální implementace, nikoli absence testu.
- NEOVĚŘENO = bez dostatečného důkazu pro rozhodnutí o celém scénáři.

Sloupec důkaz odkazuje na zdrojové soubory a dřívější reporty v JSON. Přítomnost testovacího souboru neznamená, že byl tímto auditem spuštěn. Dílčí SQL není plný E2E a jedna SQL relace není souběh.

| ID | Scénář | Stav | Typ dostupného důkazu | Co přesně zbývá |
|---|---|---|---|---|
| C01-01 | Jádro bez doplňků | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Projít celé UI bez placených doplňků, znovu se přihlásit a ověřit uzavřenou zakázku. |
| C01-02 | Jednorázová konverze nabídky | CHYBA | Dřívější dílčí SQL; související unit/mock; kód | Atomizovat core rodiče/podzakázky/přijetí a otestovat retry po vložení rodiče i skutečný souběh. |
| C01-03 | Součet rodiče a podzakázek | NEOVĚŘENO | Dřívější dílčí SQL; související unit/mock; kód | Připravit částkovou fixture a ověřit 600 Kč bez změny při rozbalování. |
| C02-01 | Zahraniční zákazník a místa | ČÁSTEČNĚ | kód | Ověřit dvě místa stejného zahraničního zákazníka; rozhodnout samostatný adresář míst. Vyplněný zahraniční identifikátor dnes stále podléhá osmimístné validaci. |
| C02-02 | Historická adresa nabídky | CHYBA | související unit/mock; kód | Uložit kontaktní snapshot při vydání základní nabídky a používat jej v každém pozdějším exportu. Nové smart quotes tuto starou cestu nenahrazují. |
| C02-03 | Archivace zákazníka | CHYBÍ | kód | Doplnit archivaci zachovávající zakázky/dokumenty a vyloučení z výchozí nabídky nových prací. |
| C03-01 | Pracovník bez účtu | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Ověřit vedoucího, zápis času a pozdější propojení stejné osoby jedním přihlášeným tokem. |
| C03-02 | Role jedné osoby v A/B | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Přihlásit skutečné syntetické role manager A / worker B a ověřit finance, docházku i přepnutí. |
| C03-03 | Historie nákladových sazeb | CHYBA | Dřívější dílčí SQL; související unit/mock; kód | Zavést historický zdroj sazby a schválení bez odhadovaného přepočtu starých záznamů; regrese říjen/listopad. |
| C04-01 | Souběžný start směny | ČÁSTEČNĚ | 23 unit, 27 DB + 3 cleanup, skutečně překrytá Auth/RPC spojení | DB oprava aplikovaná; ověřit finální CI, webové nasazení a UI. Viz atomic-mobile-work-release.md. |
| C04-02 | Přesnoc a změna času | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Ověřit DST/přesnoc a explicitní přestávku, schválení i náklad ve firemní zóně. |
| C04-03 | Revize schváleného času | CHYBÍ | Dřívější dílčí SQL; související unit/mock; kód | Doplnit původní verzi, schválení revize a přesně jednu nákladovou korekci. |
| C05-01 | Ruční kalkulace a PDF | ČÁSTEČNĚ | související unit/mock; kód | Ověřit ruční materiál bez inventory nároku a skutečně stažené PDF z přihlášeného průchodu. |
| C05-02 | Zákaznický dokument bez marží | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Prověřit také všechny staré core PDF, portal a exportní odpovědi; E2E s nákladovou canary hodnotou. |
| C05-03 | Neměnná přijatá verze | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Sjednotit kontrakt základní nabídky bez vynucení placeného modulu a ověřit navazující zakázku. |
| C06-01 | Absence a plán | ČÁSTEČNĚ | kód | Doplnit nebo prokázat konflikt přidělení ihned po schválení, včetně načteného kalendáře. |
| C06-02 | Pracovník nesmí plánovat | ČÁSTEČNĚ | kód | Skutečným worker účtem ověřit Server Action, přímý REST a DB/RPC všech přesunů. |
| C06-03 | Konflikt přesunu | CHYBA | kód | Zavést optimistickou verzi a atomickou událost s přiřazeními; druhý vedoucí dostane řízený konflikt. |
| C07-01 | Místní data absence | NEOVĚŘENO | kód | Otestovat celé místní dny a DST v nejméně dvou firemních zónách bez posunu žádosti. |
| C07-02 | Konflikty a soukromí absence | ČÁSTEČNĚ | kód | Ověřit viditelnost důvodu absence, konfliktní směnu a výstupy worker/manager rolí. |
| C07-03 | Zrušení schválené absence | CHYBÍ | kód | Doplnit žádost/zrušení, historii a přepočet dostupnosti bez vytváření směn. |
| C08-01 | Částečné vyplacení zálohy | CHYBÍ | související unit/mock; kód | Doplnit oddělené požadované/schválené/vyplacené částky a platební ledger. |
| C08-02 | Retry výplaty | CHYBA | související unit/mock; kód | Atomická výplata a request ID; simulovat selhání mezi oběma zápisy i souběh. |
| C08-03 | Záloha není druhý náklad | ČÁSTEČNĚ | související unit/mock; kód | Ověřit přesný náklad zakázky a audit vypořádání po částečných výplatách. |
| C09-01 | Fotografie a předání | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Dokončit zahrnutí konkrétní fotky do verzovaného předání a pilot worker/manager. |
| C09-02 | Odvolání přístupu k souboru | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Skutečný A/B Storage test, odebrání přiřazení a změřená expirace již vydaného odkazu pro všechny přílohy. |
| C09-03 | Verzované předání | CHYBÍ | Dřívější dílčí SQL; související unit/mock; kód | Doplnit dokument/verze/schválení a zachování původního výstupu. |
| C10-01 | Plán a skutečnost zakázky | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | End-to-end bez skladu: schválená práce, ruční materiál, doprava, měna a oba souhrny. |
| C10-02 | Chybějící sazba | CHYBA | Dřívější dílčí SQL; související unit/mock; kód | Propagovat missing-rate stav do souhrnu a marže; regrese pracovníka bez sazby. |
| C10-03 | Jedinečný nákladový původ | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Otestovat sjednocené zdroje nákladů i výnosů při pozdějším dodavatelském dokladu. |
| M01-01 | Částečný příjem | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Doložit přihlášené UI a souběh dvou příjmů proti téže zbývající položce. |
| M01-02 | Přecenění FIFO | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Ověřit skutečný dodavatelský import/dopárování; současná ruční korekce ceny není celý fakturační import. |
| M01-03 | Dostupnost bez nákupních cen | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Doplnit/prokázat samostatné oprávnění dostupnosti bez ocenění a všechny RPC/export/retence cesty. |
| M02-01 | Opakované vystavení | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Doložit skutečně současné vydání přes dvě spojení a stejné číslo v obou odpovědích. |
| M02-02 | Zálohová a konečná faktura | CHYBÍ | Dřívější dílčí SQL; související unit/mock; kód | Implementovat 10 000 / 3 000 / 7 000 Kč včetně daňových dokladů a souhrnů bez druhého příjmu. |
| M02-03 | Faktura z POS | CHYBÍ | Dřívější dílčí SQL; související unit/mock; kód | Doplnit referenci původní platby, vydání podle role a ochranu opakovaného finančního/skladového účinku. |
| M03-01 | Přijetí přesné verze | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Skutečný zákaznický proklik a dvě současná potvrzení; automatický callback nesmí obcházet potvrzení správce. |
| M03-02 | Nabídka a OCR bez chatu | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Propojit důkazy UI pro AI vypnuto / kredit dostupný / kredit nulový, ruční práce stále dostupná. |
| M03-03 | Rezervace není náklad | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Doložit nabídku 5 000 Kč → rezervaci → nulovou skutečnost → výdej a zákaznický export v jednom toku. |
| M04-01 | Kapacita a cena vozidel | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Schválit období/proraci a realizovat sandbox nákup další kapacity; návrhovou cenu nevydávat za účtovanou. |
| M04-02 | Palivo pouze jednou | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Doložit celý UI průchod a správné vysvětlení metodiky v přehledu zakázky. |
| M04-03 | Alokace servisních nákladů | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Ověřit 2 000 → 1 000 + 1 000, retry importu a pokus řidiče přes server. |
| M05-01 | Samostatný POS | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Skutečný sandbox nákup POS a pozdější Core aktivace ve stejném tenantu v UI. |
| M05-02 | Offline prodej a synchronizace | CHYBÍ | Dřívější dílčí SQL; související unit/mock; kód | Doplnit trvalý lokální prodej, offline oprávnění, restart a přesně jednou idempotentní sync. |
| M05-03 | Neznámý výsledek terminálu | CHYBÍ | Dřívější dílčí SQL; související unit/mock; kód | Vybrat konkrétní terminál/API; platební reconciliation, refund a hardware pilot před tvrzením podpory. |
| M06-01 | AI a zakázaná mzda | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Adversariální dokument a skutečný provider E2E; ověřit všechny budoucí retrieval/citace/přílohy. |
| M06-02 | AI rezervace a retry | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Přesná fixture 15 Kč, ztráta odpovědi po provideru a dva současné požadavky. |
| M06-03 | AI vypnuto, OCR zachováno | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Ověřit přihlášené UI, časovou expiraci a odvolání oprávnění při otevřeném rozhovoru. |
| P01 | Úplná matice tenantů | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Projít každé API, action, RPC, Storage a hromadné operace se syntetickými rolemi A/B; převzít výsledky bezpečnostního auditu. |
| P02 | Více pracovních vztahů | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Ověřit pracovní vztahy a finance stejné osoby v A/B a odebrání pouze jednoho členství. |
| P03 | Licence všemi vstupy | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Kompletní matice URL/API/RPC/AI/import/export pro nikdy aktivní a expirovanou firmu; core legacy cesty zvlášť. |
| P04 | POS a rozšíření na Core | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Dokončit placenou sandbox aktivaci a navázání Core nad stejnými zákazníky bez duplicit. |
| P05 | Revokace za běhu | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Otevřený formulář, stale token, odvolání modulu a další krok rozpracované úlohy ve skutečném E2E. |
| P06 | Cizí soubor a export | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Skutečné A/B Storage, PDF, QR, pohoda, fleet a AI soubory včetně TTL a odebraného členství. |
| P07 | Zpožděná odpověď A/B | NEOVĚŘENO | Dřívější dílčí SQL; související unit/mock; kód | Zpomalit odpověď A, přepnout na B, ověřit všechny klientské seznamy a cache klíče. |
| P08 | Prompt injection | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Adversariální OCR/retrieval průchod s canary firmy B a redigovanou stopou; budoucí nástroje zvlášť. |
| P09 | Souběžný AI kredit | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Dvě současné DB relace na poslední kredit a pád po reálném provider výsledku; bezpečná reconciliace unknown. |
| P10 | Duplicity platebních událostí | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Skutečný Stripe sandbox webhook lifecycle, dvě transakce a placené přidělení AI kreditu. |
| P11 | Expirace a historie | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Kompletní grace/refund/dispute/cancel/resume lifecycle, test času a retenční export všech modulů. |
| P12 | Jazyk, země a čas | ČÁSTEČNĚ | související unit/mock; kód | Změna jazyka s neměnným historickým dokladem, dvě různé zóny; žádná legislativní akceptace země zatím. |
| P13 | Čistá instalace | NEOVĚŘENO | související unit/mock; kód | Prokázat bootstrap/migrační řetězec a manifest bez tajných údajů či dat Hubu. |
| P14 | Obnovitelný import | CHYBÍ | kód | Doplnit importní kontrakt, idempotenci dávky, vadné řádky a řízený pád/restart. |
| P15 | Zachování Hubu a firmy B | ČÁSTEČNĚ | související unit/mock; kód | Doložit aktuální diff, snímky B a ověřený návrat pro každou novou DB změnu; Hub se neupravuje. |
| P16 | Celý core tok po přihlášení | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Dokončit chybějící díly a E2E od registrace po znovunačtení bez doplňků. |
| P17 | Historie a finanční souhrny | CHYBA | Dřívější dílčí SQL; související unit/mock; kód | Opravit snapshot sazeb a doložit rodič/podzakázky/dodavatelské ocenění v jednom částkovém scénáři. |
| P18 | POS události a vratky | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Skutečný souběh vratek a UI ztraceného potvrzení; fyzický tisk je samostatná hranice. |
| P19 | Offline práva a settlement | CHYBÍ | Dřívější dílčí SQL; související unit/mock; kód | Doplnit konec offline oprávnění, restart, pozdní sync po expiraci a revokaci. |
| P20 | OCR zachová opravu | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Ověřit editaci/retry/ztrátu odpovědi a řízený převod do příjemky s jedním pohybem. |
| P21 | Kapacity a historické ceny | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Dokončit nákup kapacit, jednotné počítání osob a doložené zachování starých EUR smluv v sandboxu. |
| P22 | 20 000 položek | NEOVĚŘENO | Dřívější dílčí SQL; související unit/mock; kód | Syntetická zátěž s úplnými počty/součty, filtrem/exportem, prostředím a dobou běhu. |
| P23 | Selhání navazující služby | ČÁSTEČNĚ | Dřívější dílčí SQL; související unit/mock; kód | Vynutit chybu po commitu prodeje/faktury, e-mail/tisk/projekci a ověřit opravu bez opakování obchodu. |
| P24 | Obnova skladové evidence | CHYBÍ | Dřívější dílčí SQL; související unit/mock; kód | Doplnit stav evidence, zákaz tvrzení aktuálního zůstatku a auditovanou inventuru/reconciliation. |
| P25 | Pravdivé a reprodukovatelné předání | ČÁSTEČNĚ | související unit/mock; kód | Aktualizovat hlavní odkaz na tuto matici, potvrdit capability katalog a čistou instalaci; obchodní go-live zatím nesplněn. |

## 6. Přesné soubory a oblasti změn

| Oblast | Cílové soubory |
|---|---|
| Směny | `app/moje-prace/actions.ts`, `app/mobile/my/finish/*`, nová verzovaná migrace, `tests/mobile-worker-actions.test.ts`, nové SQL/souběžné testy. |
| Výplaty záloh / kalendář | `app/advance-requests/actions.ts`, `app/calendar/actions.ts`, odpovídající nové RPC/migrace a rollback fixtures. |
| Core nabídky a konverze | `lib/dal/flow.ts`, `lib/dal/quotes.ts`, `app/api/quotes/[quoteId]/pdf/route.ts`, `app/api/offers/[token]/pdf/route.ts`. |
| Historická ekonomika | `lib/dal/economics.ts`, `lib/economics.ts`, `lib/labor-calculation.ts`, pracovní editační cesty a zobrazení marže. |
| Fakturace | `lib/dal/invoices.ts`, `lib/dal/invoice-drafts.ts`, `app/invoices/actions.ts`, invoice API/exporty, další forward-only migrace. |
| Licence / Stripe | `lib/platform/*`, `lib/module-access.ts`, `app/api/billing/modules/*`, `app/api/stripe/webhook/route.ts`, placené granty/rollout registry. |
| Tenant / storage / AI | `lib/server-guards.ts`, `lib/active-company.ts`, `proxy.ts`, všechny API/actions, `app/api/job-photos/*`, `lib/diriqent/*`, Storage policy/RPC. |
| Důkazy | `docs/diriqo/acceptance-scenarios.json`, tento dokument, `supabase/tests/*`, `tests/*-integration.sql`, nové datované evidence. |

Již aplikované migrace se neopravují zpětně. Před novou DB změnou uvést ověřený projekt, schéma, zálohovací bod, dopad a nepoškozující návrat. Neimportovat Hub data ani nepřehrávat historický bootstrap do existující DB.

## 7. Výsledky skutečně provedených testů

### Předchozí doložené checkpointy (ne nové běhy tohoto auditu)

| Datum / zdroj | Příkaz nebo testovací vstup | Skutečný rozsah a výsledek |
|---|---|---|
| 10. 10., [acceptance-report.md](acceptance-report.md) a [DB evidence](evidence/module-operation-20261010.json) | `npm test` / Vitest; `supabase/tests/*.sql` | 664 aplikačních testů, 361 DB asercí + 23 kontrol úklidu PASS. SQL v testovacím Diriqu, rollback fixtures; ne celý E2E. Jde o starší revizi. |
| 11. 10., [functional-modules-release.md](functional-modules-release.md) | `tests/inventory-integration.sql`, `fleet-integration.sql`, `smart-quotes-integration.sql`, `pos-integration.sql`, `pos-stock-integration.sql`, `diriqent-integration.sql` | Reportuje 18 inventory skupin, 18 fleet kontrol, 21 smart quote skupin, POS sadu, 16 POS-stock skupin a 36 AI kontrol PASS. Jedna relace/rollback; ne skutečný souběh. |
| 11. 10., [android-test-release.md](android-test-release.md) | Vitest, TypeScript, cílený ESLint; Android Gradle/JVM/instrumentace | Reportuje 930 Vitest testů ve 39 souborech, TypeScript a lint PASS; obě APK build/lint/signature, 14 JVM běhů a 2/2 instrumentační testy na variantu. Fyzický telefon tím prokázaný není. |
| 11. 10., [android-test-release.md](android-test-release.md) | `tests/mobile-runtime-grants-verification.sql` | PASS skutečných sloupcových grantů a čtení jako service_role. Mocky předtím runtime grant chybu neodhalily. |

Předchozí relace dále doložila CI a Vercel pro PR #9 a přihlášené Demo webové obrazovky / syntetický upload. Tyto důkazy se mají při přiložení přesného release checkpointu propojit; nejsou zde vydávány za nově provedené testy. Veškeré aktuální nově spuštěné příkazy a výsledky doplní implementační checkpoint, včetně rozdílu mezi lokálním stavem, Git/CI, DB migrací a nasazenou aplikací.

### Pracovní checkpoint tohoto bloku

- Provedeno: čtení požadované dokumentace, statické ověření relevantních implementací/testů, zachování všech 73 scénářů a aktualizace matice.
- Celá lokální sada po obou opravách: **994/994 Vitest v 40 souborech PASS**, celý ESLint a TypeScript PASS. Výsledek zahrnuje i oddělený Mailgun fix; čistý CI build ještě čeká.
- Lokálně provedeno 11. 10. 2026: `node --test --test-isolation=none tests/platform-foundation.test.mjs` — **18/18 PASS**, včetně hash původní specifikace, 73 unikátních ID a rozdělení 30/18/25. Tento test neověřuje pravdivost celé akceptace. Předchozí pokus s běžnou izolací skončil prostředím `spawn EPERM`; in-process běh prošel. Odkazované zdrojové/testovací cesty z manifestu byly ověřeny jako existující.
- P0 směny: 23 unit + 27 DB asercí a 3 cleanup kontroly PASS; skutečný Auth/RPC souběh dvou DB spojení potvrdil jeden časovač. Migrace 20261011191250 je v testovacím Diriqu; webová verze ještě čeká na release. Podrobný [report směn](atomic-mobile-work-release.md).
- Částečný bezpečnostní scan baseline cd9291e dokončen: 68/677 plně čtených souborů, 2 doložené nálezy (Mailgun fail-open a změna globální Auth identity přes portálový kontakt). Zbývajících 609 cest je explicitně otevřených; nejde o hotový bezpečnostní audit celého produktu.
- Mailgun fail-open: izolovaná oprava připravená lokálně; před opravou 11 regresních selhání, po opravě 48/48 Mailgun testů + 57 sousedních platebních testů PASS. Nezávislý review PASS. Živé doručování netestováno.
- Živá metadata potvrdila širší členovské SELECT policies a přístup authenticated k sazbě work_shifts.hourly_rate; úplné rolové RLS ověření a omezení jsou otevřený P0.
- Netvrzeno: kompletní A/B endpoint matice, Stripe sandbox lifecycle, fyzický telefon ani komerční připravenost. Provedené dílčí DB/Auth/RPC běhy jsou výslovně uvedené výše.

## 8. Pořadí dalších implementačních etap

1. Zafixovat auditovanou revizi, aktivní nasazení, migrační historii a bezpečný testovací/zálohovací bod. Přidat konkrétní bezpečnostní nálezy.
2. Samostatný P0 celek směn: atomický start, přístup rolí, retry a dvě současná spojení. Regresní test, nový migrační soubor a malé PR.
3. Samostatné P0 celky: výplaty záloh, kalendářní konflikt, core konverze a historické snapshoty/sazby. Nepřepisovat fungující moduly kvůli stylu.
4. Dokončit A/B bezpečnostní matici a Core E2E bez doplňků; opravovat selhání v oddělených ověřitelných PR.
5. Fakturační transakce a Stripe sandbox lifecycle/retence/kapacity; právní/daňové předpoklady doložit pro konkrétní podporovanou zemi.
6. Uzavřít sklad/fleet/smart quotes procesy a 20 000 položek; fyzický Android pilot.
7. Inventura editorů, společné jádro a Diriqent 2.0. Oddělit serverovou autoritu nástrojů od modelových návrhů.
8. POS offline/hardware/setup, lokalizace a další země jako samostatné doložené etapy.

## 9. Rizika a nevyřešená rozhodnutí

- Živá DB vznikala i historickými patchi; samotný seznam migrací neprokazuje čistou reprodukovatelnost. Potřebný je schema diff a čistá instalace.
- Nové moduly mají pevnější transakční RPC než některé starší core cesty. Nezaměňovat jejich důkazy ani neopravovat pouze nové UI.
- Testovací klasifikace Diriqa není povolení mazat existující firmy/data. Fixtures musí mít vlastní identitu a kontrolovaný úklid.
- Obchodně potvrdit ceny, účinnost, proraci, retenci a staré EUR předplatné před veřejnou nabídkou; návrhový katalog není ostrý ceník.
- Pro daňové režimy, terminály, tiskárny, offline rozsah a skutečné telefony potřebujeme konkrétní akceptační prostředí. Chybějící fyzický důkaz se nenahrazuje emulátorem.
- Editorové rozpracované větve nejprve dohledat. Hub zůstává pouze referencí bez zápisů a bez přenosu identity, dat či klíčů.
- Před potenciálně škodlivou produkční DB změnou, skutečnou platbou nebo zveřejněním cen připravit konkrétní bezpečný postup a získat požadované schválení.

## 10. Kritéria prvního komerčního nasazení

- Žádná otevřená P0 vada ve zvoleném prodávaném rozsahu; všechny tenant/role/module cesty mají aktuální negativní i pozitivní testy.
- Úspěšný nový zákazník: registrace, firma, země/jazyk, plán, aktivace po ověřené sandbox platbě, pozvánka, první zakázka/prodej, odhlášení/přihlášení a zachovaná data bez zásahu vývojáře.
- Core end-to-end bez doplňků, fakturační snapshoty a korektní částkové souhrny; žádná chybějící sazba vydávaná za nulovou.
- Reálně současné transakce pro směny, invoice issue/create, výplaty, sklad, webhook/AI a POS vratky mají doložený jediný účinek nebo řízený konflikt.
- Expirace/cancel/refund/grace a obnovení respektují audit a uchování historie; live Stripe ani ceník se nepovolují samotným zeleným buildem.
- TypeScript, lint, relevantní unit/integration/SQL/E2E a čistý build odpovídají stejnému schvalovanému commitu; známá omezení a přesné nasazení jsou uvedené.
- Ověřená záloha/obnova a forward-compatible návrat aplikace zachovají nové obchodní události. Prodává se jen capability katalog, který prošel akceptací.
- Fyzický Android/POS pilot je podmínkou příslušných mobilních/hardwarových tvrzení; nepodporované funkce se nenabízejí jako dokončené.
