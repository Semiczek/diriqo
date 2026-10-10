# Serverový adaptér starých EUR předplatných

Stav 10. 10. 2026: implementován a testován lokálně, **nezapojen do provozních guardů**. Nezakládá nové licence, nezapisuje do databáze, nemění Stripe ani platné EUR ceny. Tato vrstva ještě nedokládá splnění licenčních akceptačních scénářů v databázi.

## Zdroj a hranice důvěry

`lib/platform/entitlement-loader.ts` přijímá autentizovaný `DalContext` z existujícího DAL. Má `import 'server-only'`. Znovu ověří uživatele přes `auth.getUser()`, vazbu konkrétního profilu a aktivní členství v požadované firmě. Role dodaná v kontextu sama žádnou licenci nepřidělí. Dvojice vzájemně rozporných `auth_user_id` a `user_id` se odmítne k prověření.

Čte výhradně `profiles`, `company_members`, aktuální `company_subscriptions` a `company_modules`. Všechny firemní dotazy mají explicitní filtr `company_id`, profily mají filtr `id`. Nepoužívá starší tabulku `subscriptions`, service-role klienta, `getCompanyModules()` ani helper zakládající trial. Nevytváří chybějící přepínače při čtení. Chyba dotazu vrací `unavailable`, nikoliv implicitně zapnuté moduly. DTO neobsahuje tokeny, Stripe identifikátory ani syrovou chybu databáze.

`lib/platform/legacy-entitlements.ts` je čistý převod serverem načtených dat pro migraci a porovnávání výsledků. Nesmí být zdrojem autorizace z těla požadavku. Nečte nový CZK katalog a neodvozuje oprávnění z ceny nebo role. Výsledek musí stále projít kontrolou identity, rolí, objektu, země a dalšími doménovými pravidly.

## Přesná kompatibilita

Podporované původní klíče jsou `starter`, `growth`, `business`, `scale`. Neznámý klíč včetně starého `enterprise`/`custom` se nenormalizuje na jiný tarif. Vyžaduje prověření konkrétního záznamu a historie smlouvy.

| Zdrojový přepínač | Mapované stávající schopnosti |
| --- | --- |
| jobs | Zakázky a zákazníci |
| workers | Pracovníci a sazby |
| shifts | Evidence a schvalování času |
| quotes | Jednoduché nabídky v Core |
| calendar | Kalendář a absence |
| finance | Zálohy pracovníkům, ruční náklady a základní ekonomika |
| photos | Nahrávání souborů |
| invoices | Vystavení faktury, historie/export, dokončení předchozí platby |

Převod vyžaduje všech osm příslušných přepínačů jako explicitní booleany, bez duplicit a v jedné firmě. `false` nic neudělí. Nové Sklady, POS, Vozidla, AI Asistent, Chytré nabídky, OCR faktur ani dosud chybějící předávací protokol nejsou automatickou součástí staré licence. Vypnutí faktur nezpoplatní jednoduché nabídky. Přepínače určují pouze omezení původní licence; u budoucího CZK Core se použije jeho vlastní sjednaný rozsah.

Platnost musí mít konečný, doložený začátek a konec s časovou zónou. Aktuální starý helper `hasActiveSubscription()` povoluje `active` bez konce neomezeně; adaptér takový záznam označí `invalid_period`. Záměrně se proto zatím nepoužívá jako náhrada živého guardu. Před zapojením se chybějící data doloží samostatnou migrací, nikoliv domyšleným termínem.

- `trialing` používá přesně uložený počátek/konec a původ `trial`; nezakládá nový třicetidenní trial.
- `active` běží do konce uloženého období.
- `cancel_at_period_end` ani starý `canceled` nezkracují konec již zaplaceného období.
- `past_due` ponechá zbytek zaplaceného období a existující třídenní toleranci podle `lib/subscription.ts`. Nový návrh sedmi dní tuto starou smlouvu automaticky nemění.
- `expired` nepovolí nové operace. `incomplete` a nerozpoznané stavy vyžadují prověření.
- Intervaly jsou polouzavřené `[od, do)`, včetně hranice trialu a tolerance.

Původní přístup k historii se nepřevádí na automatických dalších 90 dní. Dočasný snapshot obsahuje historii jen do původního konce přístupu, případně existující tolerance. Budoucí pravidlo uchování historie vyžaduje samostatný trvalý záznam, také pro již ukončená předplatná.

## Co musí předcházet zapojení

1. Zvolit a vytvořit trvalé, verzované entitlement záznamy s RLS a omezenými zápisovými cestami. Tato dávka žádné nové názvy tabulek nebo sloupců nevymýšlí.
2. Provést report skutečných starých záznamů: neznámé tarify/stavy, chybějící období a přepínače, rozporné vazby profilů. Řešení musí zachovat doložená práva zákazníka a historii plateb.
3. Uložit historická období a jejich rozsah. ID převodu obsahuje předplatné, produkt a oba konce období; při obnově se změní. Samotný přepis aktuálního předplatného tudíž není úložiště historie.
4. Navázat původní faktury a události na správnou trvalou licenci před použitím `settle_prior_event`. Samotný současný snapshot nedokazuje původ dávno vystavené faktury.
5. Otestovat skutečné tenant A/B, odebrání členství, RLS, granty a transakční souběh v testovacím Diriqo. Čtení několika tabulek přes HTTP neposkytuje atomický zámek členství ani licence při následném zápisu. Zápis musí být vynucen také databází.
6. Teprve poté zapojit adaptér do endpointů/akcí. Výsledek nesdílet v cache mezi požadavky ani firmami. Změnu tarifů a historie oddělit od čtení.

## Ověření této dávky

`tests/platform-entitlement-loader.test.mjs`: **19/19 úspěšných testů**. Zahrnují čtyři EUR tarify, zakázané nové doplňky, jednoduché nabídky bez fakturace, neznámé klíče, chybějící/duplicitní/typově chybné přepínače, firmu A/B, pevná období, konec trialu, zrušení obnovy, třídenní toleranci, identitu licence při obnově, ověření Auth/profilu/členství a bezpečný výsledek při chybách.

Příkazy:

```text
node --test --test-isolation=none tests/platform-entitlement-loader.test.mjs
npm test -- --configLoader native --pool=threads --maxWorkers=1 tests/platform-entitlement-loader.test.mjs
```

Výchozí načítání Vite konfigurace v tomto Windows sandboxu narazilo na `spawn EPERM`; přímé nativní načtení konfigurace výše prošlo. Testy klienta používají řízené odpovědi a nekontrolují reálnou databázi. `server-only` se nahrazuje prázdným modulem pouze uvnitř testovacího procesu.

Při implementaci byly ověřeny lokální pokyny Next.js 16.2 k DAL a [Supabase `getUser`](https://supabase.com/docs/reference/javascript/auth-getuser), [čtení dat](https://supabase.com/docs/reference/javascript/select) a [changelog](https://supabase.com/changelog). Žádná změna databáze ani nasazení touto dávkou neproběhly.
