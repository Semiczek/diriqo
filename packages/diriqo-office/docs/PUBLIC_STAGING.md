# Dočasný veřejný staging Office

Tento dokument popisuje izolované cíle a provozní omezení veřejného ověření. Výsledky skutečného nasazení, HTTP a Chrome scénářů uvádí [STAGING_ACCEPTANCE.md](STAGING_ACCEPTANCE.md) a `reports/validation.json`.

| Hostitel | Samostatný Vercel projekt | Povolená Supabase větev |
| --- | --- | --- |
| JSPD Hub | `office-staging-hub` | `amuhcvnvubsrvsfclqtg` |
| Diriqo | `office-staging-diriqo` | `pkjzoplczxqqmmstnqgy` |

Přesné Vercel project/team ID jsou v `reports/public-staging-targets.json`; branch ID, rodič a organizace v `reports/staging-targets.json`. `scripts/staging-public-target.mjs` spojuje oba manifesty s pevnou allowlist. Před síťovým testem vyžaduje skutečnou identitu deploymentu ve stavu READY, přesný HTTPS origin, čerstvé ověření a nevypršenou lhůtu. Původní manifest obsahující pouze názvy projektů proto nestačí. URL se nesmí přepsat argumentem testu ani proměnnou prostředí na libovolný cíl. Oba produkční refy jsou odmítané.

## Rozsah a přístup

- Nasazení mají Vercel API target `staging` a používají Preview proměnné v nových samostatných projektech, bez připojeného Git repozitáře a bez produkčních domén, propagace do produkce či změny existujících projektů.
- Serverové prostředí obsahuje pouze schválenou izolovanou Supabase URL a veřejný anon/publishable klíč potřebný pro běžné přihlášení. `service_role` ani jiný administrátorský klíč do deploymentu nepatří. JWT a autorizaci operací poskytuje skutečná aplikace; znalost veřejné URL není oprávnění k dokumentům.
- Aplikační Auth je povinný. Používají se syntetické identity a dvě syntetické firmy v každé oddělené větvi. Hostitelské tenant/role/capability kontroly zůstávají aktivní.
- Staging proxy omezuje dostupné aplikační cesty a dobu platnosti. Její přepínač je jen pro toto izolované ověření; není součástí oprávnění Office ani náhradou serverových tenant guardů.
- Testovací přihlašovací údaje zůstávají lokálně v soukromých `.staging/*.dual.json`. Tyto soubory, hesla, tokeny a environment soubory se nebalí, neposílají do reportů ani nevkládají do distribuovaného zdrojového archivu. Packer vybírá povolené zdrojové cesty a kontroluje obsah proti tajným údajům.

## Hub: názvy firem v Office přepínači

Aktuální Hub integrace potřebuje kromě společného Office jádra také `database/office-hub-adapter.sql`. Packer jej připojuje za jádro do Hub migrace `supabase/migrations/20261011140000_diriqo_office.sql`; do Diriqo patří jeho vlastní adaptér. Hub doplněk zavádí pouze read-only RPC `office_company_labels(uuid, uuid[])`, protože původní SELECT politika tabulky companies nezpřístupňuje manažerům názvy pro Office přepínač.

RPC ověřuje přihlášeného uživatele, existující Office kontext výchozí firmy a zapnutý modul. Ze seznamu nejvýše 100 neprázdných UUID vrátí pouze ID a název vyžádaných firem s aktivním členstvím uživatele a zapnutým Office. Nefunguje jako obecný seznam firem nebo rozšíření jejich tabulkových oprávnění. Má pevný search_path, zakázané spuštění pro PUBLIC/anon a povolené spuštění pouze pro authenticated; původní RLS, tabulkové granty a role se nemění. Jde o samostatnou databázovou závislost nové Hub UI, nikoli součást Diriqo ani automatickou produkční migraci. Před nasazením ověřte definici a granty v přesné staging větvi; příprava zdrojů není důkazem jejich aplikace.

## Limity transportu

Veřejný host používá konzervativní limity pod HTTP limitem poskytovatele:

| Operace | Limit |
| --- | --- |
| Nahraný soubor | 3 MiB = 3 145 728 bajtů |
| JSON požadavek/obsah operace | 3 800 000 bajtů |
| JSON odpověď včetně Base64 exportu | 4 350 000 bajtů |

Jde o limity skutečně serializovaných UTF-8 dat, nikoliv počty znaků. Base64 zvětšuje export přibližně o třetinu. Multipart má malou oddělenou rezervu pro pole formuláře. Při překročení host vrací `OFFICE_HOST_LIMIT`; větší obecný limit formátového adaptéru neznamená, že stejný soubor projde tímto hostingem. PDF, originály i importní worker je nutné ověřit přes skutečnou veřejnou HTTP cestu.

## Vypršení a úklid

Povolené okno končí **12. 10. 2026 v 17:00 UTC** (19:00 Praha). Na **16:55 UTC** (18:55 Praha) je určen úklidový heartbeat v nadřazeném úkolu. Úklid musí zkontrolovat přesné samostatné Vercel projekty a nové větve podle manifestů, odstranit jen tyto dočasné prostředky a ověřit jejich nepřítomnost. Produkční projekty a rodičovské databáze se nesmějí měnit.

Serverový guard vyžaduje `OFFICE_STAGING_ONLY=1`, schválený `OFFICE_STAGING_PROJECT_REF` a `OFFICE_STAGING_EXPIRES_AT=2026-10-12T17:00:00Z`. Chybějící či neplatné UTC datum nebo dosažení lhůty vrátí 503. Tyto staging-only proměnné se nikdy nenastavují v produkci; v běžném hostu má `OFFICE_STAGING_ONLY` zůstat nenastavené. Úplný konfigurační kontrakt je v [ENABLEMENT.md](ENABLEMENT.md).

Vypršení aplikačního guardu samo neodstraňuje prostředky ani nezastavuje jejich účtování. Úspěšné provedení heartbeat úklidu musí mít vlastní report; tento plán není potvrzením odstranění. Po úklidu se stagingové URL nesmějí prezentovat jako funkční demonstrační prostředí.

## Důkaz nasazení

`reports/public-staging-*-source.json` dokládá pouze připravené zdrojové soubory a jejich hashe. Úspěšný lokální build nepotvrzuje veřejný deployment. Akceptace musí zvlášť zaznamenat READY build, skutečné přihlášení, tenant izolaci a cross-tab změnu firmy, potvrzení obnovy verze, importní worker, stažení PDF a tiskový náhled. Podrobnosti PDF podmnožiny a dosavadního lokálního parse/render ověření jsou v [PDF_EXPORT.md](PDF_EXPORT.md).

`reports/public-staging-route-smoke.json` je samostatný anonymní GET průchod přes přesné deploymenty z manifestu: dostupnost loginu, odmítnutí Office/context/files bez relace a zablokování dashboardu i registrace. Neukládá cookies, přihlašovací údaje ani těla stránek a nesleduje přesměrování. Kontrola dokumentovaného data expirace není důkazem budoucího skutečného ukončení deploymentu; to vyžaduje pozdější ověření a úklid.
