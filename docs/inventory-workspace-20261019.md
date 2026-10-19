# Sklad Diriqo – pracovní prostor a nastavení (19. 10. 2026)

Aplikační kandidát je na větvi `codex/diriqo-office-inventory-workspace`, základ main `b0a6da013b`. **Nové UI zatím není nasazené a přihlášený průchod v prohlížeči čeká.** Přídavná skladová migrace už je aplikovaná výhradně v uživatelem určeném testovacím Diriqu `wfcpfraxiuhuglnuaxqj`. Zápisy do JSPD Hub nejsou součástí této změny.

## Co se mění

Sklad používá paletu Diriqo místo zeleného motivu. Má rozbalovací navigaci jednotlivých agend, výběr konkrétního skladu a vlastní pracovní prostor pro zásoby, doklady, objednávky, dodavatele, historii, rezervace, ocenění a nastavení. Z vybraného skladu jsou přímo dostupné akce Přijmout zboží, Vydat na zakázku a Převést mezi sklady. Volba skladu se přenáší v odkazech agendy.

Nastavení rozlišuje hlavní sklad, příruční sklad na zakázce, mobilní sklad a další sklad. Zákazník zadává název, umístění a poznámku; příruční sklad musí mít zakázku stejné firmy. U mobilního skladu je označení vozidla textové umístění, nikoli nová hardwarová nebo telematická integrace. Současné oprávnění dovoluje nejvýše **3 aktivní sklady na firmu a nejvýše 1 aktivní hlavní sklad**. Archivace zachová historii; odmítne se při zbývajících zásobách, aktivních rezervacích, rozpracovaných skladových dokladech nebo neuzavřených objednávkách.

Zápisy nastavení používají firemní oprávnění, kontrolu verze a společný registr idempotentních příkazů. Zůstává zachována existující účetní historie skladových pohybů/FIFO. Tato dávka nepřepisuje pohyby ani nemění jejich zaúčtování. Vyhledávání souvisejících položek a zakázek probíhá v autorizované firmě; předané company ID samo neopravňuje k přístupu.

## OCR a koncepty

Naskladnění z podkladu navazuje na existující OCR. Rozpoznané řádky se musí spárovat s položkami skladu; člověk ověřuje množství ve skladové jednotce a cenu bez DPH v Kč. Nejasné ceny se doplní ručně. Výsledek se ukládá jako koncept příjemky a zásobu změní až následné výslovné potvrzení dokladu. OCR není dokladem správnosti účetních údajů a nezapisuje automaticky skladové pohyby.

Příjem, výdej na zakázku a převod se připravují v samostatném formuláři pracovního prostoru. Ochrana neuloženého formuláře pokrývá explicitní odkazy, výběr skladu, vyhledávání, zavření formuláře a unload stránky. **Klientský návrat/vpřed historií prohlížeče (SPA browser back/forward) zatím chráněn není.** Tato ochrana také nepředstavuje offline synchronizaci. Skenery, fyzické tiskárny, váhy ani mobilní zařízení nebyly touto změnou nově integrovány nebo ověřeny.

## Migrace a ověření

Aplikovaná migrace: [20261019070028_inventory_warehouse_workspace.sql](../supabase/migrations/20261019070028_inventory_warehouse_workspace.sql), SHA-256 `0a8e53d729581b0b44dda571bc022104fe0d6ea3c6bd1e51f6190b4a7e54679d`.

Přidává atributy stávající entity skladu, vazbu na zakázku, indexy a autorizované RPC pro nastavení. Firemní a licenční kontrola se znovu provádí i po čekání na zámek. Přímé klientské zápisy do skladové tabulky nebyly povoleny; anonymní volání nového RPC také nebylo povoleno. Do existujících zákaznických skladů se při migraci automaticky nepřidávají nové obchodní záznamy.

Doložené hosted ověření nad testovacím projektem: **19 kontrol + 2 kontroly úklidu PASS**. Syntetické záznamy byly vráceny rollbackem; následné kontroly sledovaných trvalých testovacích řádků byly nulové. Kontrola oprávnění potvrdila `direct write = false` a `anon RPC = false`. Nejde o důkaz dokončeného přihlášeného pracovního procesu v novém UI ani o test všech historických skladových funkcí.

Soukromé důkazní artefakty obsahují cílenou zálohu před změnou se SHA-256 `9738b06e17a69dc3570ca5e24b356e1f99e1e3d6c71de3ba76c8b35343d88fd7` a záznam hosted ověření se SHA-256 `9f253a2f642b6a8f779b50eee159529a33e39a24b6bbe6fd272d270a56018274`. Jejich obsah není v Gitu. Cílená záloha není důkazem úplné obnovy celého produktu.

Finální hostitelská integrace prošla 1 740 Vitest testy / 66 soubory, kontrolou typů a webpack buildem 107 stránek; ESLint nemá chyby (čtyři zděděná varování navigace). Před prohlášením nového UI za nasazené je nutné doložit přesnou Git revizi, stav nasazení a přihlášený průchod výběr skladu → koncept → potvrzení → historie, včetně OCR kontroly a přepnutí firmy.

## Návrat aplikace

Ponechte přídavné schéma a vraťte předchozí aplikaci; staré rozhraní se stávajícími sloupci zůstává kompatibilní. Nemažte nové sloupce, sklady, historii ani původní doklady. Návrat nesmí přehrát či přepsat už aplikovanou migraci. Je třeba zachovat firemní/rolové/licenční kontroly a vědomě vyhodnotit nová data před případnou budoucí změnou schématu.
