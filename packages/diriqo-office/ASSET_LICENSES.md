# Evidence původu vizuálních prvků

| Prvek | Původ a podmínky |
| --- | --- |
| Rozložení Office, CSS, typografický znak d., ovládací prvky | Vlastní zdrojový kód tohoto projektu; nebyl přebírán placený design ani UI komponenty. |
| Toolbar, SVG a ostatní UI FortuneSheet | `@fortune-sheet/react@1.0.4` a `@fortune-sheet/core@1.0.4`, MIT; přesné artefakty, SRI a copyright notices v `licenses/evidence.json` a `THIRD_PARTY_LICENSES.md`. |
| Tiptap/ProseMirror | MIT, verze a autorské doložky v licenční evidenci. |
| Fonty uživatelského rozhraní | Systémové fonty Arial, Georgia, Verdana, Times New Roman a Courier New. Jejich dostupnost záleží na zařízení. |
| Font PDF | Nezměněný Geist Regular 1.800 (125 956 bajtů), SIL OFL 1.1; Copyright 2024 The Geist Project Authors. [Úplný OFL](licenses/assets/Geist-OFL.txt), [originální TTF](licenses/assets/Geist-Regular.ttf), [přesné SHA-256 a připnuté oficiální zdroje](licenses/assets/evidence.json). Shoda bajtů s oficiálním Next v16.2.0 byla ověřena; metadata fontu uvádějí OFL. PDF vkládá celý font bez úprav/podmnožiny a úplný OFL do metadat `FontLicense`. Font se neprodává samostatně; licence a autorské doložky se distribuují s Office. |
| Obrázky | Žádné cizí demonstrační fotografie ani vzdálené obrázky nejsou součástí distribuce. Raster nahraný uživatelem zůstává jeho obsahem. |

Před přidáním fontu, obrázku, ikony nebo přebrané komponenty doplňte původ, přesnou verzi či SHA-256, úplný licenční text a případné NOTICE. Úspěšná npm kontrola sama neověřuje práva k zákaznickým souborům.

`scripts/check-office-assets.mjs` je součást `license:check`: odmítne změnu fontu, OFL, vložených serverových bajtů, neznámý soubor a symlink. Záznam fontu je i v CycloneDX SBOM. Server načítá vložená data z balíčku, nikoliv vzdálený font; za běhu nepotřebuje síť ani samostatnou cestu k TTF. Font nepochází z licence MPL přilehlého renderovacího balíčku: rozhodující je OFL v metadatech samotného fontu a připnutý úplný OFL projektu Geist.
