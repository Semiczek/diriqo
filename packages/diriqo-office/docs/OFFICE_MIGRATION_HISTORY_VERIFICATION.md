# Office: provedení migrací a ověřená historie

Stav 12. 10. 2026 v 10:34:49 UTC: **Hub i Diriqo mají ověřený výsledný katalog a čtyři přesné migrační záznamy**. Strojový souhrn je `reports/office-history-verification/production-catalog-history-final.json`. Tato kontrola není potvrzením dokončeného webového nasazení, přihlášeného UI ani fyzické pokladny.

Migrační SQL a doplnění historie provedl hlavní agent odděleně v přihlášeném Chrome dashboardu. Zde zaznamenané nezávislé ověření provedlo výhradně čtení. Technicky neúspěšné pokusy MCP `apply_migration` nejsou vydávány za úspěšnou migraci.

| Host | Produkční projekt | Ověřené položky katalogu | Přesné záznamy historie |
| --- | --- | ---: | ---: |
| JSPD Hub | `yrxfozthravgbbcqklzy` | 265 / 265 | 4 / 4 |
| Diriqo | `wfcpfraxiuhuglnuaxqj` | 262 / 262 | 4 / 4 |

Oba servery hlásí PostgreSQL 17.6. Neexistuje firma bez Office settings ani neověřený legacy snapshot. Všechna kontrolovaná těla funkcí, sloupce, constrainty, indexy, triggery, RLS a účinná oprávnění `anon`/`authenticated` odpovídají očekávanému katalogu. Vlastníkem Office funkcí je `postgres`. Výstupy neobsahují firemní dokumenty, hesla ani tokeny.

## Postup a identita zdroje

1. `scripts/prepare-office-history-verification.mjs` porovnal osm migračních souborů s SHA-256 z úspěšného lokálního SQL testu a s obsahem aktuálních Git revizí. Sdílený zdroj i distribuovaný archiv zůstaly shodné s manifesty obou hostů.
2. Generátor provedl přesné čtyři migrace každého hostu v nové izolované databázi PGlite a sestavil očekávaný technický katalog. Nepřipojuje se ke vzdálené databázi. Nová závislost nebyla instalována.
3. Po skutečném UI provedení všech čtyř souborů se nezávisle přečetl produkční katalog. Diriqo prošlo porovnáním na serveru; u Hub byl po technickém selhání velkého dotazu přečten samotný katalog krátkým dotazem a porovnán lokálně. Oba výsledky mají `matches=true`, `differences=[]`.
4. Teprve následně hlavní agent spustil připravený guarded history draft. Jeho transakce znovu kontroluje katalog a migrační/backfill stav. Historii zamkne a existující odlišný záznam odmítne chybou, bez přepsání.
5. Poslední nezávislý živý SELECT ověřil verzi, název, počet položek `statements`, délku v UTF-8 bytech a SHA-256. Všech osm řádků má stav `EXACT`. Hash použitých draftů byl poté znovu ověřen jako nezměněný.

Každý řádek historie obsahuje celý přesný lokální soubor v `statements[1]`. Base64 transport a PostgreSQL `decode` zachovaly UTF-8 i původní konce řádků; migrační zdroj se při zápisu historie znovu nespouštěl. Pole `created_by`, `idempotency_key` a `rollback` nebyla domýšlena. Opakování návrhu a odmítnutí konfliktní historie i změněného `SECURITY DEFINER` byly předem otestovány v lokální databázi.

## Soubory důkazů

- `reports/office-history-verification/manifest.json`: přípravný manifest, přesné názvy a SHA-256 migračních souborů a draftů. Jeho stav `PREPARED_NOT_APPLIED` je historický stav generování, nikoli aktuální stav produkce.
- `*-production-catalog-raw.json` a `*-production-catalog-result.json`: nezávislé výsledky katalogu před doplněním historie. Tehdejší `MISSING` historie zůstalo zachováno jako historický důkaz.
- `*-production-history-raw.json`: následný živý readback všech přesných záznamů.
- `production-catalog-history-final.json`: aktuální souhrn se stavem `VERIFIED_CATALOG_AND_RECONCILED_HISTORY`.
- `*-history-live-readonly.sql`: krátké read-only dotazy použité pro konečné ověření.

Katalogová kontrola toleruje pouze CRLF normalizaci textu funkcí při průchodu SQL editorem; uložená historie musí být bytově přesná. Kvůli přenositelnosti PostgreSQL 17/18 se NOT NULL kontroluje přes `pg_attribute.attnotnull`, protože PostgreSQL 17 tyto tabulkové podmínky v `pg_constraint` neukládá. Viz [PostgreSQL 17: pg_constraint](https://www.postgresql.org/docs/17/catalog-pg-constraint.html). Oprava migrační historie je samostatná operace od provedení SQL; viz [Supabase: migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair).

Při případné budoucí odchylce katalogu nebo historie se nesmí důkaz přepsat ani nový zdroj označit za již provedený. Nejprve je nutné odchylku vyhodnotit vůči konkrétní revizi. Samotná shoda výsledného katalogu neprokazuje každou historickou mezikrokovou operaci; proto je v této evidenci oddělené pozorované UI provedení, katalog a následná historie.
