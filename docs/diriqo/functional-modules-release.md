# Funkční moduly Diriqa — 11. 10. 2026

Tato dávka přidává skutečné pracovní agendy nad dosavadní autoritou licencí. Nové zápisy ověřují aktivní firmu, členství, roli, konkrétní schopnost a licenci v databázi. Výjimkou pro testování jsou výslovné nefinanční testovací granty; nejde o zaplacené předplatné.

## Dodané schopnosti

- Sklad: společný katalog položek a dodavatelů, objednávky a částečné příjmy, FIFO, výdeje na zakázky, převody, rezervace, inventury, přecenění a historie. Seznamy mají stránkování, vyhledávání a odděleně autorizovaný export.
- Vozidla: vozový park, přiřazení řidičů, jízdy se schválením, servis, soukromé doklady, přidělení nákladů zakázkám a CSV export.
- Chytré nabídky: šablony, knihovna položek, varianty, schválení nízké marže, neměnné vydané verze, zákaznický odkaz s omezeným obsahem, přijetí konkrétní verze a jednorázové založení zakázky administrátorem.
- DiriPOS: samostatná online webová pokladna bez závislosti na Core, licence konkrétní pokladny, pokladní a vedoucí, prodeje, účtenka pro tisk v prohlížeči, částečné vratky a hotovostní směny. Volitelné skladové propojení využívá tentýž katalog a FIFO zásobu. Vratka obnovuje původní spotřebované vrstvy.
- Diriqent: vlastní rozhovory v konkrétní firmě, kontext sestavený serverem podle aktuální role, návrh zakázky s potvrzením administrátorem, rezervace maximálního kreditu a vyúčtování skutečné spotřeby. Neznámý výsledek se znovu nespouští naslepo.
- OCR: jeden obrázek PNG/JPEG/WebP do 3 MB a přibližně 4 megapixelů. Používá schopnost příslušného modulu a samostatný AI kredit. Opravený výsledek nabídky lze převést na návrh nabídky. Výsledky skladových a fakturačních podkladů se kontrolují a exportují; samy nezaúčtují skladový pohyb ani fakturu.
- Ekonomika zakázky přičítá skladové a vozidlové náklady jednou přes databázový souhrn. Nemíchá plánovanou nabídku se skutečnými náklady.

## Ověření

- Celá lokální sada Vitest: 35 souborů, 879 úspěšných testů před závěrečnými úpravami navigace.
- Produkční sestavení, TypeScript a cílený ESLint prošly; při finálním vydání se ověřují znovu po posledních změnách.
- Databázové sady v autorizovaném testovacím Diriqu: Sklad 18 skupin, Vozidla 18 kontrol, Nabídky 21 skupin, samostatná POS sada, POS se skladem 16 skupin a Diriqent 36 kontrol. Syntetické záznamy se vždy vrátily rollbackem. Skripty jsou v `tests/*-integration.sql`.
- Skutečný OpenAI požadavek přes aplikační provider skončil strukturovanou odpovědí; použit byl pouze syntetický text. To samostatně neprokazuje přihlášený průchod celou aplikací.
- Diriqo Demo s.r.o. má existující testovací licence do 9. 11. 2026 a nově 100 Kč nefinančního testovacího AI kreditu se stejnou expirací.

## Nastavení a hranice vydání

- `OPENAI_API_KEY` je pouze serverová proměnná. Projekt OpenAI je samostatné Diriqo v organizaci JSPD Holding sro. Klíč je ignorovaný Gitem a ve Vercelu je označen sensitive. Vercel již obsahuje `SUPABASE_SERVICE_ROLE_KEY`; ten se nesmí dostat do klientského kódu.
- Historii a export řídí samostatné nároky po dobu retence. Pouhé oprávnění číst neodemkne export ani nové zápisy.
- AI ceník je výslovně testovací. Nákup kreditu ani automatické měsíční přidělování placeného kreditu tato dávka nezavádí.
- POS vyžaduje internet. Fyzický terminál, tiskárna, zásuvka, párování nativního zařízení a offline synchronizace nejsou touto dávkou doložené.
- PDF a vícestránkové OCR není podporované. Odesílání zákaznických nabídek e-mailem a automatické servisní připomínky nejsou aktivované.
- Souběžnost byla ověřena pravidly transakcí a opakováním příkazů, nikoli řízeným testem dvou současných databázových spojení.
- Přihlášené obrazovky se dle přání uživatele ověří po nasazení. Lokální testy ani samotný build nejsou důkazem nasazeného průchodu.

## Nasazení a návrat

SQL migrace této dávky jsou již aplikované v projektu `wfcpfraxiuhuglnuaxqj`, který uživatel označil celý za testovací. Lokální názvy migrací odpovídají skutečné vzdálené historii. Další opravy se přidávají novou migrací; již aplikované soubory se nepřepisují.

Při problému lze vrátit aplikaci na předchozí Vercel deployment. Nové tabulky a auditní záznamy se nemažou. Nové zápisy lze zastavit odvoláním příslušného testovacího grantu, při zachování výslovně schválené historie. SQL rollback obchodních událostí se nahrazuje doménovými opravami, například vratkou.
