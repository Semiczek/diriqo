# Ověření tiskové sazby

Dne 11. 10. 2026 proběhl skutečný lokální tisk instalovaným Chrome v samostatném prázdném headless profilu. Prohlížeč četl pouze naše syntetické HTML s aktuálním `src/client/office.css`, veřejným `documentToHtml` a obaly odpovídajícími DocumentEditoru/Tiptapu. Fixture zahrnuje nepříznivé hostitelské předky (`100vh`, flex, scroll, transform), široké tabulky a okolní navigaci/panely. Nejde o automatizaci uživatelova prohlížeče ani o volání CDP. Nativní dialog a fyzická tiskárna tímto ověřené nejsou.

Výsledky v `output/pdf/native-print/`:

| Případ | Chrome tisk | Serverové PDF | Výsledek |
| --- | --- | --- | --- |
| Krátký český dokument, nadpis, odrážky, číslovaný seznam, měny | 1 strana | 1 strana | PASS |
| Ruční zlom, 36 řádků, buňka vyšší než stránka, 80 vět, slovo o 1 320 znacích | 6 stran | 5 stran | PASS |
| Stejný krátký dokument s 50mm okraji | 1 strana | 1 strana | PASS |

Původní `break-inside:avoid` na všech tabulkových řádcích odsouval nadměrnou buňku na další stranu a zanechal předchozí téměř prázdnou (7 stran). `break-inside:auto` dovoluje přirozené dělení (6 stran). Běžné řádky zůstaly v této fixture čitelné a obsah se neztratil. Původní PDF je uchováno jako `long-before-row-flow.pdf` pro porovnání. Nejde o záruku identické sazby ve všech prohlížečích či při libovolném nastavení tisku.

Existující pypdf a pdfplumber nezávisle ověřily skutečnou strukturu PDF, A4, meze textu vůči okrajům, nepřítomnost prázdných stran a navigace, české znaky a částky, všech 36 jedinečných řádků, 80 celých opakovaných vět a celé dlouhé slovo. První tabulka začíná za ručním zlomem na druhé straně. Chrome může ukládat textové objekty v jiném pořadí než je čteme; kontrola obsahu proto používá prostorové řazení. Serverová patička je umístěna základní linkou písma; geometrická kontrola dovoluje pod touto linkou nejvýše 4 pt pro dolní dotažnice. Tělo z Chrome má toleranci zaokrouhlení 2 pt.

Poppler vykreslil všech 15 výsledných stran do `verified-*.png`. Všechny byly vizuálně zkontrolovány: text nepřekrývá další obsah ani patičku, tabulky pokračují přes stránky a dlouhé slovo neopouští šířku stránky. Serverové PDF a Chrome tisk mají odlišné fonty, řádkování a hlavičky/patičky; neprohlašujeme jejich pixelovou shodu. `render-report.json` váže HTML/PDF na SHA-256 tiskového CSS a `independent-validation.json` obsahuje textové a geometrické výsledky včetně hashů PDF/PNG po vizuální kontrole.

## Opakování bez instalace

Použijte pouze již schválené, dostupné validační nástroje. Následující skripty nic neinstalují a nevolají aplikaci, databázi ani vzdálené služby. Soubor `OFFICE_PRINT_BROWSER` musí být existující Chrome/Edge. Skript vždy vytvoří vlastní profil v `tmp/pdfs/`; nepřijímá cizí URL ani uživatelský profil. HTML CSP zakazuje skripty a vzdálené zdroje, DNS resolver je vypnutý a nejsou použity žádné přihlašovací údaje.

```powershell
$env:OFFICE_PRINT_BROWSER='C:/Program Files/Google/Chrome/Application/chrome.exe'
node --experimental-strip-types scripts/native-print-demo.mjs
python scripts/verify-native-print.py
pdftoppm -r 85 -png output/pdf/native-print/long.pdf output/pdf/native-print/verified-long
node --experimental-strip-types --test tests/native-print.test.mjs
```

Vykreslete a prohlédněte také ostatní PDF uvedená v reportu. Opětovné spuštění parseru úmyslně vrátí stav vizuální kontroly na `PENDING`; až následná kontrola nových PNG opravňuje zapsat nový výsledek. Omezený shell může spuštění Chrome odmítnout (`EPERM` nebo Windows pipe Access denied); takový běh není důkazem chyby CSS ani úspěšného tisku. V tomto ověření byl použit cíleně schválený běh stejného instalovaného Chrome mimo tento shell sandbox.

`tests/native-print.test.mjs` jsou dva malé testy správnosti syntetické fixture a absence aktivního/síťového obsahu. Nenahrazují skutečný render. Tisková změna nevyžaduje novou knihovnu, cloudovou službu ani změnu oprávnění; Office tlačítko nadále nejprve dokončí uložení a autorizovaný export `print`.
