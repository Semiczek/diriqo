# Alternativní formáty Office 0.3.0

| Formát | Import | Export | Omezení |
| --- | --- | --- | --- |
| ODT | Ano | Ano | Odstavce, nadpisy, základní textové styly, seznamy, tabulky a jednoduché záhlaví/zápatí. Obrázky, pole, revize a složitá sazba nejsou věrně přeneseny. |
| DOC | Omezený textový import Word 97–2007 | Ne | Skutečný binární dokument, hlavní text a zobrazené výsledky bezpečných polí. Bez obrázků, stylů, poznámek a rozvržení. Šifrované dokumenty, makra, aktivní objekty a detekované skryté texty/revize se odmítnou. Starší Word 6/95 je nutné převést na DOCX. |
| ODS | Ano | Ano | Hodnoty, podporované vzorce, více listů, číselné formáty a sloučení. Barvy, fonty, grafy, kontingenční tabulky, validace a tiskové rozvržení se mohou změnit. |
| XLS | Excel 97–2003 BIFF8 | Pouze hodnoty | Export obsahuje poslední uložené výsledky výpočtů, nikoli vzorce. Pro zachování vzorců zvolte XLSX nebo ODS. Nejvýše 65 536 řádků a 256 sloupců; větší sešit se odmítne bez tichého ořezu. |
| TSV | Ano, hodnoty jako text | První list, hodnoty | Oddělovačem je tabulátor. Hodnoty, které by mohly být vzorci, jsou při exportu chráněné apostrofem stejně jako CSV. |

Původní DOCX, XLSX, CSV, TXT, HTML a PDF zůstávají dostupné. Import nikdy nezamění původní binární soubor za převedený obsah. Stažení originálu používá existující oprávnění dokumentu; upozornění na částečnou konverzi jsou viditelná v uživatelském rozhraní. DOC export není nabízen a žádný HTML/RTF soubor se nevydává za binární DOC.

## Implementace a licence

- `opendocument-text.ts`: vlastní omezený ODF textový adaptér podle veřejné specifikace OASIS.
- `compound-file.ts` a `legacy-doc.ts`: vlastní omezené čtení MS-CFB a MS-DOC. Žádné spouštění maker ani externí převodník.
- `alternative-spreadsheets.ts`: SheetJS Community Edition **0.20.3**, Apache-2.0, připnutý oficiální archiv `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. Přesný archiv má SHA-256 `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`; nemá runtime, peer ani optional závislosti. Přidaný balíček se používá pouze na serveru.
- `odf-formulas.ts`: vlastní převod podporované podmnožiny vzorců a referencí; výpočty nadále provádí existující otevřený spreadsheet engine.
- Licenční kontrola před instalací prověřila všech 130 přesných balíčků. NOTICE/LICENSE, SBOM a důkazy jsou součástí distribuovaného archivu. CDN výjimka v CI platí jen pro jednu přesnou verzi, URL a integritu; obecné externí URL nejsou povolené.

Podklady: [ODF 1.3 balíčky](https://docs.oasis-open.org/office/OpenDocument/v1.3/OpenDocument-v1.3-part2-packages.html), [ODF schéma](https://docs.oasis-open.org/office/OpenDocument/v1.3/OpenDocument-v1.3-part3-schema.html), [OpenFormula](https://docs.oasis-open.org/office/OpenDocument/v1.3/OpenDocument-v1.3-part4-formula.html), [MS-CFB](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/53989ce4-7b05-4f8d-829b-d08d6148375b), [MS-DOC](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/ccd7b486-7881-484c-a137-51170af7cc22), [SheetJS import](https://docs.sheetjs.com/docs/api/parse-options/), [SheetJS export](https://docs.sheetjs.com/docs/api/write-options/).

## Bezpečnost a provoz

Zpracování probíhá v existujícím odděleném importním workeru s časovým a paměťovým limitem. Platí limit vstupu 12 MiB, rozbalení 48 MiB, 2 048 ZIP položek, 64 listů a 100 000 buněk. ODF opakované buňky a řádky se kontrolují před jejich rozvinutím. XLS/ODS export navíc omezuje celkovou obdélníkovou oblast na 100 000 buněk. Příliš velký nebo nepodporovaný soubor skončí chybou; není tiše zkrácen.

Worker ukončí import po 10 sekundách; má limit staré haldy 192 MiB, mladé haldy 32 MiB a zásobníku 4 MiB. ZIP položka smí mít nejvýše 12 MiB a poměr rozbalení 250:1. ODT má přísnější limity: hloubka XML 64, 100 000 XML/výstupních uzlů, 4 194 304 znakových jednotek textu, 10 000 buněk, 1 000 řádků tabulek, 1 000 opakování jednoho prvku a 4 096 stylů. Hlavička a patička mají každá limit 10 000 znaků. DOC hlavní text smí mít nejvýše 500 000 znakových jednotek. Tyto limity konverze nenahrazují další validaci interního dokumentu při uložení.

Kontrola skutečného kontejneru a typu brání přejmenování textu na DOC nebo ODT. Kontrolují se ZIP CRC, překryvy, šifrování, CFB řetězce sektorů, aktivní objekty, XML entity, hloubka XML a nebezpečné odkazy. Neprovádí se síťová žádost podle obsahu dokumentu. Nepodporované nebo externí vzorce jsou odmítnuté; opakované ODS buňky se vzorcem vyžadují před importem rozvinutí.

Nové formáty používají stejné autorizované upload/export endpointy, neměnné firemní ID, autora, schválené sdílení, historii a audit jako původní formáty. Aditivní Hub migrace `20261012170616_office_alternative_export_formats.sql` rozšiřuje pouze seznam auditovaných exportů. Nemění dokumenty, role, RLS, firemní kontext ani pokladnu.

## Nasazení a návrat

Nejprve otestovat formátové adaptéry, worker, firemní oprávnění a licenční kontrolu. Poté aplikovat aditivní migrační změnu a nasadit Hub s jedním ověřeným sdíleným balíčkem 0.3.0. Diriqo zdrojová větev je předávací větev knihovny bez nasazení aplikace.

Návrat aplikace na předchozí balíček 0.2.0 nevyžaduje mazání dokumentů ani návrat databáze: importovaný obsah zůstává ve stejném interním schématu a rozšířený auditní seznam je zpětně kompatibilní. Stažené originály zůstávají beze změny.
