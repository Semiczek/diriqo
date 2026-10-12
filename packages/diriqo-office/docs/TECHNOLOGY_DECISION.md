# Technologické rozhodnutí

Dodatečná kontrola výpočtů doplnila vlastní omezenou analýzu závislostí před spuštěním OSS parseru: cykly, nadměrné oblasti a dynamické funkce jsou blokovány. Hashovaný build transform také opravuje zápis při přepočtu neaktivního listu a omezuje velikost výsledků. Nejde o převzetí proprietární funkce; jde o vlastní ochranný kód nad zdrojem MIT. Původní notices jsou zachovány.

Kontrola konkrétních archivů a zdrojů: 11. 10. 2026. Přesné verze a licenční doklady uvádí `THIRD_PARTY_LICENSES.md`, `LICENSE_AUDIT.md`, `licenses/evidence.json` a `sbom.cdx.json`.

## Vybraná sestava

- **Tiptap Open Source 3.31.4**: React integrace, ProseMirror schéma, transakce a příkazy dovolují vlastní UI i autorizované návrhy AI. Používáme pouze otevřená rozšíření. Žádný Tiptap Cloud, Pro ani placené stránkování. [Oficiální zdroj](https://github.com/ueberdosis/tiptap).
- **FortuneSheet Core/React 1.0.4**: skutečný spreadsheet s výběrem oblastí, vzorci, více listy a kancelářským UI. Adaptér převádí výslovně podporovaná data do vlastního kanonického modelu. Tři dynamické konstruktory Function pro vkládání řádků nahrazuje náš kontrolovaný build transform běžnými operacemi nad polem. Hash zdroje i počet nahrazení jsou pevně ověřené; změna verze vyžaduje nové posouzení. Výpočetní parser vzorců tyto konstruktory nepoužívá. [Přesný zdroj](https://github.com/ruilisi/fortune-sheet/tree/94346608877db4747406707a177c4b8f3bacdbf9).
- **fflate 0.8.3, fast-xml-parser 5.11.2, htmlparser2 12.0.0 a sanitize-html 2.18.0**: vlastní konverzní adaptéry pro podporovanou podmnožinu OOXML a bezpečné HTML. Žádné proprietární konvertory. PDF má vlastní omezený serializer podle veřejné specifikace a samostatně ověřený nezměněný font Geist Regular 1.800 (OFL-1.1); viz PDF_EXPORT.md.

## Posouzené alternativy

| Kandidát | Rozhodnutí |
| --- | --- |
| Lexical | MIT a vhodný modulární React editor. Pro požadované tabulky, styly a nástroje by potřeboval více vlastní integrace. Není instalován; Tiptap lépe odpovídá první etapě. [Zdroj](https://github.com/facebook/lexical). |
| Univer OSS 1.0.4 | Funkčně silný kandidát včetně závislostního výpočetního enginu. Konkrétní graf byl odmítnut: `ot-text-unicode@4.0.0` uvádí ISC v metadatech, ale publikuje neúplný odlišný MIT text. Nebyl instalován ani distribuován. Nejde o tvrzení, že celý Univer je placený nebo copyleft. [OSS/Pro hranice](https://github.com/dream-num/univer/blob/dev/DREAMNUM.md). |
| Jspreadsheet CE | MIT komunitní varianta je odlišná od komerční edice. Dostupnost jednotlivých funkcí a doplňků se nesmí přenášet z placené nabídky. Nebyla potřebná po ověření FortuneSheet. [CE zdroj](https://github.com/jspreadsheet/ce). |
| RevoGrid Community | Výkonný datový grid, ale potřebné vzorce a Excel export se nabízejí v Pro rozšířeních. Pro tento cíl nebyl vybrán. [Vzorce Pro](https://pro.rv-grid.com/guides/formula/overview/). |
| ExcelJS, Mammoth, docx | Příznivé licence hlavních knihoven nestačily. Jejich konkrétní nepřímé grafy zahrnovaly identifikátory mimo předepsaný úzký seznam, například Unlicense, Zlib nebo BlueOak. Nejsou součástí nového Office balíčku. |
| SheetJS CE | Otevřený kandidát, ale npm balíček `xlsx` není autoritativní distribuční kanál aktuální CE. Vlastní omezený OOXML adaptér dovoluje menší kontrolovanou plochu a explicitní upozornění. [Oficiální instalace](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/). |
| PDF.js | Prohlížeč existujících PDF; neřeší sazbu textového editoru do PDF. Není potřebný. [Zdroj](https://github.com/mozilla/pdf.js). |
| pdf-lib 1.17.1 / fontkit 1.1.1 | Přímo i nepřímo vyžadují pako1.0.11, které uvádí MIT AND Zlib a skutečně obsahuje zlib licenční grant mimo úzký seznam. Neinstalováno. [Přesné artefakty a odmítnuté cesty](../licenses/pdf-candidates.json). |

## Hranice důkazů

Údržba projektu a široká nabídka funkcí nejsou důkazem bezpečnosti konkrétní integrace. Výkon a kompatibilitu hodnotíme testy této sestavy; netvrdíme neprovedený benchmark mezi enginy. Vlastní UI a šablony jsou původní; distribuujeme pouze samostatně ověřený nezměněný OFL font pro PDF, žádné cizí fotografie. Závislé UI/ikony pokrývají zachované doklady. Systémové fonty se pouze vybírají z fontů uživatelova zařízení.

Nový balíček neinstaluje TypeScript. Jeho posouzený archiv obsahoval vložené materiály s dalšími licencemi mimo zvolený seznam. JavaScript sestavuje auditovaný esbuild; statická kontrola může použít již existující kompilátor hostitelského projektu. Tento existující nástroj a starší závislosti obou hostitelů jsou oddělené od auditu nově distribuovaného Office balíčku.

Licenční audit je technická evidence a kontrola politiky; nepředstavuje absolutní právní záruku.
