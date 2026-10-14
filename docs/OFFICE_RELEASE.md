# Diriqo Office – aktuální rozšíření 0.3.4

Aktuální hostitelská větev je `codex/office-import-release`, vychází z Diriqo main `ac07949537852d02fa69654433eb6353db052a1f`. Používá stejné sdílené jádro jako JSPD Hub: `vendor/diriqo-office-0.3.4.tgz`, SHA-256 `f293524d6fa5f9382a06f8e685d04f79898932d9c85cce0fedcc8df29961d9c0`. Kanonické zdroje jsou `packages/diriqo-office`; aktuální doklady původu, licencí a SBOM jsou součástí balíčku.

## Funkce a hranice této verze

- Import DOCX, ODT, DOC, XLSX, ODS, XLS, CSV, TSV, TXT a HTML. DOC převádí pouze text; XLS má omezení vzorců a kompatibility popsaná ve sdílené dokumentaci.
- Export dokumentů DOCX, ODT, PDF, TXT a HTML; tabulek XLSX, ODS, XLS (pouze hodnoty), CSV a TSV. Tisk zůstává samostatnou operací.
- ODT přijímá prázdné neaktivní forms a historický odkaz na šablonu v metadatech. Externí zdroje nenačítá; aktivní formuláře, makra a nebezpečné objekty odmítá.
- XLSX zachovává podporovanou část SUBTOTAL a odkazy na listy s českými názvy. Nepodporované varianty, filtrování a skryté vstupní řádky se nesmějí tiše vypočítat nesprávně; přesná omezení jsou v `packages/diriqo-office/docs/ALTERNATIVE_FORMATS.md` a testech.
- Návrat z výběru souboru již neruší rozpracovaný import při nezměněné firmě. Skutečná změna firmy nebo identity nadále pozastaví operace.
- Chyby importu rozlišují formát, nebezpečný obsah, limity a provozní selhání. Uživatelské zprávy jsou oddělené od kódu pro sedm jazyků. Originální soubor se uchovává beze změny.

## Nasazení Diriqo

Při obnově prostředí před nasazením aplikace aplikujte `supabase/migrations/20261014033100_office_alternative_export_formats.sql` do ověřeného Diriqo prostředí. Migrace mění pouze jediný známý exportní seznam ve stávající funkci `public.office_request(uuid,jsonb,text)`. Neočekávanou definici odmítne a při opakování nic nemění; zachovává ACL, vlastníka, SECURITY DEFINER, search_path i veškeré firemní kontroly. Nespouští migrace ostatních modulů. Návrat aplikace nevyžaduje mazání dat ani odebrání nových formátů.

Hostitelská oprávnění Diriqo se nemění. Sdílené volitelné UI pro sdílení nedoplňuje do Diriqo automaticky Hub organizační model. Rozšíření nemění kód pokladny, její API, zásoby ani platební operace.

Produkční Diriqo přijalo tuto migraci 14. 10. 2026 v 03:31 UTC pod verzí `20261014033100`. Verze souboru odpovídá záznamu Supabase. Kontrola technického schématu potvrdila pouze změnu exportního seznamu: MD5 definice před změnou `202ce9f3729341822236ceb5bf493043`, po změně `9c5eb26a12dff50a4148999cb22af8e0`; po normalizaci seznamu je otisk totožný s původním. OID 24332, vlastník, ACL, SECURITY DEFINER a search_path zůstaly stejné. Firemní záznamy nebyly pro tuto kontrolu čteny ani upraveny.

## Doložené ověření

