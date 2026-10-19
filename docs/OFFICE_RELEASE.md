# Diriqo Office – kandidát 0.3.5 (19. 10. 2026)

Aktuální změna je na větvi `codex/diriqo-office-inventory-workspace`, nad základem Diriqo main `b0a6da013b`. **Aplikační kandidát zatím není nasazený a přihlášené ověření nové obrazovky v prohlížeči čeká.** Následující výsledky rozlišují lokální balíček, testy a databázovou ochranu; historická nasazení níže nedokládají tuto verzi.

## Rozhraní a firemní kontext

Office přebírá uspořádání ověřené proti zdroji JSPD Hub `origin/main` v revizi `2ca84af`: úzkou levou navigační lištu, rozbalení nebo připnutí nabídky a velkou pracovní plochu dokumentu. Používá skutečné logo Diriqo a jeho paletu. Výchozí náhradní logo „d.“ a duplicitní hlavička balíčku jsou v hostiteli skryté. Firma a její přepnutí jsou v kompaktní nabídce; mobilní navigace má samostatné otevírání, zavření a ovládání klávesnicí.

Navigace zůstává odvozená od rolí a dostupných modulů Diriqo. Kopírování vzhledu nezavádí Hub organizační model ani vyšší oprávnění. Dokument je připnutý k původní firmě a identitě; změna firmy, role nebo dostupnosti kontextu pozastaví operace. Návrat z výběru souboru při nezměněné firmě rozpracovaný import neruší. Serverové ověřování identity, členství, aktivní firmy a oprávnění zůstává zachované. Přechody mezi Office a ostatními agendami nadále používají plné načtení dokumentu kvůli izolaci stylů editoru.

## XLSX a skutečné soubory FNOL

Import rozpozná SpreadsheetML namespace i s XML prefixy a rozvine sdílené vzorce včetně relativních, absolutních a smíšených odkazů. Neúplná nebo neplatná skupina sdílených vzorců se odmítne; vzorce se tiše nezplošťují na hodnoty. Chyby vzorců mají srozumitelné zprávy místo holého `OFFICE_FORMULA_LIMIT`.

Lokálně bylo znovu importováno všech pět uživatelem určených FNOL XLSX. Originály se nezměnily a nejsou v repozitáři:

| Soubor | Výsledek |
| --- | --- |
| FNOL_B_kalkulace_2028 | Editovatelný; 236 výsledků vzorců odpovídá hodnotám uloženým Excelem. |
| FNOL_SO01_samostatne_pevna_okna_a_svetliky | Editovatelný; 10 výsledků vzorců odpovídá uloženým hodnotám. |
| Vycisteni_budov_FNOL_B_s_okny | Editovatelný; 20 výsledků vzorců odpovídá uloženým hodnotám. |
| FNOL_B_detailni_soupis_pro_naceneni | Náhled pouze pro čtení; zachováno všech 5 972 vzorců a jejich uložené výsledky. |
| FNOL_B_pracovni soubor | Náhled pouze pro čtení; zachováno všech 5 972 vzorců a jejich uložené výsledky. |

U tří editovatelných sešitů tedy souhlasí 266/266 porovnaných výsledků. U všech pěti prošlo zachování vzorců i uložených výsledků přes XLSX export a opětovný import. Každý velký sešit obsahuje přibližně 12,1 milionu referenčních přístupů; běžný přepočet Fortune u něj není dostatečně spolehlivý. Náhled proto zobrazuje uložené hodnoty bez spuštění výpočtů a nabízí zachovaný originál pro úpravy v Excelu. Nejde o dokončenou plnou editaci těchto dvou sešitů ani o úplnou věrnost formátování Excelu.

Režim náhledu se ukládá jako `workbook.officeCalculationMode = cached-readonly-v1`. Zápis obsahu, návrh AI, schválení a obnovení obsahu blokuje editor i aplikační služby; přejmenování, přesun, kopie a export zůstávají dostupné. Původní interaktivní rozpočet 2 000 vzorců / 200 000 referenčních přístupů se nezvýšil. Import má samostatně ohraničenou analýzu grafu. Přesná omezení a důkazy jsou v [dokumentaci kompatibility](../packages/diriqo-office/docs/XLSX_IMPORT_COMPATIBILITY.md).

Databázová ochrana je aplikovaná v testovacím Diriqu jako `20261019071710_office_cached_preview_guard.sql`, SHA-256 `eaba6e1c6c61a6be3c2c3a29a151bd796cafd03ce693951d8a12c8c3bf471c57`. Dva privátní triggery chrání obsah a návrhy i před přímým authenticated RPC nebo starším klientem. Hosted ověření: 16 scénářů + 14 kontrol rollbacku PASS; místní SQL: 34 + 3 PASS. Původní dva soubory a čtyři verze zůstaly nezměněné; otisk dat i definice/OID/owner/ACL veřejného RPC jsou shodné před a po. Soukromý preflight SHA-256 `7329ff29086e5de8efec7563bfdd44a570d1926584ad530b39b3a15437240bd6`, hosted důkaz `7b8d43c8b74d5d4878b1cba9c989c58e7276be4d797ff0951bbb0c381efd1cc1`. Cílený preflight není úplná záloha produktu.

## Balíček a doložené ověření

- Runtime: `vendor/diriqo-office-0.3.5.tgz`, SHA-256 `457614b65d35c036980308149e9b44d97ca7508c79a004d59d0f18d9cdd11e5d`.
- Kanonický zdroj: `packages/diriqo-office`; manifest 563 souborů, obsahový SHA-256 `954788fba553c9940e3fc663f05cb077e4acf0cbbf1ba4e279f5175504f797fa`. Vazbu dokládá `vendor/office-source.json`.
- Office source suite: 293/293 PASS; TypeScript PASS. Hostitelské testy mapování chyb importu: 6/6 PASS.
- Znovusestavení ověřilo všech 47 runtime souborů proti archivu. Licenční preflight a jeho kontrola prošly pro 130 přesných artefaktů; změnila se identita verze, nikoli graf závislostí.
- Výsledná hostitelská integrace: 1 740 Vitest testů / 66 souborů PASS, 61 Office host testů PASS (včetně samostatně zopakovaného SQL export testu s PGlite 0.5.8), uncached TypeScript a webpack build 107 stránek PASS. ESLint bez chyb, čtyři zděděná varování navigace. Git/CI a přihlášený průchod budou doloženy výsledným vydáním.

Uložené výsledky vzorců jsou cache z původního souboru, nikoli nový výpočet či finanční ověření. Office import není OCR ani automatické zaúčtování materiálu. OCR příjem skladu má samostatný kontrolovaný tok: návrh položek → lidské spárování a kontrola množství/cen → koncept příjemky → výslovné potvrzení skladu. Podrobnosti nové skladové plochy a její aplikované migrace uvádí [report skladu](inventory-workspace-20261019.md).

Při návratu použijte předchozí aplikační verzi, zachovejte dokumenty, originály a přídavné schéma. Označené náhledy nesmí starší zapisující klient zbavit ochrany; databázový guard je proto samostatnou podmínkou bezpečného přístupu takového klienta. Nemažte historii ani nepřehrávejte staré migrace.

---

## Archiv předchozích vydání

Následující reporty zůstávají zachované jako historické důkazy. Jejich označení „aktuální“, revize, testy a nasazení patří k uvedené starší verzi a nepřebírají stav kandidáta 0.3.5.

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
