# Office jako základní funkce: bezpečnost změny a testovací plán

Revize kódu 12. 10. 2026. Zadání nyní požaduje zpřístupnění Office existujícím i novým firmám bez samostatného placeného oprávnění. Tento dokument je návrh a kontrolní podklad; nepotvrzuje aplikaci migrace ani test nové verze na serveru. Produkční změny v rámci této revize neproběhly.

## Bezpečná minimální změna

Zapnutí nesmí znamenat nové členství nebo nové role. Společné `office_request` v normalizovaném úložišti nejprve volá `office_host_context(p_company_id)`, vyžaduje skutečný `office_settings.enabled=true`, kontroluje roli, AI principal a operaci. Soubory, verze, originály a účtenky idempotence používají složené klíče s `company_id`. Tyto části ani RLS/granty se nemají měnit.

Chybějící řádek se doplní pro existující firmy. Každý již uložený řádek se zachová včetně `enabled=false`, `updated_at` a `updated_by`; bez další evidence nelze bezpečně rozlišit historické výchozí false od výslovného vypnutí. Nová firma získá řádek při INSERT. Pouhé přejmenování firmy ani opakování migrace nesmí vypnutí zrušit. Aplikační `readOfficeAvailability` a `requireOfficeContext` mají dál vyžadovat nalezené `enabled=true`; žádný klientský nebo serverový fallback „chybí = povoleno“.

Níže je minimální společný SQL vzor pro novou následnou migraci, nikoli náhrada již aplikovaných souborů. Název triggeru/funkce je orientační. Pořadí zamykání je companies → office_settings, stejně jako při založení firmy; krátký lock timeout raději celou transakci ukončí, než aby dlouho blokoval provoz.

```sql
begin;
set local lock_timeout = '5s';
lock table public.companies in share row exclusive mode;

alter table public.office_settings alter column enabled set default true;

create or replace function office_private.enable_office_for_new_company()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into public.office_settings(company_id,enabled,updated_by)
  values(new.id,true,auth.uid())
  on conflict(company_id) do nothing;
  return new;
end;
$$;
revoke all on function office_private.enable_office_for_new_company()
  from public,anon,authenticated;

drop trigger if exists office_new_company_default on public.companies;
create trigger office_new_company_default after insert on public.companies
  for each row execute function office_private.enable_office_for_new_company();

insert into public.office_settings(company_id,enabled,updated_by)
select id,true,null from public.companies
on conflict(company_id) do nothing;
commit;
```

Privátní schema již existuje a nemá přístup PUBLIC/anon/authenticated. SECURITY DEFINER je zde omezený na trigger vlastněný migrační rolí: běžná firemní INSERT cesta nemá přímé INSERT oprávnění na `office_settings`. Tělo používá jen `new.id`, pevné hodnoty a kvalifikované názvy. Funkce nesmí získat grant k přímému spuštění aplikací. Existující `office_settings_audit` automaticky vytvoří tenantový audit nového nastavení. Trigger je vytvořen před backfillem v jedné transakci, takže souběžně vytvořená firma nepropadne mezerou mezi těmito kroky.

## Odstranění placené brány pouze v Office Diriqo

Diriqo má dvě nezávislé kontroly placené schopnosti:

- `integrations/diriqo/lib/office/context.ts`: `requirePaidCompanyCapability(..., 'core.files.upload')`.
- SQL `public.office_host_write_allowed(uuid)` z `database/office-diriqo-adapter.sql`: `get_company_capability_access(..., 'core.files.upload')`.

Odstranit obě pouze pro Office. TypeScript musí zachovat odmítnutí zápisu čtenářem a všechny kontroly identity, aktivní firmy a nastavení. Následná Diriqo migrace může nahradit pouze Office hook:

```sql
create or replace function public.office_host_write_allowed(p_company_id uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare ctx jsonb;
begin
  ctx := public.office_host_context(p_company_id);
  return coalesce(ctx->>'role' in ('owner', 'editor'), false);
end;
$$;
revoke all on function public.office_host_write_allowed(uuid)
  from public,anon,authenticated;
```