- Sdílené jádro: 281 úspěšných testů před zabalením 0.3.4.
- Diriqo host: 55 cílených testů importu, chyb, souběhu a firemních hranic; opravené testy pořadí hostitelské autentizace byly znovu úspěšně spuštěny.
- Databázová migrace: 2/2 testy, včetně skutečného izolovaného PostgreSQL/PGlite s testovacími uživateli dvou firem, změnou identity, vypnutým modulem, exportním auditem, zachováním obsahu a oprávnění, idempotencí a odmítnutím neočekávaného schématu. Bez připojení k produkci.
- Kontrola hostitelského balíčku, licencí, fontů, SBOM a nezměněných závislostí úspěšná. Kontrola stylu změněných TypeScript souborů úspěšná.
- Čtyři uživatelem dodané XLSX prošly místním importem i průchodem editorovým adaptérem beze změny originálů. Soubory a jejich obsah nejsou součástí Gitu. Konkrétní uživatelský ODT nebyl dodán; ODT pokrývají syntetické testy.
- Úplná kontrola typů, build, hostitelské testy a opakování sdílených testů úspěšně proběhly v CI pro commit `dca3592a9fcb7e77f349cc5d5986df6196bb3f20`; CI ověří také konečný commit PR. Místní úplná kontrola typů byla ukončena paměťovým stropem 512 MiB; kvůli požadavku šetřit RAM se lokálně neopakuje.
- Přihlášený průchod novou produkční verzí v Chrome není ověřen. Úspěšné CI a READY deployment samy nenahrazují tento důkaz.

Přesný výsledný main commit, stav CI a nasazení uvádí PR a předání. Následující oddíl zachovává historický postup prvního zapojení; jeho starší verze archivu a stagingové termíny nejsou aktuálním nasazením.

---

# Diriqo Office – větev pro ověření a nasazení

Office je připravené na větvi `codex/office-menu-release`. Diriqo větev zahrnuje také aktuální hostitelský základ `b411fdab`. Tento dokument ani zelené CI neznamenají zapnutí Office v produkci. Přesný výsledný commit a odkaz na PR zaznamená předání větve.

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
| Office v základu všech firem | `20261012091200_office_base_for_all_companies.sql` | `20261012091204_office_base_for_all_companies.sql` |

Soubory jsou v `supabase/migrations`. První i poslední soubor mají v každém produktu jiný autorizační adaptér: nelze je zaměnit. Již aplikovanou migraci nepřepisujte ani neopakujte; u prostředí se starší verzí porovnejte katalog a připravte samostatnou přídavnou migraci. Pořadí je **core + adaptér → normalizace → receipt commit → Office v základu**. Migrace jsou přídavné a změny zde neprovádějí jejich aplikaci do produkce.

Office je základní součást obou produktů pro všechny existující i nově založené firmy. Samostatná přídavná migrace doplní zapnuté Office existujícím firmám bez nastavení a zajistí výchozí nastavení při založení nové firmy. Již uložené nastavení, včetně výslovného vypnutí firmy, zachová. Nevyžaduje nákup modulu ani placené oprávnění `core.files.upload`; ostatních placených operací a DiriPOS se tato výjimka netýká. Původní tři migrace samotné tuto změnu nezajišťují.

Pro každé `company_id` zůstává samostatný provozní přepínač. Chybějící nastavení i chyba autorizační kontroly nadále znamenají odmítnutí. Správce v JSPD Hub otevře **Nastavení Office** v menu (`/office/settings`, existující role `super_admin`). V Diriqo najde oprávněný platformový administrátor odkaz v **Nastavení → Firma** (`/settings/company` → `/office/settings`); samotná běžná firemní role platformový přepínač neopravňuje měnit.

Po zapnutí pro ověřenou aktivní firmu se zobrazí položka **Diriqo Office** (`/office`). Server u každého čtení, zápisu, exportu a schválení znovu ověřuje identitu, aktivní členství, roli, firemní ID a zapnutí modulu. Předání `companyId` z formuláře samo o sobě oprávnění nedává. Vypnutí zachová dokumenty a zablokuje operace. Změna firmy v jiném panelu nesmí přenést rozpracovaný dokument do nové firmy.

V Diriqo mají `super_admin` a `company_admin` roli vlastníka Office, `manager` roli editora a `worker` roli čtenáře. Zařazení do základu nezvyšuje uživatelská oprávnění: čtenář nemůže zapisovat a uživatel bez aktivního členství nemůže číst ani cizí firmu vybrat. Regresní testy `scripts/office-release.test.mjs` ověřují přístup bez zakoupeného doplňku ve dvou firemních kontextech, odmítnutí neplatné identity a vypnutého modulu i zachování placených bran ostatních operací. Tyto testy používají syntetické autorizační porty; nejsou důkazem aplikované produkční migrace.

