# Office: kontrola izolace stylů a navigace

Kontrola zdrojového kódu a existujícího `dist/client.css`, 11. 10. 2026. Nejde o záznam přihlášeného průchodu prohlížečem ani test fyzické pokladny. Poslední publikované commity a výsledky CI eviduje [GIT_RELEASE.md](GIT_RELEASE.md).

## Nález a oprava

Office načítá FortuneSheet CSS a vlastní styly v `src/client/index.ts`. Výsledný CSS balík není celý uzavřený pod `.diriqo-office`: FortuneSheet obsahuje například `label { cursor: default }`, `html::-webkit-scrollbar-button`, `.caret`, `.sr-only` a `.button-primary`. Vlastní `src/client/office.css` navíc obsahuje globální `@page { size: A4; margin: 15mm }`. Pravidla skrývající ostatní UI při tisku jsou naopak podmíněna přítomností `body:has(.diriqo-office .office-paper)`.

Next.js může ponechat globální CSS po klientském přechodu na jinou stránku; tuto vlastnost výslovně popisuje také dokumentace nainstalovaného Next.js v `integrations/hub/node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`. Konkrétní příjemce nežádoucího pravidla je tisk protokolu v `integrations/hub/app/manager/jobs/print-button.tsx`: volá `window.print()`, ale jeho `jobs.module.css` vlastní `@page` neurčuje. Po klientském opuštění Office by proto mohl převzít A4 a okraje Office. Nejde o prokázanou chybu plateb nebo skladových zápisů.

Oprava v hostitelských aplikacích používá načtení celého HTML dokumentu při vstupu do Office i při odchodu. Nemění sdílené jádro, archiv editoru, SQL ani pokladní operace. Native `<a>` umožňuje také existující upozornění `beforeunload` na neuložené úpravy.

## Ověřené cesty v aktuálních pracovních souborech

| Cesta | Ověření kódem |
| --- | --- |
| Menu → Office / nastavení Office | Oba `components/DashboardSidebar.tsx` používají native `<a>`; Hub také pro `/office/settings`. Diriqo `app/settings/company/page.tsx` má native `<a>`. |
| Nastavení Office → editor | Oba `app/office/settings/page.tsx` používají native `<a href="/office">`. |
| Office → hlavní aplikace | Oba `app/office/page.tsx` mají native `<a href="/">`; nastavení má stejnou návratovou cestu. |
| Diriqo cookie banner / modal → právní stránky | Root-mounted `CookieConsentManager` pro `/office` i `/office/*` používá native `<a>` pro cookies i soukromí. Mimo Office zachovává původní Next Link. Oba výskyty sdílejí tentýž blok `legalLinks`. |
| Přihlášení → Office | Hub používá `window.location.assign`; Diriqo přihlašovací formulář také používá `window.location.assign` s návratovou cestou serveru. |
| Obnova kontextu / odhlášení z Office | Odkazy v `OfficeClient.tsx` jsou native `<a target="_blank" rel="noopener noreferrer">`. |

## Kořenový layout, automatické akce a klávesnice

- `@diriqo/office/styles.css` a dynamický import editoru jsou pouze v příslušném `app/office/OfficeClient.tsx`. Kořenové layouty neimportují Office runtime ani jeho CSS. Import hostitelského `lib/office/client-context` do DashboardShell neimportuje editor nebo styly.
- Office stránka nemá `DashboardShell` ani `DashboardSidebar`; jejich klientské přepínání firmy, odhlášení, Diriqent navigace a klávesové obsluhy proto uvnitř Office nejsou připojené. Oba I18n providery pouze poskytují React context.
- Hub `AppBusyIndicator` pouze pozoruje kliknutí/odeslání a nastaví indikátor. Nevolá `preventDefault`, router ani history a native navigaci nepřevádí na klientskou.
- Diriqo `AuthHashErrorRedirect` používá `window.location.replace`, tedy načtení celého dokumentu. Cookie modal pouze mění stav souhlasu; jiné navigační obsluhy v něm nejsou.
- Automatický Hub prefetch vychází z existujícího menu registry a povolených cest. Office v tomto registry ani deferred prefetch seznamu není; jeho nově přidané odkazy jsou samostatné native anchor prvky.
- Office kontextové kontroly při změně firmy/ztrátě oprávnění uzavřou transport a ukážou stav. Nevolají `router`, `history`, automatické zpět nebo přesměrování. Kontextový fetch má `redirect: 'manual'`.
- `OfficeWorkspace` a `SpreadsheetEditor` registrují upozornění `beforeunload`. Editorové modaly ani obsluha Ctrl/Cmd+F/H nepoužívají router/history. Hypertextové odkazy v dokumentu jsou běžné odkazy, ne Next Link. V kontrolovaných připojených komponentách nebyla nalezena automatická klientská navigace obcházející tuto hranici.

## Závěr a hranice důkazu

Pro současnou strukturu aplikací je úplné načtení dokumentu na všech výše uvedených vstupech i výstupech dostatečnou hranicí životnosti Office CSS. Historie prohlížeče tím přechází mezi dokumenty; návrat do předchozí aplikace nezachovává DOM a Office styly aktuálního dokumentu. Nové odkazy, globální palety příkazů nebo AI navigační akce do Office musí tuto hranici zachovat.

Kontrola neprokázala další existující klientský výstup z Office po opravě cookie odkazů. Jde o důkaz kódem; přihlášený test vstup → úprava → zrušení/potvrzení odchodu → návrat → tisk protokolu zůstává samostatnou kontrolou prohlížeče. Tisk fyzické pokladny a platební terminál nejsou tímto ověřeny. Produkce se v této kontrole neměnila.