RPC stále kontroluje čtenáře před zápisem a při výpočtu `permissions.canWrite`. Neměnit globální `get_company_capability_access`, katalog `core.files.upload`, `module-operation-access`, platební režim, POS nebo jiné moduly. Pro ostatní uploady a placené funkce zůstávají původní pravidla. Přepsání původního adaptéru v již aplikované migraci by existující databázi nezměnilo; potřeba je následná migrace.

## Konkrétní testy před nasazením

1. **Backfill a opakování:** firmy A/B/C se stavy chybí/false/true. Po migraci A=true, B=false, C=true; původní metadata B/C přesně stejná. Nový audit pouze pro A. Opakování nemění stavy ani počty auditů.
2. **Nová firma:** INSERT firmy D vytvoří právě jeden enabled=true řádek a audit pro D ve stejné transakci. Rollback založení firmy vrátí i nastavení/audit. UPDATE jména vypnuté B ponechá false. Současný INSERT firmy a migrace nevynechá řádek.
3. **Členství a přímá oprávnění:** autentizovaný uživatel A vidí přes RLS pouze nastavení svých firem; B a anonym ne. Přímý INSERT/UPDATE `office_settings` i spuštění triggeru/hooku jsou bez oprávnění. Samotný enabled=true řádek bez členství nedovolí Office RPC.
4. **Výslovné vypnutí:** oprávněný existující administrátor vypne A. List/read/write/export/obnova A jsou odmítnuty; uložené dokumenty zůstanou. Uživatel A ani běžný vlastník B nezíská právo přepnout cizí firmu. Respektovat stávající výjimku platformového administrátora Diriqo, která je už součástí konfigurace.
5. **Bez placeného Office gate:** ve disposable Diriqo fixture vrací capability evaluator denied, ale oprávněný Office editor A vytvoří/uloží/importuje dokument. Stejný evaluator se pro Office nesmí volat. Čtenář, zrušené členství, cizí firma a vypnutý modul dál selžou. Neoffice upload/capability evaluator stále odmítá placenou operaci bez oprávnění.
6. **AI a souběh:** ponechat stávající testy zákazu přímého AI zápisu mimo návrh/schválení, očekávané revize, idempotence a střetu dvou save. Nové defaulty nesmí měnit výsledek těchto kontrol.
7. **Onboarding:** spustit existující testy vytvoření firmy Hub superadminem i Diriqo onboardingem, včetně transakčního selhání a opakování. Nový trigger nesmí vyžadovat členství, které onboarding přidává až po vytvoření firmy.

Původní SQL testy `tests/database-office.sql` kolem řádků 245–247 očekávají blokaci Office při capability denial. Pro nový požadavek slouží samostatný test nové následné migrace; původní fixture nadále ověřuje historickou migraci. Staré testy zůstaly beze změny.

## Místní SQL ověření 12. 10. 2026

`tests/database-base-access-runner.mjs` prošel nad přesnými čtyřmi soubory z migračních adresářů obou hostů. Výsledek je **Hub 68/68, Diriqo 72/72**, bez přeskočených kontrol. Strojový záznam `reports/database-base-access-validation.json` obsahuje čas, pořadí migrací, SHA-256 každého vstupu, přesné názvy kontrol a verzi enginu.

Použit byl již přítomný a licenčně ověřený `@electric-sql/pglite` 0.5.8 (Apache-2.0), tedy skutečný PostgreSQL 18.3 ve dvou nových databázích v paměti. Neproběhla instalace, připojení ke vzdálené databázi ani změna produkce. Každý aplikační požadavek běžel s `SET LOCAL ROLE authenticated` až do COMMIT.

Ověření pokrývá transakční návrat celé neúspěšné migrace; backfill chybějícího nastavení; přesné zachování false/true, času, autora a auditů; opakovanou migraci; vytvoření i rollback nové firmy; platný kontext triggeru; RLS a zakázané přímé zápisy; stávající nastavovací oprávnění; Office zápis při zamítnutém placeném uploadu; čtenáře, cizí/neudržované členství a AI; idempotenci, odmítnutí zastaralé revize; oddělení dokumentů dvou firem; vypnutí včetně exportu a opakování receipt; opětovné povolení a obnovu historie. Globální paid evaluator zůstává beze změny.