## Ověření nasazení

`vercel.json` explicitně vypíná automatické Git deploymenty **pouze pro větev `codex/office-menu-release`**. Důvodem je možnost, že připojený běžný Vercel projekt má v Preview prostředí produkční Supabase proměnné. Samotný push této větve tedy nemá spustit preview nad produkční databází. Tato ochrana se nevztahuje na automatické nasazení `main`. Kód neprovádí žádnou automatickou migraci ani zapnutí firem.

Odkaz pro online zkoušku použijte z aktuálního předání: deployment musí být ve stavu READY a odpovídat výslednému Git SHA. Historické stagingové adresy nedokládají novější kód. Oddělený staging je povolen do **12. 10. 2026 19:00 Praha**, úklid databázových větví je naplánovaný na **18:55**. Po úklidu nebude dostupný a nová testovací infrastruktura vyžaduje nový provozní/budgetový souhlas. Přístupové údaje, servisní klíče a testovací účty nejsou v Gitu.

V produkci nenastavujte `OFFICE_STAGING_ONLY` ani další dočasné stagingové proměnné. Po nasazení ověřte příslušné čtyři migrace, firemní nastavení a přihlášený průchod menu → dokument → uložení → opětovné otevření. Úspěšný aplikační build nebo READY deployment sám nepotvrzuje stav databáze.

## Kasa a hranice ověření

Office má samostatné routy, tabulky, oprávnění a přepínač firmy. Pokladní zdroje, stock pohyby, párování zařízení a terminálové API nejsou součástí změn Office. Sdílené dotčené části (menu, aktivní firma, proxy a příjmové limity hostitele) musí projít regresními testy proti výslednému commitu, nikoli pouze proti starému integračnímu základu.

Office obsahuje také globální styly spreadsheetu a tisková pravidla `@page`. Vstup z menu či nastavení i návrat z editoru proto používají nativní odkazy a plné načtení stránky. Tím při přechodu nevzniká společný dokument s CSS načteným z Office a pokladny. Tyto odkazy nenahrazujte klientským `next/link` ani `router.push`; standardní navigace DiriPOS zůstává zachovaná. Přihlášení již používá `window.location.assign` a obnova panelu otevírá Office nativním odkazem v novém panelu. Test `scripts/office-release.test.mjs` ověřuje skutečné typy vykreslených odkazů, zachování menu callbacku, firemního kontextu i původního POS odkazu. Jde o kontrolu aplikačního kontraktu, nikoli důkaz tisku na fyzické pokladně.

Stejnou hranici zachovávají právní odkazy v globálním cookie banneru i jeho nastavení: na `/office` a podřízených Office cestách jsou nativní, na ostatních stránkách včetně DiriPOS ponechávají původní klientskou navigaci. Nejde o změnu souhlasu s cookies ani o zapnutí analytiky.

Nové UI v připojeném Chrome **není vizuálně ověřené**; uživatel dokončení s tímto omezením schválil. Dřívější kontrola PDF/tiskového rozložení nepotvrzuje fyzickou pokladnu, platební terminál, tiskárnu, zásuvku ani tiskový dialog. Produkční funkčnost těchto zařízení se neprohlašuje. Zděděné bezpečnostní nálezy hostitelských modulů mimo Office mají vlastní kontrolu před produkčním rolloutem.

Návrat: nejprve vypněte Office pro konkrétní firmu přes autorizované nastavení, ponechte uložená data a vraťte aplikační verzi. Databázové tabulky ani historii nesmazávejte. Zpětný převod normalizace má samostatné přísné podmínky v kanonickém `docs/NORMALIZED_PERSISTENCE.md`; nelze slepě vrátit staré zapisující klienty nad nově vzniklá data.
