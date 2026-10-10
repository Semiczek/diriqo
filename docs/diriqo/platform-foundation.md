# Rozsah první implementační dávky 1A

Tato dávka je izolovaný návrhový kontrakt. Není připojena do obrazovek, checkoutu, onboarding akcí, DAL, RPC, RLS nebo Storage. Neopravuje současnou administrátorskou eskalaci ani dosavadní modulové přepínače. Registrace schopnosti neznamená, že její celé workflow již existuje.

## Kód a použití

- `lib/platform/capabilities.ts`: známé produkty, registr schopností s produktem/účelem/rozsahem a čistá funkce `evaluateCapabilityEntitlement`.
- `lib/platform/catalog-czk-draft.ts`: neměnný verzovaný CZK návrh, navržené schopnosti tarifů a kapacity, rozdíl technických a obchodních závislostí, přesná roční cena a náhled jedné jednotky.
- `tests/platform-foundation.test.mjs`: společná sada pro stávající Vitest (`npm test`) i přímé lokální spuštění na Node 24.14.0 (`npm run test:platform`). Vitest načítá TypeScript i na původním CI runtime; pomocný přímý příkaz vyžaduje Node 24 a nepotřebuje Supabase ani instalaci aplikačních závislostí. Konfigurace Vitestu výslovně zahrnuje také `*.test.mjs`.

Nároky jsou záměrně nezávislé na cenovém katalogu. Cena, známý tarif, role ani menu nevytvářejí licenci. Hodnota `entitled: true` je **jen výsledek licenčního posouzení**, nikdy souhlas provést požadavek. Funkce nesmí dostat nárok z JSON klienta nebo JWT uživatelských metadata.

Před použitím v aplikaci potřebuje serverový loader ověřit aktuální identitu a členství, předat správnou firmu a všechny relevantní aktuální i historické nároky. Autoritativní guard musí navíc ověřit oprávnění ke konkrétní akci a objektu, podporovaný zemský režim, bezpečnostní blokaci, provozní pozastavení a podle operace atomickou rezervaci rozpočtu. Stejnou hranici musí mít přímé DB/RPC cesty. Žádná část této úplné autorizace se nenahrazuje klientským vyhodnocením.

## Pravidla čisté licenční funkce

- Neznámé klíče včetně prototypových vlastností, chybějící zdroj/verze, odvolaný nárok, neznámý stav, chybné časy a nedostupná data zamítají. Nárok nevzniká během čtení.
- Čas je celočíselný UTC epoch v milisekundách; interval je `[validFrom, validUntil)`. Přesně na konci již nový zápis není licenčně způsobilý. `cancelAtPeriodEnd` je požadavek na neobnovení; nemění platný interval `active`. `canceled` znamená již skončené předplatné.
- `grace` potřebuje vlastní konec a výslovný seznam operací; sama licence asistenta nebo OCR nevytváří rozpočet. `draft` nevytváří žádné právo. Trial a administrátorský grant mají explicitní původ.
- Čtení a export historie potřebují konkrétní známou schopnost ve skutečném nároku a čas `historyUntil`. Neexistence dřívějšího nároku není právo na historii. Členství se nadále kontroluje zvlášť.
- POS nárok se shoduje zároveň s firmou a logickou pokladnou. Firemní nárok má `registerId: null`; vyšší tarif jiné pokladny jej nerozšiřuje. Skladový požadavek pracuje s firemním scope, i když vzniká z POS.
- Při více způsobilých nárocích je výběr stabilní podle ID; expirovaný nebo jinak omezený nárok nemění samostatný platný grant.
- Settlement má vlastní schopnost a potřebuje odkaz na událost stejné firmy, pokladny a původního nároku, vzniklou v původním platném intervalu. Neotevírá nové prodeje. Pravost události, autorizované zařízení/poskytovatel, idempotence, obsah, měna a limit vratky patří do budoucího doménového příkazu.

Settlement přijímá také událost vzniklou v zachovaném původním grace intervalu, pouze pokud její schopnost byla výslovně uvedena v `graceCapabilities`. Loader proto potřebuje neměnný historický snímek původního nároku včetně skutečně udělené tolerance; nesmí zpětně aplikovat nové obchodní podmínky. Není implementována kontrola podpisu offline lease, hodin zařízení ani offline synchronizace. Settlement nemá automatickou obchodní retenční lhůtu; doménový příkaz musí určit přípustnost a rozsah konkrétní opravy.

## Katalog a kompatibilita

Návrh má `status: draft`, `effectiveAt: null`, `purchasable: false` a nepoužívá Stripe price ID. Částky jsou haléře CZK bez DPH. Roční cena se počítá jednou jako 90 % dvanácti měsíčních cen se zaokrouhlením na haléř; Mini má výslovnou roční výjimku 100 000 haléřů.

Solo/Team/Company mají stejné navržené core schopnosti včetně jednoduché nabídky a ručního nákladu; liší se kapacitou. Samostatný POS nepotřebuje core. Inventory/invoicing/AI mají obchodní vazbu na core nebo POS, fleet/smart_quotes na core. Je to validátor skladby produktů, **nikoli validátor celého nákupního košíku, kapacitní zámek nebo runtime kontrola závislých grantů**. Přikoupení místa samo nedává schopnosti. Návrh cen neměří aktuální počet osob, skladů nebo vozidel.

Seznamy POS schopností jsou první návrh hranic. Země, terminály, tiskárny, offline režim a kuchyňské zařízení nejsou označené za podporované. Detailní katalog dostupnosti po zemi a zařízení, další jemné akce a případný košík pro smíšené tarify pokladen se doplní s doménovou implementací. Nyní žádný nový tarif nelze koupit.

`lib/plans.ts`, stávající Stripe endpointy, EUR SQL, databázová schémata a záznamy zůstaly stejné. Adaptér historických EUR oprávnění **zatím není implementován**; jeho mapování musí vycházet ze skutečných smluv a runtime hranic. Plošné `company_modules=true` není podkladem pro grant nových inventory/POS/fleet/AI produktů.

## Navazující dávka 1B

Nejdříve ověřit aktuální DB katalog Diriqa, připravit reprodukovatelnou základnu a oddělit platformní administraci od měnitelných firemních rolí. Pak přidat verzované nároky, explicitní legacy adaptér, serverový loader a přímé DB enforcement pro první celou vertikálu. Součástí jsou skutečné testy dvou syntetických firem, rolí, revokace, souběhu a přímého RPC/REST přístupu. Dosavadních 73 cílových akceptací tato čistá knihovna neuzavírá.
