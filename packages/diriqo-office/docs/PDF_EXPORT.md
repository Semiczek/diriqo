# Stažitelný PDF export

`exportOfficeFile(content, title, 'pdf')` synchronně vrací `application/pdf`, název, Base64 a konkrétní varování. Používá stejnou autorizovanou exportní cestu jako DOCX: host ověří aktuální firmu, oprávnění a modul, načte dokument a eviduje export. Nevzniká externí síťový požadavek ani změna originálu. Tisk prohlížeče zůstává samostatnou možností.

## Nativní tisk z editoru

Tlačítko Tisk nejprve dokončí rozepsanou úpravu a uložení, ověří oprávnění přes export `print` a teprve po úspěchu otevře `window.print()`. Chyba uložení nebo autorizace tiskovou akci tlačítka zastaví. Prohlížeč však vždy dovoluje tisk již zobrazené stránky vlastní nabídkou; není to mechanismus odvolání přístupu k již přečtenému obsahu.

Tiskový CSS ponechává papír v normálním toku a skrývá celé vedlejší větve hostitelského UI pomocí `display:none`, aby navigace nezanechávala prázdné místo. Resetuje flex/výšky/scrollování pouze na předcích právě otevřeného Office papíru. Používá `:has` (Chrome/Edge 105+, Firefox 121+, Safari 15.4+). Mimo otevřený dokument hostitelskou stránku neskrývá. Tiptap výběry a úchyty sloupců se netisknou. Tabulky dostanou šířku stránky a rovnoměrné základní sloupce, vysoké obrázky se vejdou do 190 mm při zachování poměru stran.

Nativní tisk používá lokální systémové fonty a vlastní sazbu prohlížeče. Hlavička a patička editoru jsou pouze na začátku/konci obsahu, neopakují se jako u stažitelného PDF. Prohlížeč může přidat své URL/datum/číslování podle tiskového nastavení. Řádky tabulky dovolují přirozené dělení, aby nadměrná buňka neodsouvala obsah a nevytvářela téměř prázdnou stránku; náhled tisku je nutné zkontrolovat.

Skutečné tiskové CSS bylo vykresleno instalovaným Chrome v izolovaném headless profilu nad vlastním HTML s odpovídající strukturou editoru a flex/scroll předky hostitele. Krátký dokument, šestistránkový dokument s dlouhou tabulkou a 50mm okraje prošly nezávislým čtením PDF, kontrolou znaků/okrajů a vizuální kontrolou všech PNG. Stejný obsah byl porovnán se serverovým PDF (jiná sazba a počet stran jsou očekávané). Postup a přesná hranice důkazu jsou v [NATIVE_PRINT_VALIDATION.md](NATIVE_PRINT_VALIDATION.md): jde o skutečný lokální render tiskového CSS, nikoli ověření nativního dialogu, jeho uživatelských voleb ani fyzické tiskárny.

## Podporovaná podmnožina

- A4, okraje 5–50 mm, automatické zalamování odstavců a dlouhých slov, ruční konce stránek.
- Nadpisy, jednoduché seznamy, odsazení, levé/středové/pravé zarovnání, velikost 6–48 pt, barva `#RRGGBB`, podtržení a přeškrtnutí. Tučné a kurzíva jsou syntetické zvýraznění pravidelného fontu, výslovně uvedené ve varování.
- Jednoduché tabulky s rovnoměrnými základními šířkami, vodorovným sloučením buněk a pokračováním dlouhé buňky na další stránce. Svislé sloučení se odmítne s nabídkou použít DOCX. Záhlaví tabulky se automaticky neopakuje; uložené šířky sloupců jsou zjednodušené.
- Hlavička a patička nejvýše po třech řádcích se opakují na každé stránce. Export přidává číslo stránky a celkový počet. Editor nadále zobrazuje souvislou A4 pracovní plochu, nikoliv náhled totožné sazby.
- Nezměněný vložený Geist Regular 1.800 s českou diakritikou a znakem Kč/€. PDF nepotřebuje font nainstalovaný na zařízení příjemce. Text se normalizuje do NFC.

