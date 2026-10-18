# Atomická úhrada a storno faktury — 13. 10. 2026

## Stav tohoto checkpointu

Nové RPC pro označení celé faktury jako zaplacené a pro její zrušení jsou aplikované pouze v testovacím Diriqu `wfcpfraxiuhuglnuaxqj`. Aplikační kandidát nahrazuje samostatné zápisy do faktury, zakázek a vazeb jedním voláním transakce. **Nová aplikační změna zatím nemá doložené CI, nasazení ani přihlášené UI ověření.** Nová settlement SQL sada a skutečný souběh dvou HTTP relací čekají na dokončení; jejich přítomnost v repozitáři není výsledkem testu.

Výchozí revize před touto opravou je `ac07949537852d02fa69654433eb6353db052a1f`, merge [PR #19](https://github.com/Semiczek/diriqo/pull/19). Nasazená atomická editace konceptu a obnova dodavatele z PR #18 mají samostatný [report včetně přihlášených dvou karet](invoice-draft-update-release.md). Tento zásah jejich důkaz nepřenáší na úhradu a storno. JSPD Hub, jeho identita a data se nemění.

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
| Nové aplikační unit testy `tests/invoice-settlement.test.ts` | **72/72 PASS**; autorizace, identita firmy, revize, idempotentní odpověď, bezpečné chyby, nejasný COMMIT, následná revalidace a podmíněné zápisy stavu odeslání |
| Celá lokální unit sada | **1147/1147 PASS ve 44 souborech** |
| TypeScript a celý lint | **PASS** |
| Platformní kontrakty | **18/18 PASS**; nejde o potvrzení všech akceptačních scénářů |
| Kompatibilita Office | **11/11 kontraktů + integrita balíčku PASS**; bez dalšího tvrzení o funkčnosti celého Office |
| Existující skutečné fakturační SQL regrese po aplikaci migrace | **300 kontrol + 44 kontrol úklidu PASS** |
| Nová skutečná SQL sada `supabase/tests/invoice-settlement.sql` | Čeká na potvrzený výsledek |
| Souběh přes skutečné Auth/PostgREST relace | Čeká na doložený překryv, výsledné řádky a úklid |
| CI, nasazení a přihlášené UI nové úhrady/storna | Zatím neprokázáno |

Existující SQL regrese zahrnují tvorbu konceptu, vystavení, ochranu obsahu, uchování historie při DELETE, jedinečnost čísla a atomickou editaci. Každá sada ověřuje operace postupně uvnitř jedné databázové relace. Jejich úspěch se neoznačuje za důkaz souběhu nových settlement RPC.

Pro souběhový důkaz je připravená oddělená syntetická firma a skutečné Auth relace. Vydané a zrušené syntetické faktury podléhají stejné ochraně historie jako ostatní doklady: úklid nesmí vypnout retenční guard ani smazat vydanou historii. Výsledný rozsah zachovaných důkazových řádků a odstraněných přístupů musí být uveden až po skutečné kontrole.

## Otevřené hranice a návrat

- Toto je označení **celé úhrady**, nikoli platební deník, bankovní párování, částečná platba, dobropis nebo daňové vyúčtování. Zrušení není náhrada opravného dokladu.
- Samostatný export do Pohody zatím nepořizuje společný zámek s těmito přechody. Souběh exportu a storna i jeho oddělené zápisy zůstávají otevřeným fakturačním lifecycle rizikem.
- Starší oprávněné přímé zápisy do tabulek nadále existují. Nové RPC nemění jejich granty a neprokazují atomicitu všech možných legacy zapisovačů.
- Dvě současné HTTP operace editace/vystavení v obou pořadích, širší platební proces a fyzická zařízení mají samostatnou akceptaci. Dosavadní důkazy se na ně nepřenášejí.

Při kompatibilitní chybě ponechat aditivní funkce a ochrany vydané historie. Návrat na staré aplikační úhrady/storna by znovu otevřel samostatné zápisy; nejde o bezpečné dlouhodobé řešení. Potvrzenou DB chybu řešit novou verzovanou opravnou migrací. Aplikovaný soubor zpětně neměnit, historická data automaticky neopravovat a kvůli testovacímu úklidu nevypínat ochrany dokladů.

Matice 73 původních scénářů se nemění: **1 HOTOVO / 48 ČÁSTEČNĚ / 12 CHYBÍ / 7 CHYBA / 5 NEOVĚŘENO**. P0-07 se v tomto checkpointu neoznačuje celý za uzavřený a komerční připravenost Diriqa se netvrdí.
