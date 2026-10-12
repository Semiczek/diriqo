# Firemní úložiště Office v2

`database/office-normalized.sql` navazuje na Office core a správný hostitelský adaptér. Nahrazuje jeden velký JSONB stav firmy samostatnými privátními záznamy. Nemění autentizační systém hostitele ani podpis RPC `office_request`.

## Povinné firemní ID

Každá nová tabulka má `company_id NOT NULL`. Primární klíče, cizí klíče, vyhledávání i zámky zahrnují firmu. Verze odkazuje na `(company_id, file_id)`, originál na soubor i blob stejné firmy a účtenka na verzi/návrh téže firmy. Stejné ID souboru, hash originálu nebo idempotentní klíč v jiné firmě nevytváří sdílený přístup. Deduplikace originálů probíhá pouze uvnitř jedné firmy.

Host získává firmu z čerstvě ověřeného kontextu a kontroluje připnuté očekávané ID. Databáze znovu ověřuje autentizovanou identitu, členství, roli, AI principal a modul. Klientské pole `companyId` v obsahu požadavku není podporované. Aplikační role nemají přímý přístup k tabulkám; privátní schéma má také zapnuté RLS. Veřejné API je autorizované RPC, nikoli obecné CRUD nad tabulkami.

## Kapacita a souběh

Souhrnný limit 64 MiB z původního databázového adaptéru se v nové RPC cestě nepoužívá. Soubory, historické verze, návrhy, účtenky a audit nejsou přepisovány jako jeden firemní JSON. Uložení zamyká konkrétní dokument a jeho revizi; odlišné dokumenty jedné firmy se mohou ukládat souběžně. Změny struktury složek používají samostatný firemní zámek proti závodům a cyklům. Sdílený zámek nastavení modulu zajistí, že vypnutí počká na již autorizovanou operaci a následné operace odmítne.

Originály jsou neměnné `bytea` v privátním Postgresu, s SHA-256 a ověřenou velikostí; velké hodnoty ukládá PostgreSQL přes TOAST. Nejde o veřejný bucket ani o implementovaný Supabase Storage adaptér. Kopie dokumentů odkazují na stejný blob pouze v téže firmě. Externí cesta ani URL od klienta se k načítání nepoužívá.

Jednorázové limity zpracování zůstávají: v připravených hostech upload 3 MiB, JSON request 3 800 000 bajtů a response 4 350 000 bajtů. Zrušení souhrnného limitu není neomezený disk ani záruka výkonu při libovolném objemu. Databázový tarif, skutečně obsazený disk, zálohy a délku uchování historie je třeba provozně sledovat. Automatické mazání historie ani retenční UI se nezavádí; nesmí smazat požadované originály nebo podklady k auditu.

Lokální souborový/MemoryStore demo adaptér zachovává svůj ochranný limit 64 MiB. Nesmí být zaměněn za transakční úložiště obou SaaS hostitelů.

## Stránkované API

| Operace | Výsledek / kurzor |
| --- | --- |
| `listFiles` | Metadata souborů bez obsahu, `afterId`, `limit` 1–100, výchozí 50; podporuje složku, vyhledávání a `foldersOnly`. |
| `listVersions` | Metadata verzí sestupně, `beforeRevision`, limit 1–100. |
| `readVersion` | Jediná verze po ověření firmy a souboru. |
| `listProposals` | Metadata návrhů bez obsahu, `afterId`, limit 1–100. |
| `readProposal` | Jediný návrh po ověření firmy a jeho příslušnosti k souboru. |

`nextCursor` je řetězec nebo `null`. UI načítá další stránky výslovně; rozdíl AI načte až pro zvolený návrh. Staré hromadné operace zůstávají pro malé odpovědi a při překročení hranice vrátí `PAGINATION_REQUIRED`; nesmějí tiše ztrácet výsledky. Kurzory nepředstavují snapshot celé relace: nově vzniklé záznamy se zobrazí po obnovení seznamu.

## Migrace a návrat

Pořadí nasazení je `office-core.sql` → příslušný hostitelský adaptér → `office-normalized.sql` → `office-normalized-receipt-commit.sql`. Poslední přídavný krok je povinný: odložený trigger úplnosti účtenky se spouští při COMMIT, tedy až po návratu veřejného RPC. Má vlastní `SECURITY DEFINER`, pevný `search_path=pg_catalog` a žádný EXECUTE grant pro klientské role. Oprava nezpřístupňuje privátní schéma ani tabulky. Již aplikovanou normalizační migraci nepřepisujte; hostitelské složky obsahují oba samostatné kroky.

Tuto chybu zachytil až skutečný staging (SQLSTATE `42501` při zápisu); místní PGlite ji nereprodukovalo. Protokol `reports/database-receipt-commit-validation.json` proto odlišuje úspěšné místní kontroly opravené konfigurace od skutečného vzdáleného důkazu. Nepoužívejte lokální průchod jako tvrzení, že původní chyba byla lokálně reprodukována.

Migrace probíhá v jedné transakci. Původní `tenant_state` ponechá jako zamknutý firemní snapshot. Před přepnutím zrekonstruuje normalizované záznamy a porovná celý obsah, historii, návrhy, účtenky, audit i bajty originálů; chybná firma, vazba nebo originál migraci zruší. Neodstraňuje existující obchodní tabulky ani uživatelské role.

Před aplikací pořiďte standardní databázovou zálohu a ověřte prostor na dočasně zdvojená data. Migrace používá exkluzivní zámek legacy tabulky: pro větší databáze je nutné plánované servisní okno. Původní snapshot nepředstavuje průběžnou repliku nové persistence.

Privátní `rollback_normalized_company(company_id)` dovoluje návrat pouze před novou aktivitou firmy po přepnutí a po ověření hashe snapshotu. Po nové aktivitě návrat odmítne, aby neztratil změny. V takovém případě modul vypněte a opravujte vpřed nebo obnovujte podle schváleného zálohovacího postupu; nikdy prostě nezapínejte starý RPC kód nad zastaralými daty. Návrat musí provádět administrátor v řízeném migračním kroku, ne klient.

## Důkazy

Lokální testy `tests/database-normalized-runner.mjs` a `tests/database-normalized-security.sql` ověřují migraci, rollback, vazby firem, oprávnění a logickou kapacitu. Skutečné staging testy jsou oddělené: `scripts/staging-normalized-capacity.mjs` ověřuje historii nad 64 MiB s běžnými Auth účty a `scripts/staging-normalized-lock-proof.mjs` zaznamenává skutečný řetězec databázových zámků. Dočasné probe funkce z testů nepatří do hostitelských migrací a po testu se odstraní. Aktuální výsledky a hashe jsou v `reports/`; samotná existence testovacího skriptu není důkaz jeho úspěšného běhu.