Spuštění v tomto workspace:

```powershell
$env:OFFICE_PGLITE_MODULE = Join-Path (Get-Location) 'integrations/hub/node_modules/@electric-sql/pglite/dist/index.js'
node tests/database-base-access-runner.mjs
```

Jde o lokální databázový důkaz s modelovanými Auth a capability kontrakty, nikoli důkaz skutečných JWT, placení nebo přihlášení v prohlížeči. PGlite běží sekvenčně: zkouška očekávané revize a rollbacku nenahrazuje víceprocesový test souběžných zámků. Skutečný stagingový průchod má samostatnou evidenci; tento report jej netvrdí.

Hub navíc obsahuje samostatný `scripts/test-office-base-database.mjs`, stejný runner a fixture. Čte jen čtyři vlastní soubory `supabase/migrations/`; nevyžaduje tento workspace, Diriqo checkout nebo root report. Jeho lokální spuštění prošlo 68 kontrolami a ESLint skončil s kódem 0. Workflow `audit-quality.yml` jej spouští v lane `tests` po existujícím test gate. Používá již existující zamknutý PGlite z Hub závislostí; nebyla přidána knihovna ani instalace. Záznam místního běhu je `reports/hub-office-base-database-green.log`. Výsledek tohoto nového kroku na GitHubu musí být doložen samostatně po pushi; místní průchod není tvrzení o dokončeném CI běhu. Diriqo žádnou novou DB závislost ani CI krok nedostalo a jeho 72 kontrol zde zůstává místním důkazem.

## Omezený skutečný stagingový průchod po aplikaci migrace

Před každým během znovu ověřit UTC čas, branch binding, přesný deployment a schválené okno v `reports/public-staging-targets.json`. Okno končí 12. 10. 2026 v 17:00 UTC; úklid je plánovaný na 16:55 UTC. Použít existující syntetické účty, nikoli produkční přihlášení ani nové placené zdroje. Hesla, tokeny a cookies zůstávají jen v paměti/soukromém úložišti.

První test musí použít skutečně předaný dual-company účet z `.staging/*.dual.json` v prázdné relaci **bez přednastavené company cookie**. Úspěšné Auth musí následovat výslovná povolená volba firmy a Office GET/context s odpovídajícím profile ID a tenantem. Starší test, který nejprve volá pomocné `selectCompany`, tuto uživatelskou cestu neověřuje.

Poté owner/editor A vytvoří jeden označený testovací dokument, přečte jej a uloží přes očekávanou revizi; owner B se stejným ID nesmí obsah přečíst, změnit nebo exportovat ani podvržením tenant headeru. Reader A může číst, nikoli zapisovat. Dva paralelní save stejné revize mají právě jeden úspěch a jeden konflikt; opakování téhož idempotency key vrací původní výsledek. Pro vypnutí použít existující schválený operátorský účet, zaznamenat původní stav a obnovit jej ve `finally`. Nezavádět tenant nebo členství na cizím projektu.

Novou firmu, backfill, transakční rollback a zamykání je výhodnější ověřit samostatným DB testem řízeným vlastníkem migrace; frontendový HTTP průchod není důkazem těchto DDL vlastností. Bezplatnost Office v Diriqo se musí ověřit s denied capability v disposable fixture nebo vyhrazeném stagingovém stavu; běh pouze v globálním test billing režimu to neprokazuje.

## Důležitý dopad stávajících cizích klíčů

`office_settings` i `office_private.settings_events` už od původní migrace odkazují na `companies` bez ON DELETE CASCADE. Automatické založení nastavení/auditu rozšíří ochranu před smazáním firmy i na firmy, které Office ještě neotevřely. V kontrolovaných aplikačních cestách nebylo nalezeno přímé mazání firem; onboarding a Hub administrace firmy vytvářejí/aktualizují. Nepřidávat kvůli této změně plošnou kaskádu mazání dokumentů. Existující skutečný proces odstranění firmy je nutné respektovat a případně ověřit samostatně.
