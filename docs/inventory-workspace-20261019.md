# Sklad Diriqo – pracovní prostor a nastavení (19. 10. 2026)

[PR #31](https://github.com/Semiczek/diriqo/pull/31) byl nejprve sloučen jako `9463f39efc0a7c91f3e1fb19d9d0ff17dfc3558f` a nasazen deploymentem `dpl_5h5G652JEcS3f7FhBkwwmdT9C2rG` ve stavu READY. Následný [PR #32](https://github.com/Semiczek/diriqo/pull/32) opravuje připínání Office navigace; ověřená main revize tohoto průchodu je **`4016d1112fd9bcf1d18ce415de0ef4b299df2b89`**, READY deployment **`dpl_4bb8VGcvb5mjBKkC96n2AVYKuPZe`** na [app.diriqo.com](https://app.diriqo.com). Nový pracovní prostor byl přihlášeně ověřen v **Diriqo Demo s.r.o.** v níže vymezeném rozsahu. Přídavná skladová migrace je aplikovaná výhradně v uživatelem určeném testovacím Diriqu `wfcpfraxiuhuglnuaxqj`. Zápisy do JSPD Hub nejsou součástí této změny.

## Co se mění

Sklad používá paletu Diriqo místo zeleného motivu. Má rozbalovací navigaci jednotlivých agend, výběr konkrétního skladu a vlastní pracovní prostor pro zásoby, doklady, objednávky, dodavatele, historii, rezervace, ocenění a nastavení. Z vybraného skladu jsou přímo dostupné akce Přijmout zboží, Vydat na zakázku a Převést mezi sklady. Volba skladu se přenáší v odkazech agendy.

Nastavení rozlišuje hlavní sklad, příruční sklad na zakázce, mobilní sklad a další sklad. Zákazník zadává název, umístění a poznámku; příruční sklad musí mít zakázku stejné firmy. U mobilního skladu je označení vozidla textové umístění, nikoli nová hardwarová nebo telematická integrace. Současné oprávnění dovoluje nejvýše **3 aktivní sklady na firmu a nejvýše 1 aktivní hlavní sklad**. Archivace zachová historii; odmítne se při zbývajících zásobách, aktivních rezervacích, rozpracovaných skladových dokladech nebo neuzavřených objednávkách.

Zápisy nastavení používají firemní oprávnění, kontrolu verze a společný registr idempotentních příkazů. Zůstává zachována existující účetní historie skladových pohybů/FIFO. Tato dávka nepřepisuje pohyby ani nemění jejich zaúčtování. Vyhledávání souvisejících položek a zakázek probíhá v autorizované firmě; předané company ID samo neopravňuje k přístupu.

## OCR a koncepty

Naskladnění z podkladu navazuje na existující OCR. Rozpoznané řádky se musí spárovat s položkami skladu; člověk ověřuje množství ve skladové jednotce a cenu bez DPH v Kč. Nejasné ceny se doplní ručně. Výsledek se ukládá jako koncept příjemky a zásobu změní až následné výslovné potvrzení dokladu. OCR není dokladem správnosti účetních údajů a nezapisuje automaticky skladové pohyby.

Příjem, výdej na zakázku a převod se připravují v samostatném formuláři pracovního prostoru. Implementovaná ochrana neuloženého formuláře podle lokálních kontraktových testů pokrývá explicitní odkazy, výběr skladu, vyhledávání, zavření formuláře a unload stránky. Živá cancel cesta zůstává neověřená, jak je uvedeno níže. **Klientský návrat/vpřed historií prohlížeče (SPA browser back/forward) zatím chráněn není.** Tato ochrana také nepředstavuje offline synchronizaci. Skenery, fyzické tiskárny, váhy ani mobilní zařízení nebyly touto změnou nově integrovány nebo ověřeny.

## Migrace a ověření

Aplikovaná migrace: [20261019070028_inventory_warehouse_workspace.sql](../supabase/migrations/20261019070028_inventory_warehouse_workspace.sql), SHA-256 `0a8e53d729581b0b44dda571bc022104fe0d6ea3c6bd1e51f6190b4a7e54679d`.

Přidává atributy stávající entity skladu, vazbu na zakázku, indexy a autorizované RPC pro nastavení. Firemní a licenční kontrola se znovu provádí i po čekání na zámek. Přímé klientské zápisy do skladové tabulky nebyly povoleny; anonymní volání nového RPC také nebylo povoleno. Do existujících zákaznických skladů se při migraci automaticky nepřidávají nové obchodní záznamy.

Doložené hosted ověření nad testovacím projektem: **19 kontrol + 2 kontroly úklidu PASS**. Syntetické záznamy byly vráceny rollbackem; následné kontroly sledovaných trvalých testovacích řádků byly nulové. Kontrola oprávnění potvrdila `direct write = false` a `anon RPC = false`. Tento databázový důkaz je oddělený od přihlášeného průchodu popsaného níže; nedokládá všechny historické skladové funkce.

Soukromé důkazní artefakty obsahují cílenou zálohu před změnou se SHA-256 `9738b06e17a69dc3570ca5e24b356e1f99e1e3d6c71de3ba76c8b35343d88fd7` a záznam hosted ověření se SHA-256 `9f253a2f642b6a8f779b50eee159529a33e39a24b6bbe6fd272d270a56018274`. Jejich obsah není v Gitu. Cílená záloha není důkazem úplné obnovy celého produktu.

Finální hostitelská integrace prošla 1 740 Vitest testy / 66 soubory, kontrolou typů a webpack buildem 107 stránek; ESLint nemá chyby (čtyři zděděná varování navigace). Čerstvé GitHub kontroly PR #31 nad head `c39f425cb70120b8f24ef24b4fe797aaf44b78a1` prošly včetně shody zdroje a runtime. Nasazenou main revizi a deployment určuje úvod tohoto reportu.

## Přihlášený průchod v Diriqo Demo s.r.o.

Všechny níže uvedené záznamy byly označené jako testovací; nevznikly skutečné finanční doklady. Uvedený skutečný provozní náklad testu je spotřeba OCR kreditu 0,45 Kč.

- V UI byl vytvořen hlavní a mobilní sklad a následně třetí, příruční sklad přiřazený existující zakázce „Audit regresní“.
- Příjemka na 2 jednotky po 1 Kč bez DPH byla připravena a následně výslovně potvrzena.
- Převod 1 jednotky z hlavního do mobilního skladu prošel.
- Výdej 1 jednotky z hlavního skladu na existující zakázku „Audit regresní“ prošel. Výsledný stav tohoto průchodu byl správně hlavní sklad 0 a mobilní sklad 1.
- Následný výslovně potvrzený úklidový výdej snížil zbývající testovací zásobu tohoto průchodu na 0.
- Živé OCR syntetického PNG uspělo s nákladem 0,45 Kč při stropu 5 Kč. Po ručním spárování položky, zadání ceny 1 Kč bez DPH a potvrzení kontroly vznikl koncept příjemky. Samostatné výslovné potvrzení poté provedlo příjem na sklad. OCR samotné pohyb nepotvrdilo.

Dodatečná jednotka přijatá přes OCR byla samostatně výslovně vydána při úklidu. Všech šest testovacích skladových dokladů je potvrzených a zůstává v historii. Před archivací položky byl v mobilním skladu ověřen stav 0 ks / 0 Kč; nulový stav hlavního skladu byl potvrzen dříve. Všechny tři syntetické sklady byly archivované běžným UI a lze je obnovit; archivovaná je také položka `TEST-UI-20261019`. Úklid nepoužil další přímé databázové mutace a nesmazal pohybovou historii. Pět FNOL importů zůstává záměrně v Demo firmě.

Živý pokus o cancel cestu dirty guardu na neuloženém syntetickém formuláři skončil timeoutem CDP; automatizace neměla dostupné ovládání dialogu (`dialog handle undefined`). Cancel cesta proto **není živě prokázaná** a tento výsledek sám neprokazuje chybu aplikace. V agentově kartě může zůstat jeden neodeslaný formulář.

Není doloženo přihlášené ověření jiných rolí, přepnutí firmy v prohlížeči ani mobilní průchod. SPA návrat/vpřed bez dirty guardu a neověřený hardware zůstávají výše uvedenými omezeními. Živý průchod nepotvrzuje všechny objednávkové, rezervační, inventurní a oceňovací scénáře.

Po nasazení PR #32 bylo živě ověřeno rozbalení Office nabídky kliknutím, zachování připnutí po přesunu fokusu do vyhledávání, sbalení druhým kliknutím a sbalení klávesou Escape s návratem fokusu. Office runtime balíček ani jeho obsahové hashe se touto opravou nezměnily.

## Návrat aplikace

Ponechte přídavné schéma a vraťte předchozí aplikaci; staré rozhraní se stávajícími sloupci zůstává kompatibilní. Nemažte nové sloupce, sklady, historii ani původní doklady. Návrat nesmí přehrát či přepsat už aplikovanou migraci. Je třeba zachovat firemní/rolové/licenční kontroly a vědomě vyhodnotit nová data před případnou budoucí změnou schématu.