Obrázky se nahrazují viditelným alternativním textem a upozorněním. Fonty vybrané v editoru nahrazuje Geist. Odkazy zůstávají textem bez aktivní PDF akce. Zvýraznění, subscript/superscript, vnořené struktury tabulek a další nepodporované styly se zjednodušují s varováním. Znaky chybějící ve fontu dostanou viditelný zápis `[U+XXXX]`; nejsou tiše odstraněny. Složitá typografie, obousměrné písmo, přesná Word sazba, PDF/A, digitální podpisy a tagované přístupné PDF nejsou implementované. PDF import ani obecná editace cizího PDF nejsou součástí exportéru.

## Meze a implementace

Vlastní kód `src/server/pdf.ts` zapisuje omezený PDF 1.4 pomocí objektů, přesných byte offsetů, Type0/Identity-H fontu, CIDToGIDMap a ToUnicode. Text se zapisuje jako hexadecimální CID, nikoliv vložená PDF syntaxe. Neobsahuje akce, JavaScript, formuláře, přílohy ani načítání externích zdrojů. Zdrojem návrhu jsou veřejná [specifikace PDF](https://opensource.adobe.com/dc-acrobat-sdk-docs/standards/pdfstandards/pdf/PDF32000_2008.pdf) a OpenType [cmap](https://learn.microsoft.com/en-us/typography/opentype/spec/cmap)/[hmtx](https://learn.microsoft.com/en-us/typography/opentype/spec/hmtx); implementace knihoven nebyly přebírány.

Export odmítne více než 100 000 znaků, 20 000 uzlů, hloubku 32, 200 stránek, 5 000 buněk nebo 16 sloupců tabulky. Kontroluje konečné číselné hodnoty a minimální šířku textového prostoru. Příliš těsné řádkování rozšíří s upozorněním. Nejde o neomezený renderovací systém; chybu limitu musí UI zobrazit a ponechat dokument uložený.

Font a celý OFL se distribuují v `licenses/assets/`; PDF uchovává úplný OFL a copyright také v čitelném metadatovém poli `FontLicense`; stejné nezměněné fontové bajty jsou vložené do serverového modulu. Za běhu se nečte font z cesty na disku. Licence, zdroje a SHA-256 jsou v `ASSET_LICENSES.md` a CycloneDX SBOM. `license:check` ověřuje i asset a vložená data. `scripts/prepare-pdf-font.mjs` umí přegenerovat vložená data pouze z připnutých schválených bajtů. Nový npm balíček nebyl přidán.

`pdf-lib@1.17.1`, jeho fontkit a jsPDF byly odmítnuty kvůli konkrétním licencím pako1/2; celý graf PDFKit nebyl schválen a nebyl instalován. Nepřisuzujeme PDFKit prokázanou zakázanou licenci. Podrobná a ohraničená evidence je v `licenses/pdf-candidates.json`. `--refresh-reports` smí pouze přegenerovat licenční reporty z již ověřené, beze změny znovu zkontrolované evidence; změnu npm grafu nadále vyžaduje ověřit pomocí `--verify-tarballs` před instalací.

## Důkaz a opakování

Automatické `tests/pdf.test.mjs` ověřují CID/Unicode, skutečné xref offsety, integritu OFL/fontu, neměnnost vstupu, determinismus, meze, dlouhá slova/buňky a ochranu proti vložení PDF akcí. `scripts/pdf-demo.mjs` vytváří syntetický český čtyřstránkový dokument v `output/pdf/`.

```sh
node --experimental-strip-types scripts/pdf-demo.mjs
# Již dostupné nástroje; tento postup nic neinstaluje:
python scripts/verify-pdf.py output/pdf/diriqo-office-czech.pdf
pdftoppm -r 85 -png output/pdf/diriqo-office-czech.pdf output/pdf/page
```

Existující pypdf 6.10.0 načetl skutečný výstup v přísném režimu a ověřil všechny české texty, 150 opakování v dlouhé buňce, celé dlouhé slovo, hlavičky/patičky/čísla všech čtyř stran, hash vloženého fontu a absenci aktivních objektů. Existující Poppler vykreslil všechny čtyři stránky; byly vizuálně zkontrolovány bez ořezu textu a překryvu patičky. Tyto externí testovací nástroje nejsou instalované ani distribuované jako závislost Office. Strojový doklad je `output/pdf/independent-validation.json`; PNG a původní PDF jsou vedle něj. Toto dokládá lokální skutečný PDF export, nikoliv fyzickou tiskárnu či veřejný hosting.
