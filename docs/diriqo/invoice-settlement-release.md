# Atomická úhrada a storno faktury — 18. 10. 2026

## Stav tohoto checkpointu

Nové RPC pro označení celé faktury jako zaplacené a pro její zrušení jsou aplikované pouze v testovacím Diriqu `wfcpfraxiuhuglnuaxqj`. Nasazená aplikace nahrazuje samostatné zápisy do faktury, zakázek a vazeb jedním voláním transakce. Nová skutečná SQL sada má **82 kontrol + 10 kontrol úklidu PASS**, opakováno 18. 10. Skutečné Auth/PostgREST relace s doloženým databázovým překryvem potvrdily úhrada/úhrada a obě pořadí úhrada/storno. **PR #24 je sloučené a nasazené na app.diriqo.com z revize `f3e7b0f5496cec2192d0f5b388cb9d465bd823df`. CI i přihlášené UI úhrady/storna včetně reloadu a navazující DB kontroly mají PASS.**

Výchozí revize před touto opravou je `ac07949537852d02fa69654433eb6353db052a1f`, merge [PR #19](https://github.com/Semiczek/diriqo/pull/19). Implementační commit je `70f3f03`; následná integrace hlavní větve `c116e30` vytvořila kandidáta `536db5d` a zachovala novější změny Office a Diriqenta. Integrovaná lokální sada má **1490/1490 PASS v 53 souborech**, lint, TypeScript a build PASS. Starší výsledky níže jsou výslovně datované. Nasazená atomická editace konceptu a obnova dodavatele z PR #18 mají samostatný [report včetně přihlášených dvou karet](invoice-draft-update-release.md). Tento zásah jejich důkaz nepřenáší na úhradu a storno. JSPD Hub, jeho identita a data se nemění.

## Změna a transakční pravidla

Původní aplikační úhrada zapisovala fakturu a zakázky samostatně; storno oddělovalo také deaktivaci vazeb. Selhání jedné části mohlo zanechat neúplný stav. Opakovaná úhrada navíc znovu vytvářela čas úhrady. Nová cesta používá `mark_invoice_paid_atomic` nebo `cancel_invoice_atomic` s identitou aktivní firmy, faktury a očekávanou revizí jejího uloženého obsahu.

- Databáze zamkne fakturu, ověří aktuálního správce firmy i po čekání na zámek, uložený stav a očekávanou revizi. Související zakázky zamyká v pořadí UUID; nesoulad firmy, zákazníka, aktivních vazeb nebo původního fakturačního stavu zakázky odmítne.
- Úhrada přechází pouze z `issued`, `sent` nebo `overdue` do `paid` a používá jeden databázový čas pro fakturu i její aktivně připojené zakázky.
- Storno dovoluje `draft`, `issued`, `sent` nebo `overdue`. Odmítá evidovanou úhradu a evidenci exportu. U vydané faktury vrací odpovídající zakázky do čekání na fakturaci a deaktivuje její vazby. Zrušení konceptu pouze uvolní vazby; nepřepisuje existující fakturační ani platební pole zakázek.
- Platný již dosažený cílový stav vrátí `changed: false` s původním časem. Není to oprava historického částečného zápisu: opakování nepřepočítává zakázky ani znovu nemění vazby. Neslučitelný terminální stav se odmítá.
- Oprávněná historická úhrada i zrušení konceptu zůstávají dostupné po expiraci licence. Nová cesta neuděluje právo tvořit ani poprvé vystavovat další faktury.

Všechny nové funkce jsou `SECURITY INVOKER` s prázdným `search_path`. Nemění se tabulkové granty, RLS ani existující obsahové a retenční ochrany vydaných dokladů. Novým RPC se uděluje potřebné spouštěcí oprávnění pro `authenticated`; autorita firmy se stále ověřuje uvnitř transakce. Migrace nepřepisuje obchodní řádky.

## Aplikační hranice a rozhraní

Server ověří aktivní firmu oproti skryté identitě původního formuláře a použije ověřeného uživatele přes `getUser()`. DAL předá pouze firmu, fakturu a revizi. Čas, cílové zakázky ani finanční hodnoty se nepřebírají z formuláře. Před potvrzením úspěchu zkontroluje identitu odpovědi, cílový stav, příznak změny, příslušný čas a seznam UUID zakázek.

Formuláře úhrady a storna využívají existující společnou ochranu probíhajících akcí. Zastaralý obsah, oprávnění nebo nesoulad vazeb mají bezpečné české hlášení a nabídku načíst aktuální fakturu. Při chybě se formulář nerevaliduje a rozepsané hodnoty zůstávají zachované. Ztracená odpověď může nastat po COMMIT; aplikace proto neprovádí automatický retry ani netvrdí úspěch. Po potvrzeném výsledku obnoví detail faktury, přehledy faktur a zakázek a detaily zakázek vrácených RPC.

Související označení faktury jako odeslané má podmínku aktuálního stavu přímo v UPDATE. Zápis po odeslání e-mailu nejprve podmíněně přejde z `issued` do `sent`; pokud mezitím vyhrála úhrada, aktualizuje pouze čas odeslání v povoleném aktuálním stavu. Nevrací `paid` do `sent` a neoživuje `cancelled`. Nejasný zápis po přijetí e-mailu poskytovatelem výslovně hlásí, že e-mail už byl odeslán a nemá se posílat znovu. Tyto unit regrese používají mockovaný transport; žádný skutečný e-mail nebyl jejich součástí.

## Příprava a ověřené výsledky

Cílený předmigrační artefakt `preflight20261013` zachycuje dotčené rozhraní: **27 definic funkcí a 7 triggerů**. SHA-256: `f2193b027339ba7e0ca0c945a12e135fff6030f78bcc648d178abb807f28acb5`. Nejde o úplnou zálohu SaaS ani o zkoušku jeho celkové obnovy.

Aplikovaná migrace: `supabase/migrations/20261013175141_atomic_invoice_settlement.sql`. SHA-256 přesného obsahu: `65F4D3E72C0242201C5B2630A21F191A2EDEB9DD8607B7EA48A24337B14A1C2A`. `lock_timeout` při aplikaci je 5 sekund. Migrace i ověřování míří výhradně na uvedené testovací Diriqo.

| Ověření | Stav tohoto checkpointu |
|---|---|
| Nové aplikační unit testy `tests/invoice-settlement.test.ts` | **72/72 PASS dne 13. 10.**; autorizace, identita firmy, revize, idempotentní odpověď, bezpečné chyby, nejasný COMMIT, následná revalidace a podmíněné zápisy stavu odeslání |
| Celá lokální unit sada | **1490/1490 PASS v 53 souborech dne 18. 10.** na integrovaném kandidátu; předchozí sada 13. 10. měla 1147/1147 ve 44 souborech |
| TypeScript a celý lint | **PASS dne 18. 10.** na integrovaném kandidátu |
| Platformní kontrakty | **18/18 PASS dne 18. 10.**; nejde o potvrzení všech akceptačních scénářů |
| Kompatibilita Office | **56 PASS, 1 podmíněný test SKIP dne 18. 10.** kvůli nedostupnému PGlite runtime; integrita balíčku **PASS**, bez tvrzení o funkčnosti celého Office |
| Lokální build integrované aplikace | **PASS dne 18. 10.**, revize `536db5d`, 106 statických stránek |
| Existující skutečné fakturační SQL regrese po aplikaci migrace | **300 kontrol + 44 kontrol úklidu PASS dne 13. 10.** |
| Nová skutečná SQL sada `supabase/tests/invoice-settlement.sql` | **82 kontrol + 10 kontrol úklidu PASS**, opakováno 18. 10.; fixture rollback |
| Souběh přes skutečné Auth/PostgREST relace | **Úhrada/úhrada PASS 13. 10.; úhrada/storno a storno/úhrada PASS 18. 10.**; překryv potvrzen dvěma čekajícími DB relacemi v každém páru, celé konečné řádky ověřeny, obě relace každého páru odhlášeny |
| CI a nasazení | **PASS 18. 10.**: PR běh `39143908149`, main běh `39144120964`; Vercel `dpl_7fnQP76ZcCBwy6Qw9dMX1aMh9Zhp` READY, alias `app.diriqo.com`, SHA `f3e7b0f` |
| Přihlášené UI nové úhrady/storna | **PASS 18. 10.**: obě akce, blokace tlačítek během zápisu, výsledný stav po reloadu, DB stav čtyř zakázek a vazeb; po odebrání testovacího přístupu detail vrací 404 |

Existující SQL regrese zahrnují tvorbu konceptu, vystavení, ochranu obsahu, uchování historie při DELETE, jedinečnost čísla a atomickou editaci. Každá sada ověřuje operace postupně uvnitř jedné databázové relace. Jejich úspěch se neoznačuje za důkaz souběhu nových settlement RPC.

Lokální validační logy integrované revize jsou v `C:\Users\semis\Documents\Codex\diriqo-validation-20261018`.

Nová SQL sada navíc prokazuje rollback hlavičky a první zakázky při business konfliktu druhé seřazené zakázky, odmítnutí cizí firmy a odebraného členství, zachování historického vypořádání po expiraci nebo odebrání modulu a bezpečné opakování storna po novém použití zakázek. Jde o postupné operace v jedné relaci; odebrání členství během čekání na zámek tím není samostatně prokázané.

Souběhový důkaz používá oddělenou syntetickou firmu `d7666d81-4737-4b41-9278-d2c355a13dea` a dvě různé Auth relace v každém páru. Vlastnická relace držela zámek faktury do pozorování dvou aktivních čekajících backendů `authenticator`; kontroloval se i řetězec blokování přes první čekající relaci. Nejde pouze o porovnání časů HTTP požadavků.

| Pár | Databázový překryv | Potvrzený výsledek |
|---|---|---|
| Úhrada / úhrada, 13. 10. | Bariéra PID `188500`, čekající PID `188484` a `188502` | Jedna úplná úhrada; druhý požadavek `changed: false` a stejný původní čas `2026-10-13T18:01:56.216167Z` |
| Úhrada / storno, 18. 10. | Faktura `e2303718-e610-4c70-9245-aa6f9e0f5bc2`; bariéra PID `672971`, čekající PID `672973` a `672974` v `16:05:26.498386 UTC` | Úhrada HTTP 200; storno HTTP 400 / `23514` / `INVOICE_CANCEL_PAID`; obě zakázky, vazby i neměnný účetní obsah ověřeny |
| Storno / úhrada, 18. 10. | Faktura `00e09afd-3965-4837-8304-3e08e7d39573`; bariéra PID `672992`, čekající PID `672994` a `672995` v `16:06:02.573021 UTC` | Storno HTTP 200; úhrada HTTP 400 / `23514` / `INVOICE_INVALID_STATE`; obě zakázky vráceny do čekání na fakturaci, vazby deaktivovány a účetní obsah zachován |

Původní pokus úhrada/storno z 13. 10. neměl potvrzený překryv bariéry, a proto je pouze sekvenčním důkazem. Nový pokus z 18. 10. použil další vydanou syntetickou fakturu a doložil skutečný souběh. Výsledky nové SQL sady, obou bariér a HTTP kontrol z 18. 10. jsou uložené v řízeném artefaktu `artifacts/invoice-settlement/resumed-verification-20261018.json`, SHA-256 `e6cbe94800fde1ad4956cd6c1f4b08f22d1ead1d462ad98f1d897569fe1fb14f`.

HTTP běhy zanechaly ve vyhrazené syntetické firmě **4 faktury, 8 zakázek a 8 položek**; tři faktury jsou zaplacené a jedna zrušená. Přihlášená UI akceptace přidala jednu zaplacenou a jednu zrušenou fakturu: celkem je nyní **6 faktur (4 zaplacené, 2 zrušené), 12 zakázek a 12 položek**. Vydané a zrušené faktury podléhají stejné ochraně historie jako ostatní doklady a nebyly kvůli úklidu smazány.

Každý doložený HTTP pár potvrdil odhlášení obou relací. Syntetický HTTP účet je nyní zakázaný, jeho členství neaktivní a počet jeho relací je 0. Čtyři soukromé soubory s přístupem k HTTP fixture byly odstraněny; kontrola potvrdila 0 zbývajících. Dočasné členství stávajícího administrátora Adama bylo po UI kontrole deaktivované. Aktivní firma byla vrácena na Diriqo Demo s.r.o.; její původní členství zůstalo aktivní. Závěrečná DB kontrola potvrdila 0 aktivních členství ve fixture firmě, 0 relací syntetického účtu a jeho zákaz přihlášení. Následný přístup k testovací faktuře přes UI skončil 404. Úklid testovacích přístupů je uzavřený; vydaná historie je zachovaná.

## Přihlášené ověření nasazené verze

Dne 18. 10. 2026 v 17:12–17:14 UTC proběhlo označení syntetické faktury `345bd93c-af74-4110-b87d-c85e1e5b6410` jako zaplacené a storno `1a4f373a-e087-4e27-bae7-55b0c61f74c4`. UI po akci i obnovení ukázalo Zaplacená / Zrušená. Faktura a obě zakázky při úhradě mají jeden čas `2026-10-18T17:12:49.673428Z`; storno v `2026-10-18T17:13:25.505890Z` vrátilo dvě zakázky do `waiting_for_invoice` a deaktivovalo vazby. V obou dokladech zůstaly dvě položky po 50 Kč a celkem 100 Kč bez DPH. Nebyla provedena skutečná platba ani odeslán e-mail.

Řízený artefakt `artifacts/invoice-settlement/live-release-ui-20261018.json`, SHA-256 `715335bd7905ab42d122fbe838e0b9f109c313eace739995ae0f424c68a07b4d`, obsahuje CI, nasazení, výsledné řádky, aserce i úklid. Snímky jsou v lokálním validačním adresáři:

| Soubor | SHA-256 |
|---|---|
| `invoice-paid-ui.jpg` | `cea0337ce7ed0b6c918a493a77e77b4ddd5a5ef6846023d13859a70878847bad` |
| `invoice-cancelled-ui.jpg` | `dbcd46d05cbd9cd2a3b3b0c44278d3ac031a03ff39fd76330ac6d401760f91cc` |
| `invoice-access-revoked-ui.jpg` | `b6ab4488d5e9dc95d5f63fb426472e3ddc7cfef8941e678bc8755f2ccc4058d5` |

## Otevřené hranice a návrat

- Toto je označení **celé úhrady**, nikoli platební deník, bankovní párování, částečná platba, dobropis nebo daňové vyúčtování. Zrušení není náhrada opravného dokladu.
- Samostatný export do Pohody zatím nepořizuje společný zámek s těmito přechody. Souběh exportu a storna i jeho oddělené zápisy zůstávají otevřeným fakturačním lifecycle rizikem.
- Starší oprávněné přímé zápisy do tabulek nadále existují. Nové RPC nemění jejich granty a neprokazují atomicitu všech možných legacy zapisovačů.
- Dvě současné HTTP operace editace/vystavení v obou pořadích, širší platební proces a fyzická zařízení mají samostatnou akceptaci. Dosavadní důkazy se na ně nepřenášejí.

Při kompatibilitní chybě ponechat aditivní funkce a ochrany vydané historie. Návrat na staré aplikační úhrady/storna by znovu otevřel samostatné zápisy; nejde o bezpečné dlouhodobé řešení. Potvrzenou DB chybu řešit novou verzovanou opravnou migrací. Aplikovaný soubor zpětně neměnit, historická data automaticky neopravovat a kvůli testovacímu úklidu nevypínat ochrany dokladů.

Matice 73 původních scénářů se nemění: **1 HOTOVO / 48 ČÁSTEČNĚ / 12 CHYBÍ / 7 CHYBA / 5 NEOVĚŘENO**. P0-07 se v tomto checkpointu neoznačuje celý za uzavřený a komerční připravenost Diriqa se netvrdí.
