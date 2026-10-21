# Oprava ukládání fakturačních údajů zákazníka

Datum: 21. 10. 2026

## Stav vydání

Aplikační změna zatím **není nasazená**. Čeká na PR, CI a ověření skutečného uživatelského toku po nasazení. Tento dokument neuzavírá žádný akceptační scénář.

Databázová migrace byla aplikována pouze do testovacího projektu Diriqo `wfcpfraxiuhuglnuaxqj`. Ověření jejího zachování dat je uvedeno níže; nejde o potvrzení aplikačního nasazení.

## Potvrzená chyba

V živém schématu zákazníků chyběl sloupec `ares_last_checked_at`, který akce vytvoření a úpravy zákazníka vždy posílaly. Po chybě se prováděl druhý, ochuzený zápis pouze základních kontaktních údajů. Rozhraní pak mohlo hlásit úspěch, přestože požadované fakturační údaje nebyly uloženy.

Detail zákazníka navíc spojoval fakturační údaje a volitelné sloupce webové poptávky do jednoho dotazu. Chybějící volitelný sloupec spustil náhradní načtení, které fakturační pole doplnilo hodnotami NULL. Již uložená adresa tak mohla v rozhraní vypadat jako chybějící.

Ruční zadání českého IČO také automaticky vytvářelo čas údajného ověření ARES, aniž by samotné uložení prokazovalo uskutečněný dotaz do registru.

## Výsledné chování

- Vytvoření a úprava zákazníka používají úplný zápis včetně fakturačních údajů. Ochuzený opakovaný zápis byl odstraněn. Neúspěch vrací chybu, nikoli potvrzení částečného uložení.
- Úprava vyžaduje vrácené ID změněného zákazníka. Nulový počet změněných řádků se nepovažuje za úspěch.
- Povinné fakturační údaje se načítají samostatně. Jejich chyba se zobrazí jako chyba načtení; nenahrazuje se prázdnou adresou.
- Volitelná metadata webové poptávky se načítají odděleně, s podporou současných `web_lead_*` i starších `lead_*` sloupců. Upřednostňuje se současný záznam jako celek, bez smíchání dvou různých podání. Neočekávaná chyba metadat se oznamuje samostatně.
- Ruční uložení nevytváří ani nepřepisuje `ares_last_checked_at`. Přidaný sloupec ani jeho hodnota NULL nejsou obnovením či důkazem historického ověření ARES.
- Role a serverová autorizace se nemění. Kontrola a zápis zákazníka i načítání fakturačních údajů a volitelných metadat zůstávají omezené na konkrétního zákazníka v aktivní firmě.

## Migrace a zachování dat

Migrace: `supabase/migrations/20261021071033_add_customer_ares_checked_at.sql`

Jedinou změnou schématu je přidání `public.customers.ares_last_checked_at timestamptz NULL` pomocí `ADD COLUMN IF NOT EXISTS`. Sloupec nemá default a neprobíhá backfill. Migrace nemění další schémata ani role.

SHA-256 přesného migračního souboru:

```text
CB0F4A6279B067E5935A772F5CF1A4111D348C9C05ABD633048064A04A346402
```

V testovacím projektu bylo potvrzeno:

| Kontrola | Výsledek |
| --- | --- |
| Počet zákazníků před a po migraci | 9 → 9 |
| Otisk dosavadních sloupců, bez nového sloupce | `70f84b36b0afa2814d995dfab889ef5e`, beze změny |
| Hodnoty nového timestampu | všech 9 hodnot NULL |
| Definice sloupce | nullable, bez defaultu |
| Databázové advisors | beze změny |

Po záloze byl v migrační historii pouze sjednocen automaticky vytvořený identifikátor `20261021071251` s verzí souboru `20261021071033`.

Privátní důkazní artefakty zůstávají oddělené od repozitáře; tento dokument neobsahuje jejich obsah ani zákaznická data. Identifikační SHA-256:

| Artefakt | SHA-256 |
| --- | --- |
| Preflight | `c027b37fc5465e443fb0905c6c26ba45fc00adf677183b26e16521a539203460` |
| Zachování dat po migraci | `28414d468117bd0e9329c2ff31a2573884f939f8b11812f9dc729a5915d7c06a` |

## Ověření aplikace a lokální migrace

| Ověření | Výsledek |
| --- | --- |
| Úplná testovací sada | 72 souborů, 1886 testů PASS |
| Cílené testovací sady | 18 + 55 PASS |
| TypeScript (`tsc`) | PASS |
| Produkční build | 107/107 PASS |
| Lokální SQL testy migrace | 16/16 PASS |

Lokální SQL ověření používá skutečný migrační soubor nad dvěma variantami schématu: bez sloupce a s již existujícím timestampem. V každé variantě se migrace aplikuje dvakrát. Kontroly potvrzují zachování počtu i všech dosavadních údajů zákazníků, NULL při původně chybějícím sloupci, zachování existujícího času a nullable definici bez defaultu.

Testovací soubory:

- `supabase/tests/customer-ares-timestamp.sql`
- `scripts/test-customer-ares-timestamp-sql.mjs`

Lokální testy, typová kontrola a build nenahrazují dosud neprovedené ověření nasazeného rozhraní. Po PR a CI zbývá ověřit vytvoření, úpravu a opětovné načtení zákazníka v aktivní firmě se zachovanými fakturačními údaji a pravdivým chybovým stavem.

## Oddělený blocker kalkulací

Kalkulační tok má samostatný problém se schématem `internal_note` a položek, s RLS a s neatomickým ukládáním. Tato změna jej neopravuje a nepředstavuje dokončení celého procesu zákazník → kalkulace → nabídka.
