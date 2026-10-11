# Diriqo Office – větev pro ověření a nasazení

Office je připravené na větvi `codex/office-menu-release`. Integrace navazuje na JSPD Hub `701da614` a Diriqo `915705d5`. Tento dokument ani zelené CI neznamenají zapnutí Office v produkci. Přesný výsledný commit a odkaz na PR zaznamená předání větve.

## Jedno sdílené jádro

Kanonické zdroje jsou v `Semiczek/diriqo`, složce `packages/diriqo-office`. Hub i Diriqo používají totožný `vendor/diriqo-office-0.1.0.tgz`, SHA-256 `fc8b602dc57267f504bbd4d02788b8dc349f4cb03d282fe62008e9d0538e5c5a`. Hub nevytváří druhou implementaci editorů. `vendor/office-source.json` obsahuje repozitář, větev, cestu a neměnný obsahový otisk zdrojů; `SOURCE_MANIFEST.json` v kanonické složce dokládá jednotlivé soubory. Revizi určuje obalující Git commit, bez neřešitelného odkazu commitu na sebe sama.

Samostatné CI Diriqo kontroluje úplný Office lockfile a zachované licence **před instalací**, potom spouští všechny sdílené testy, build a bajtové porovnání 38 runtime souborů s archivem. Hostitelská kontrola navíc odmítá zakázané či neznámé licence i po přepočtení hashů archivu/evidence/SBOM a hlídá nezměněný původní graf závislostí. Historické hostitelské a cloudové testy nejsou automaticky důkazem nového commitu.

## Migrace a zapnutí pro firmu

Použijte pouze soubory konkrétního hostitele, v tomto pořadí:

| Krok | Hub | Diriqo |
| --- | --- | --- |
| Jádro a hostitelský adaptér | `20261011140000_diriqo_office.sql` | `20261011140000_diriqo_office.sql` |
| Normalizace úložiště | `20261011184841_diriqo_office_normalized.sql` | `20261011184909_diriqo_office_normalized.sql` |
| Oprava odloženého COMMIT | `20261011185515_diriqo_office_receipt_commit.sql` | `20261011185523_diriqo_office_receipt_commit.sql` |

Soubory jsou v `supabase/migrations`. První soubor má v každém produktu jiný autorizační adaptér: nelze je zaměnit. Již aplikovanou migraci nepřepisujte ani neopakujte; u prostředí se starší verzí porovnejte katalog a připravte samostatnou přídavnou migraci. Pořadí je **core + adaptér → normalizace → receipt commit**. Migrace jsou přídavné a změny zde neprovádějí jejich aplikaci do produkce.

Office je výchozně vypnuté samostatně pro každé `company_id`. Chybějící nastavení i chyba autorizační kontroly znamenají odmítnutí. Správce v JSPD Hub otevře **Nastavení Office** v menu (`/office/settings`, existující role `super_admin`). V Diriqo najde oprávněný platformový administrátor odkaz v **Nastavení → Firma** (`/settings/company` → `/office/settings`); samotná běžná firemní role platformový přepínač neopravňuje měnit.

Po zapnutí pro ověřenou aktivní firmu se zobrazí položka **Diriqo Office** (`/office`). Server u každého čtení, zápisu, exportu a schválení znovu ověřuje identitu, aktivní členství, roli, firemní ID a zapnutí modulu. Předání `companyId` z formuláře samo o sobě oprávnění nedává. Vypnutí zachová dokumenty a zablokuje operace. Změna firmy v jiném panelu nesmí přenést rozpracovaný dokument do nové firmy.

## Bezpečný online test této větve

`vercel.json` explicitně vypíná automatické Git deploymenty **pouze pro větev `codex/office-menu-release`**. Důvodem je možnost, že připojený běžný Vercel projekt má v Preview prostředí produkční Supabase proměnné. Samotný push tedy nemá spustit preview nad produkční databází. Neodstraňujte tuto ochranu, dokud nejsou cílový projekt a všechny proměnné ověřené. Kód neprovádí žádnou automatickou migraci ani zapnutí firem.

Pro online zkoušku jsou určeny pouze existující oddělené Office stagingy:

- JSPD Hub: https://office-staging-bnp1tlyrl-jspdholding-7510s-projects.vercel.app/office
- Diriqo: https://office-staging-diriqo-k52ri8idb-jspdholding-7510s-projects.vercel.app/office

Tyto odkazy zachycují poslední ověřené stagingové deploymenty; samy nedokládají nasazení dalších změn této Git větve. Staging je povolen do **12. 10. 2026 19:00 Praha**, úklid databázových větví je naplánovaný na **18:55**. Po úklidu nebudou odkazy funkční a nová testovací infrastruktura vyžaduje nový provozní/budgetový souhlas. Přístupové údaje, servisní klíče a testovací účty nejsou v Gitu.

## Kasa a hranice ověření

Office má samostatné routy, tabulky, oprávnění a přepínač firmy. Pokladní zdroje, stock pohyby, párování zařízení a terminálové API nejsou součástí změn Office. Sdílené dotčené části (menu, aktivní firma, proxy a příjmové limity hostitele) musí projít regresními testy proti výslednému commitu, nikoli pouze proti starému integračnímu základu.

Nové UI v připojeném Chrome **není vizuálně ověřené**; uživatel dokončení s tímto omezením schválil. Dřívější kontrola PDF/tiskového rozložení nepotvrzuje fyzickou pokladnu, platební terminál, tiskárnu, zásuvku ani tiskový dialog. Produkční funkčnost těchto zařízení se neprohlašuje. Zděděné bezpečnostní nálezy hostitelských modulů mimo Office mají vlastní kontrolu před produkčním rolloutem.

Návrat: nejprve vypněte Office pro konkrétní firmu přes autorizované nastavení, ponechte uložená data a vraťte aplikační verzi. Databázové tabulky ani historii nesmazávejte. Zpětný převod normalizace má samostatné přísné podmínky v kanonickém `docs/NORMALIZED_PERSISTENCE.md`; nelze slepě vrátit staré zapisující klienty nad nově vzniklá data.
