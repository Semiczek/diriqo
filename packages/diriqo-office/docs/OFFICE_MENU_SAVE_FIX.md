# JSPD Office: menu a oprava ukládání — 12. 10. 2026

## Změna

PR: https://github.com/Semiczek/jspdhubhotovy/pull/19

Oprava `acdca335fd904979e82a4bec33ff8403935fe0b8`; aktualizace o souběžný main `ac37634e7c1d5daa797d0625928a065c43e3d203`.

PR #19 sloučen do `main` jako `f2ea87f3bb2a6782c3a8489380299a42be0b3cf8`. Git diff potvrzuje totožný obsah s otestovanou větví.

JSPD zobrazuje název Office a vlastní rozbalovací skupinu v hlavním menu. Pracovní plocha respektuje zapnutí modulu, Nastavení zachovává původní oprávnění superadmina. Odkazy z menu i vyhledávání zachovávají úplnou navigaci, která odděluje styly editoru od ostatních částí Hubu. Sdílený balíček a Diriqo se nemění.

Běžné události focus, pageshow, online a visibilitychange dříve ihned zneplatnily rozběhnuté operace. I při potvrzení stejné firmy pak klient zahodil úspěšnou serverovou odpověď. Nově pouze ověřují kontext. Výslovné oznámení změny firmy, offline, neúspěšné ověření nebo zjištěná změna účtu, firmy či role nadále zneplatní staré odpovědi. Každá serverová operace stále ověřuje původní firemní ID a oprávnění.

Chybová hláška před opravou tedy sama o sobě neznamená, že server předchozí dokument neuložil. Při opakování nejdříve zkontrolovat seznam dokumentů; rozpracovaný obsah před obnovením stránky zálohovat.

## Ověření

- Nový test skutečných callbacků OfficeClient: před opravou 6/12 PASS, po opravě 12/12 PASS (pět reprodukcí závodu a změna názvu).
- Stávající testy kontextu: 20/20 PASS.
- Menu, role, aktivní položky, vyhledávání a izolace navigace: 45/45 PASS.
- Celá místní sada: 1848 PASS, 7 SKIP, 0 FAIL. Na Windows spuštěna se stejnými parametry a relativními cestami, protože standardní runner překročil limit délky příkazové řádky.
- ESLint změněných souborů a kontrola licencí, závislostí a integrity Office PASS.
- Produkční build s izolovanou testovací databází PASS, opakován úspěšně i na finální revizi `ac37634e` po připojení nezávislé opravy OCR z mainu.
- 50/50 skutečných HTTP kontrol izolovaného stagingu PASS: role, dvě firmy, import/export, nezměněné originály, nesprávná firma, neoprávněný přístup, zpracování velkého sešitu.
- Chrome proti lokálnímu produkčnímu buildu a skutečné izolované databázi: přihlášení, skutečný výběr firmy, rozbalení Office a vstup do editoru, vytvoření dokumentu, změna obsahu, uložení a nové otevření v druhém panelu. Zachován text a revize 2.
- Chrome: změna na firmu B zablokovala původní panel A; hledání dokumentu A ve firmě B nic nevrátilo. Návrat do A obnovil připravený stav a zachoval dokument.

Staging používá pouze syntetická data a původně schválenou větev `amuhcvnvubsrvsfclqtg`. Nevznikla nová placená infrastruktura. Oprava nepotřebuje databázovou migraci.

## Doklady a meze

CI [audit-quality 38272298560](https://github.com/Semiczek/jspdhubhotovy/actions/runs/38272298560): všech 9/9 jobů SUCCESS. Web: 1863 PASS, 7 SKIP, 0 FAIL. Office databázové kontroly: 68 PASS. Android/PG job dokončen 15:57:05 UTC: Gradle build, lint a testy úspěšné, povinných 5 HTTP/PG ledger scénářů bez přeskočení, související POS PG sada 24/24 PASS. Celkový počet všech Android unit testů log neuvádí. Office dependency guard 38272298561 také SUCCESS.

Místní logy: `reports/hub-office-focus-before.log`, `reports/hub-office-focus-after.log`, `reports/hub-office-context-regression.log`, `integrations/hub/reports/office-menu-save-tests.log`, `reports/staging-hub-host-http.json`.

Screenshot opětovně otevřeného uloženého dokumentu: `reports/hub-office-save-staging-20261012.jpg`.

Produkční nasazení `dpl_BMb4Nidd5yNc1SxkQ57aXYKUmueB` má stav READY, alias `hub.jspd.cz` a zdroj přesně `f2ea87f3bb2a6782c3a8489380299a42be0b3cf8`. Bez změn proměnných prostředí, databáze nebo nastavení projektu.

Uživatel výslovně povolil jeden produkční dokument „Test uložení Office – 12.10.2026“ ve firmě JSPD Holding s.r.o. Po nasazení byl v Chrome vytvořen, naplněn testovacím textem, uložen a znovu otevřen v druhém panelu. Nové načtení ze serveru zachovalo přesný text i revizi 2; stav „Všechny změny uloženy“. Produkční rozbalovací menu Office zobrazuje Pracovní plochu a pro oprávněného uživatele Nastavení. Kontrolovaný panel neměl žádné zachycené konzolové chyby ani varování. Testovací dokument zůstal uživateli otevřený.

Produkční screenshoty: `reports/hub-office-save-production-20261012.jpg` (znovu otevřený uložený dokument), `reports/hub-office-menu-production-20261012.jpg` (rozbalené menu). Tento skutečný produkční průchod doplňuje izolované testy; nepředstavuje test všech produkčních firem ani fyzické pokladny. Kód pokladny se opravou neměnil a její automatické regresní kontroly výše prošly.

Vrácení změny: revert opravy Office přes nový commit; nezahazovat souběžné změny OCR a nepřepisovat historii mainu. Data dokumentů se touto opravou ani jejím revertem nemigrují.
