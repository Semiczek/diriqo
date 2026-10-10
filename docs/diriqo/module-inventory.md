# Inventura Diriqa před implementací

Datum 10. 10. 2026. Zadání v0.1 je beze změn v `source-specification-v0.1.txt` (SHA-256 `29FEA5E76BA572792E9A442A091685B62408E7DFE714C782B049AFD923AA887E`). Inventura popisuje výchozí stav; pozdější změny a výsledky patří do `implementation-status.md` a `acceptance-report.md`.

## Přesné zdroje a pracovní kopie

| Úloha | Repo / revize |
|---|---|
| Cíl Diriqo | `Semiczek/diriqo`, `208c9ead6dface1b0a25bfedd71ff398eb9dd480` |
| Zdroj Hub | `jspdhubhotovy`, `7aa079882a87f0cb7619009dfc7061c1e1eb9058` |
| Izolovaná implementace | Složka `diriqo/` tohoto workspace, větev `codex/diriqo-platform-foundation`, shodný výchozí Diriqo commit |

Zdrojové checkouty byly při inventuře čisté. Nová kopie vznikla z Git HEAD bez `.env.local`, build výstupů, pracovních změn a zákaznických dat. Její origin je původní `https://github.com/Semiczek/diriqo.git`. Nejde o fork Hubu. Dřívější audit a jeho živé důkazy jsou uvedeny zvlášť; samotné odkazy na testy nejsou nové výsledky testů.

## Mapa požadavků

Podrobné tabulky obsahují obrazovku, symbol, tabulku, migrační řetězec, guard, dostupný test a přesnou mezeru. Jsou rozděleny pouze kvůli délce:

- [Jádro C01–C10](inventory/core.md): zakázky, zákazníci, pracovníci, čas, kalkulace a jednoduché nabídky, plánování, absence, zaměstnanecké zálohy, soubory a ekonomika.
- [Platforma a obchodní model](inventory/platform.md): identita, nároky, ceny, role, země, životní cyklus a společné scénáře P01–P25.
- [Doplňky M01–M06 a pozdější oblasti](inventory/addons.md): sklad, fakturace/OCR, chytré nabídky, vozidla, Android POS, AI, finanční původ a kapitoly 6–11.

`Existuje` znamená dohledanou dílčí implementaci, `částečně` konkrétní funkční mezeru, `chybí` nenalezenou implementaci v cíli a `vyžaduje ověření` chybějící provozní nebo integrační důkaz. Není-li doložené pořadí samostatných SQL patchů nebo živý katalog, poslední soubor **není** vydáván za poslední skutečně aplikovanou definici.

## Zásadní závěry pro pořadí práce

1. Zachovat Diriqo Auth, firmy, memberships, DAL, zákazníky a existující core. `worker_payment_settings` už má firemní sazby; mezera je také v použití globálních fallbacků a historických snímcích, nikoli v absolutní neexistenci firemní konfigurace.
2. `getCompanyModules` je preference s výchozím povolením a zápisem při čtení. Nová licence musí být explicitní samostatný nárok. Existující EUR tarify se automaticky nepřevádějí do nového CZK katalogu.
3. Před připojením nových licencí oddělit platformního administrátora od uživatelsky spravovatelné firemní role. Zajistit všechny přímé DB/RPC cesty. Pure TypeScript registr tuto hranici neopravuje.
4. Jednoduché nabídky jsou součástí jádra. Sklad, AI a fakturace nesmějí být nutné pro ruční kalkulaci a dokončení zakázky. Legislativní payroll není nový core.
5. DiriPOS může využít silný zdroj `apps/android-pos`; Expo aplikace pracovníka není pokladna. Samostatné nároky po pokladně, bounded offline oprávnění a celý produktový onboarding teprve chybějí.
6. Zdroj Hubu přebírat po doménách spolu s transakcemi, RLS a testy. Skladové korekce jsou připojené události, nikoli mazání. Kód a syntetické fixtures jsou jiný rozsah než import živých dat.

Všech 73 původních akceptačních scénářů je zachováno v `acceptance-scenarios.json` a `acceptance-report.md`. Zveřejněný ceník, podporovaný terminál ani zahraniční daňový režim nejsou odvozeny z pouhého názvu produktu.
