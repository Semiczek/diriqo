# Legacy DOC, XLS a OpenFormula

## Rozhodnutí a licence (12. 10. 2026)

Pro skutečný binární XLS je vybraný **SheetJS Community Edition 0.20.3**, Apache-2.0, autor SheetJS LLC. Ověřený zdroj je [oficiální archiv](https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz), nikoliv zastaralé npm vydání 0.18.5. SHA-256 archivu: `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`. Archiv má nulové runtime, optional a peer závislosti. `LICENSE` a `dist/LICENSE` obsahují Apache-2.0 a copyright SheetJS; shodný SHA-256: `4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64`. Bundlované části SSF, CFB, CRC32 a codepages mají vlastní copyright hlavičky SheetJS. Tyto hlavičky a licenční texty musí zůstat v distribuční evidenci. Vývojové závislosti dodavatele nejsou automaticky instalovány nebo spouštěny.

[Oficiální bezpečnostní informace](https://docs.sheetjs.com/docs/miscellany/security/) a [seznam advisories](https://cdn.sheetjs.com/advisories/) byly zkontrolovány. Verze 0.20.3 je novější než oprava CVE-2024-22363. Tím se netvrdí nepřítomnost všech chyb: adaptér musí nadále omezovat vstup, odmítat aktivní obsah a běžet v izolovaném workeru. Generovaný HTML výstup SheetJS se v Office nevkládá do DOM.

`word-extractor@1.0.4` byl odmítnut. Má MIT licenci, ale [otevřený problém #70](https://github.com/morungos/node-word-extractor/issues/70) dokládá ztrátu textu při záměně modifikátoru rozteče znaků za označení smazané revize. Navíc archiv jeho závislosti `saxes@5.0.1` neobsahuje LICENSE, přestože metadata uvádějí ISC. Žádný z těchto kandidátních balíčků nebyl přidán jako závislost Office. Audit prověřil také deklarované nepřímé závislosti `xmlchars@2.2.0`, `yauzl@2.10.0`, `fd-slicer@1.1.0`, `pend@1.2.0` a `buffer-crc32@0.2.13` (MIT, licenční soubory v archivech). Kompletní metadata před instalací jsou v `reports/format-candidate-audit/audit.json`.

## Binární DOC

`compound-file.ts` a `legacy-doc.ts` jsou vlastní implementace podle veřejné specifikace Microsoft; nepřebírají kód placeného editoru ani `word-extractor`. Podporují Word 97–2007 DOC s FIB/CLX tabulkou textových segmentů. Nepodporují Word 6/95, RTF/HTML přejmenovaný na DOC ani zápis binárního DOC. Pro další práci lze exportovat do podporovaného otevřeného formátu nebo DOCX.

Výsledkem je pouze text hlavního dokumentu s odstavci. Obrázky, struktura tabulek, styly, seznamy, záhlaví, zápatí, komentáře a stránkování se nepřenášejí. Viditelná upozornění jsou součástí výsledku; původní soubor musí hostitel zachovat odděleně. Pole se převádějí pouze na uložený textový výsledek. Aktivní pole, včetně vnořených DDE, jsou odmítnuta. Konzervativní kontrola známých modifikátorů v textových, znakových a stylových vlastnostech odmítá rozpoznané skryté či revizní texty; není to plná implementace změnového režimu Wordu a může odmítnout složitější soubor. Takový dokument je nutné nejprve zkontrolovat a uložit jako DOCX.

CFB kontrola má limit 12 MiB, omezený počet adresářových položek, hloubku, velikosti streamů a jedinečnost fyzických i mini sektorů. Detekuje cykly, překryvy, neúplné řetězce, duplicitní cesty, osiřelé položky, šifrování, makra a vložené aktivní objekty. Prázdný `ObjectPool`, který Word vytváří i v prázdném dokumentu, je povolen jen jako prázdné úložiště; objekt uvnitř povolen není. Neprobíhá síťové načítání ani aktivace OLE/COM.

Veřejné primární podklady:

- [MS-CFB: hlavička](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/05060311-bfce-4b12-874d-71fd4ce63aea), [adresářová položka](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/60fe8611-66c3-496b-b70d-a504c94c9ace).
- [MS-DOC: načtení textu](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/01d5d8c4-cf9c-4ef9-80fd-439e763cfe01), [FIB](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/9aeaa2e7-4a45-468e-ab13-3f6193eb9394), [FcCompressed](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/aa2e55a2-f4f2-4795-bab5-6d9d7a0ed249).
- [MS-DOC: znakové vlastnosti](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/7022285b-9621-42e9-ad4d-4e02c115ef18), [Prm0](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/35226a0b-9038-4427-83c2-3830a8554267), [přímé formátování](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/be58bf9c-d1d3-40cc-91ee-36452d7939b2).

## Vzorce ODS

`odf-formulas.ts` převádí interní anglický A1 zápis na OpenFormula a zpět. Převádí odkazy, oddělovače argumentů a povolenou podmnožinu funkcí. Nevyhodnocuje vzorce. Zachovává absolutní a relativní značky řádku/sloupce, názvy listů s diakritikou a apostrofy i řetězcové literály. Explicitní pojmenovaný list má v editoru stálou identitu; export proto zapisuje absolutní odkaz na tento list. Whitespace mimo literály se normalizuje.

Externí a aktivní operace mají chybu `UNSAFE_FORMULA` a musí se odmítnout. Nepodporované názvy, pole, 3D oblasti, jiné namespace, neznámé funkce nebo neúplné argumenty mají `UNSUPPORTED_FORMULA`; hostitelský konvertor je může nahradit uloženou hodnotou pouze s viditelným upozorněním. Převodník sám žádný obsah tiše nenahrazuje. Podklady: [OASIS OpenFormula](https://docs.oasis-open.org/office/OpenDocument/v1.4/OpenDocument-v1.4-part4-formula.html) a [pravidla citování názvů a absolutních adres](https://docs.oasis-open.org/office/v1.1/OS/OpenDocument-v1.1-html/OpenDocument-v1.1.html).

## Doklady ověření

Automatické testy jsou v `tests/legacy-doc.test.mjs` a `tests/odf-formulas.test.mjs`. Binární fixture generátor `tests/fixtures/legacy-office.mjs` je původní a obsahuje pouze syntetická data. Doplňkově byl lokálně ověřen import tří veřejných DOC souborů z testů Apache POI, včetně dokumentu vytvořeného Wordem 97-SR2; jejich obsah není součástí distribuovaných testovacích fixture. Hash a výsledek jednotlivých sond je v `reports/legacy-doc-external-probes.json`. Toto je důkaz lokální interoperability, nikoliv ověření nasazení nebo úplné kompatibility Wordu.
