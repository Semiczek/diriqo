# Obnova akcí po potvrzeném vydání nabídky

24. 10. 2026, navazuje na PR #40 / `9752b372622feb3b6356acb11f0dbbd066f85442`.

Přihlášený průchod na app.diriqo.com v syntetické firmě s jedinou licencí Core reprodukoval chybu: vydání i ruční přijetí verze se uloží, ale po otevření potvrzeného výsledku zůstanou další akce zamčené. Next router.refresh zachová klientský stav; navigace na stejnou URL sama komponentu znovu nevytvoří.

Oprava dovolí zahodit potvrzený lokální stav pouze panelu inicializovanému ze stejné nebo novější serverové revize než potvrzení. Před dokončením znovu ověří firmu a aktéra. Změna props během ověřování neodemkne zastaralý panel. Nejasné výsledky zůstávají uložené a editační, vytvářecí i odesílací formuláře nadále čekají na navigaci.

Ověření před vydáním: 48/48 cílených testů PASS, z toho 11 testů se skutečným React DOM a životním cyklem komponenty. Dva z nich na původním hooku prokazatelně selhaly. TypeScript a cílený ESLint PASS. Dev závislost jsdom 27.4.0 slouží pouze testům. CI a nasazení se dokládají samostatně po vytvoření PR.

Živý průchod před opravou již doložil zákazníka, ruční materiál bez skladu, kalkulaci po reloadu, zákaznické řádky 100 Kč a 0 Kč a stažené PDF bez kontrolního interního nákladu 123,45 Kč nebo interních poznámek. Nalezená samostatná portálová chyba se řeší odděleně. C05 ani celý původní cíl se tímto dokumentem neuzavírají.

Důkaz reprodukce a hostované preflight údaje: `artifacts/quotes/c05-ui-preflight-and-findings-20261024.json`, SHA-256 `f645c5d082a1c1ea944b7536f40187cbda849223e9f3aafda5454aee74f090e9`. Výstup negativního testu je lokálně v Temp pod `diriqo-quote-operation-react-before-fix-20261024.txt`.

## Dokončené vydání a živá regrese 24. 10. 2026

Předchozí odstavce jsou předvydávací checkpoint. PR #41 je sloučené; po navazujícím PR #42 byla ověřena aplikace `3ed450a2d349cc65e03a5791fcc20abb340611f1`, deployment `dpl_HrdJJEanAPhsSCWqNdh7DhWNhaNf`. CI 40072843882: 2449/84 PASS, Office 62 PASS + 1 podmíněný SKIP, build 107, lint 0 chyb / 3 existující varování.

Nová syntetická nabídka `62790555-d25e-4b03-9f22-5cec904e18a2` / verze `80175326-532f-494c-ba1c-d61800f11522` prošla živou UI publikací i ručním odmítnutím za 1 Kč. Otevření potvrzeného výsledku na stejné URL odemklo další tlačítka bez úplného reloadu. Nejde o rozhodnutí skutečného zákazníka. UI bylo vráceno do Diriqo Demo; úklid přístupů a samostatné uzavření C05 jsou v [akceptačním reportu](core-c05-live-acceptance-release.md).

Důkaz: `artifacts/quotes/c05-live-acceptance-20261024.json`, SHA-256 `07caf3fbc90df38b5bef0aa78656786a085c8f0f2a541990fc14e67b90f8be6a`. Tento dokumentační doplněk testy znovu nespouští.
