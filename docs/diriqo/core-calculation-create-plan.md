# Atomické vytvoření kalkulace — návrh samostatného PR

> Historický návrh počátečního rozsahu. Implementační blok byl rozšířen na společné CREATE + UPDATE; aktuální výsledek a důkazy popisuje [release report](core-calculation-save-release.md).

Datum rozboru: 21. 10. 2026. Pracovní kontext: codex/diriqo-billing-acceptance.

**Stav: pouze plán.** Tento dokument není implementace, aplikovaná migrace, nasazení ani uzavřená akceptace. Při jeho přípravě nebyl změněn aplikační kód, databáze ani Git. Práce se odděluje od release ochrany identity zákazníka a od ověřování zákaznických fakturačních údajů.

## 1. Ověřený problém a hranice důkazu

Živý formulář /customers/a2472f19-b40a-436a-8051-11077058ab33/calculations/new v Diriqo Demo přijal:

- název TEST C02-02 kontrola historické adresy;
- zákaznickou položku Kontrolní položka bez plnění, množství 1 ks, jednotková cena 0;
- interní materiál Testovací náklad bez plnění, množství 1 ks, jednotkový náklad 1.

Klientská validace prošla. Server vrátil obecné „Akci se nepodařilo dokončit.“ Nula zákaznické ceny a záporná marže -1 jsou podle současného serverového parseru platné.

Koordinátor 21. 10. 2026 read-only ověřil v testovacím Diriqu wfcpfraxiuhuglnuaxqj:

| Objekt | Aktuální metadata |
|---|---|
| public.calculations | 0 řádků. Chybí internal_note. RLS zapnuté; SELECT přes členství, ALL přes is_company_admin. Authenticated má SELECT/INSERT/UPDATE/DELETE. |
| public.calculation_items | 0 řádků. Chybí item_type, vat_rate a note. RLS zapnuté, žádné policies. Authenticated má SELECT/INSERT/UPDATE/DELETE, samotný grant však RLS nenahrazuje. |
| Triggery | Na obou tabulkách žádné uživatelské triggery (NOT tgisinternal). |
| Omezení | PK; FK hlavičky na firmu, zákazníka a autora; FK položek na kalkulaci s ON DELETE CASCADE. |
| Výchozí hodnoty | Hlavička: součty 0, status draft, datum current_date, měna CZK. Položky: množství 1, ceny/náklady/součty 0, sort_order 0; jednotka nullable. |
| Verze | Hlavička verzí již má internal_note, součty a měnu; admin ALL/member SELECT. Nejde o důkaz atomického verzování. |
| Numerická přesnost | Všechny numeric sloupce calculations, calculation_items a calculation_versions jsou numeric(12,2), včetně množství položek. V calculation_version_items jsou quantity/unit_cost/unit_price/total_cost/total_price numeric(12,2), vat_rate numeric(5,2). V živých calculation_items vat_rate dosud chybí. |

Počet 0 a přesnost jsou **datovaný preflight, nikoli předpoklad migrace ani oprávnění mazat data**. Před aplikací se metadata a fingerprint znovu ověří.

Současná zapisovací cesta:

1. CalculationCreateForm sestaví položky a klientské součty.
2. createCalculationAction provede parser a requireCompanyRoleDalContext(company_admin, super_admin).
3. DAL createCalculation ověří zákazníka a provede INSERT calculations s vrácením id.
4. Až potom provede samostatný INSERT calculation_items.

Žádný RPC ani společná transakce se nepoužívá. První INSERT vždy obsahuje internal_note, i když je null. Chybějící sloupec vysvětluje odmítnutí ještě před vznikem hlavičky; přesný původní PostgREST SQLSTATE/HTTP kód nebyl z UI získán. DAL vyhazuje plain PostgREST error objekt; společný actionError jej nezpracuje jako Error a ztratí konkrétní důvod.

Samotné doplnění internal_note nestačí: druhý INSERT narazí na další chybějící sloupce a pak na RLS. V takovém případě již může zůstat hlavička. Opakování dnešní akce může vytvořit další hlavičku. Hromadný INSERT položek je jedna operace; problém je hranice mezi dvěma požadavky.

## 2. Původní požadavky

Autoritativní zadání je source-specification-v0.1.txt:

- část 5.5 a C05-01: ruční materiál a jednoduchá nabídka bez placeného skladu;
- C05-02: zákaznický dokument ani exportní odpověď neobsahují interní sazby a marže;
- C05-03: nová verze nepřepisuje přijatý obsah;
- P01/P02/P05/P07: tenant, skutečné členství a role, odebrání práva za běhu a přepnutí firmy;
- P16: jádro bez skladu, fakturace, POS a AI, včetně načtení po novém přihlášení;
- část 10.2: stejná operace a obsah vracejí původní výsledek, změněný obsah je konflikt;
- obecný finanční kontrakt: přesná desetinná aritmetika, zachování měny a historie.

Tento PR může dodat důkaz bezpečného vytvoření kalkulace a vymezené regrese. SQL test, READY ani build samy neuzavírají C05/P16.

## 3. Navržený create RPC

~~~sql
public.create_core_calculation_atomic(
  p_company_id uuid,
  p_operation_id uuid,
  p_input jsonb
)
~~~

Odpověď má přesný tvar:

~~~json
{
  "companyId": "<ověřená firma>",
  "operationId": "<původní operace>",
  "calculationId": "<uložená kalkulace>",
  "created": true
}
~~~

Při již dokončeném retry je created false.

Hlavička vstupu: customer_id nebo null, title, description nebo null, status, calculation_date, internal_note nebo null, currency, items.

Položka vstupu: item_type, name, description nebo null, quantity, unit nebo null, unit_cost, unit_price, vat_rate, note nebo null.

Server přiděluje ID, autora podle skutečného profilu, pořadí podle pole položek, čas a součty. Klient nesmí dodat autoritativní created_by, tenant položky, ID cizího rodiče ani hotové finanční součty.

### Typy, nuly a numerika

- Zachovat současné typy customer, labor, material, rental, transport, accommodation. Nový neznámý typ odmítnout; historický null automaticky neklasifikovat.
- Zachovat draft/ready, kalkulaci se zákazníkem i bez něj a předvyplnění z poptávky.
- Nula je platná explicitní hodnota. Chybějící nebo nečíselný vstup není nula. Vyplněný nulový řádek se nesmí tiše vynechat. Prázdný výchozí řádek lze rozpoznat a ignorovat; částečně vyplněný neplatný řádek musí dostat chybu.
- Cena 0 / náklad 1 musí uložit oba řádky a marži -1. Test se nesmí obejít zvýšením ceny, vynecháním materiálu nebo skrytým filtrem.
- Zachovat oddělení zákaznických a interních řádků: customer má interní náklad 0, interní řádek prodejní cenu 0.
- subtotal_cost = interní náklady; subtotal_price = total_price = zákaznická cena bez DPH; margin_amount = subtotal_price − subtotal_cost. Záporná marže je povolená.
- DPH se nově nepřičítá do net součtů; současné UI ji ukazuje odděleně. Kalkulační náklad není potvrzená spotřeba, skladový pohyb ani faktura.
- Kompatibilní nový vstupní kontrakt má nejvýše dvě desetinná místa pro quantity a jednotkové částky. Normalizované desetinné řetězce jsou vhodnější než přenos odvozených JavaScript součtů. Třetí desetinné místo parser/RPC musí srozumitelně odmítnout, nikoli potichu zaokrouhlit k jinému výsledku.
- PostgreSQL numeric autoritativně vypočte součin položky, explicitně zaokrouhlí peněžní výsledek na dvě místa a sečte uložené řádky; UI musí použít stejná pravidla. Ověřit numeric(12,2) limity včetně přetečení součtu a záporné marže.
- Před implementací a znovu před migrací ověřit živé numeric_precision/numeric_scale. Rozšíření přesnosti je případný výslovný další návrh, nikoli skrytá změna tohoto patch scope.
- Současný formulář používá CZK. Tento PR nepřidává měnové převody ani nové daňové režimy.
- Konkrétní limity textů/počtu položek se stanoví v kontraktu podle běžného použití a velikosti požadavku; nesmějí se vydávat za převzaté obchodní omezení, které v zadání není.

## 4. Autorita, transakce a idempotence

Veřejný obal SECURITY INVOKER, soukromá zapisovací implementace SECURITY DEFINER s prázdným search_path, plně kvalifikované objekty a explicitní ACL. Odebrat implicitní EXECUTE PUBLIC; zpřístupnit authenticated pouze určený vstupní řetězec. Anon a service_role nesmějí touto RPC napodobit uživatele. Interní autorizační/helper funkce nesmějí být obecně spustitelné.

Uvnitř DB:

1. Skutečné auth.uid(), aktivní profil, konzistentní auth_user_id/user_id, aktivní členství ve vybrané firmě.
2. Role pouze company_admin nebo super_admin podle dnešní serverové akce. Manažerské pravomoci nerozšiřovat bez definovaného oprávnění číst interní náklady.
3. Existující core.quotes.create, produkt diriqo_core a přepínač quotes. Nevytvářet core.calculations.* ani závislost na jobs/inventory/invoicing/AI/smart_quotes.
4. Současná centrální paid/test/legacy rollout autorita včetně původu, režimu a platnosti. Role ani zapnuté menu licenci nenahrazují. Žádný nový všeobecný bypass chybějícího nároku.
5. Vyplněný zákazník musí skutečně patřit do firmy. Zákazníka ani jeho fakturační adresu vytvoření nepřepisuje.
6. Konzistentní pořadí zámků; čerstvé kontroly po čekání, před zápisem a před návratem. Expiraci hodnotit clock_timestamp(), ne jen začátkem transakce.

Privátní registr: unikátní (company_id, operation_id), normalizovaný vstup/fingerprint, ID výsledku, autor a čas. RLS zapnuté, žádné klientské DML. Payload potřebný k retry zůstává soukromý, ne v zákaznickém výstupu nebo běžných logách.

Rezervace operace, hlavička, všechny položky a dokončený receipt vzniknou v jedné transakci. Souběh stejné operace serializuje DB unikátnost/zámek. Po čekání se znovu ověří oprávnění i obsah. Chyba řádku, autority nebo závěrečné kontroly vrací celou transakci.

Retry:

- Stejná firma, operation ID a normalizovaný obsah vracejí stejné calculation ID bez nového zápisu.
- Stejné operation ID a jiný obsah jsou konflikt.
- Jiné operation ID může být legitimně jiná kalkulace; dokumenty se neslučují podle podobnosti.
- Chybějící/smazaný výsledek zanechá tombstone; fail closed, nevytvářet jej znovu.
- Timeout nebo neplatná úspěšná odpověď znamená nepotvrzený výsledek; zachovat stejný požadavek.
- Replay neobchází aktuální členství, roli ani požadovanou schopnost.

## 5. Additivní schéma a RLS

| Tabulka | Nové pole | Historie |
|---|---|---|
| calculations | internal_note text NULL | Bez odhadovaného obsahu. |
| calculation_items | item_type text NULL | Nehádat customer/material podle ceny. |
| calculation_items | vat_rate numeric(5,2) NULL | Nevyplňovat historických 0 % nebo 21 %. Přesnost potvrdit při preflight. |
| calculation_items | note text NULL | Bez odhadovaného obsahu. |

RPC vyžaduje explicitní validní typ a DPH nových řádků. Nepřidávat globální NOT NULL/default, který by domyslel historii. Původní součty a jednotkové hodnoty nepřepočítávat. Pokud preflight nalezne staré neznámé řádky, doložit je a zobrazit jako neúplnou historii; při převodu nesmí null automaticky znamenat známou sazbu či typ.

calculation_items získá úzký SELECT přes skutečného rodiče v oprávněné firmě. Interní ceny nesmí nově získat každý člen jen proto, že současná hlavička má member SELECT. Ověřit skutečné definice helperů, aktivitu profilů a oprávnění číst náklady, ne pouze názvy funkcí.

**Nepřidat ALL/INSERT/UPDATE/DELETE policies na položky jako opravu permission erroru.** Privátní RPC zapisuje po vlastních ověřených kontrolách. Starý přímý INSERT hlavičky z authenticated uzavřít úzkým odebráním INSERT oprávnění, aby starý klient po migraci nevytvořil neúplný dokument. Neprovádět plošné grant/revoke nesouvisejících tabulek.

### Povinná hranice před navazujícím atomic update

updateCalculation nyní zvlášť vytváří verzi, položky verze, mění hlavičku, maže položky a vkládá nové. Pouhé ponechání položkových zápisů bez policy nestačí: stará editace může změnit hlavičku a uložit verzi ještě před pozdějším odmítnutím položek.

Před vydáním nového create toku proto musí být neatomická editace dotčených nových kalkulací odmítnutá **před prvním zápisem**, se srozumitelnou UI/serverovou hranicí a odpovídající ochranou přímého zápisu. Konkrétní mechanismus se potvrdí při rozdělení implementace. Historická data/verze se nemažou.

**Dočasné odmítnutí není cílový produktový stav ani uzavřená editace.** Atomický update je povinný navazující krok celé opravy kalkulací. Preferovaný implementační blok připraví create i update a vydá je v navazujících, samostatně ověřitelných PR. Dokončení se nesmí usnadnit trvalým vypnutím existující funkce.

## 6. UI a pending požadavek

Dnešní companyId prop v CalculationCreateForm se ignoruje. Customer create stránka i úvodní seznam zákazníků používají RLS bez explicitního filtru aktivní firmy.

Cílové chování:

- Oba vstupy používají ověřenou aktivní firmu a povolenou roli; zákazník v URL i seznam jsou scoped aktivní firmou.
- Formulář a pending operation jsou klíčované company/profile/customer nebo standalone scope.
- Server znovu načte aktuální firmu a odmítne starý submit po přepnutí. Firma z formuláře je ověřovaná vazba, nikoli autorita.
- Stable operation ID náleží přesnému potvrzenému payloadu. Pending zamkne změny i dvojí submit.
- Nejistý výsledek uchová ID i celý původní payload; oprava formuláře nesmí potichu změnit obsah pending operace.
- Pro reload převzít existující vzor QuoteConversionDialog: validovaný sessionStorage, oddělený scope a odstranění po potvrzeném výsledku.
- Pozdní odpověď A se nesmí použít pro navigaci nebo zobrazení v B.
- Chyba úložiště či neplatný pending nesmí automaticky spustit nový potenciálně duplicitní zápis.
- Mapovat známé validation/forbidden/conflict/unavailable chyby a nejistý transportní stav. Žádné výpisy payloadu, osobních údajů nebo klíčů do běžných logů.
- Předvyplnění standalone z poptávky zachovat; současný lead dotaz již filtruje company_id.

## 7. Konkrétní plánované soubory

Cesty jsou relativní k repozitáři. Nejde o již provedené změny.

| Soubor | Zamýšlený rozsah |
|---|---|
| lib/core-calculation-create.ts — nový | Kontrakt, normalizace decimal vstupů, výsledku a chyb. |
| lib/core-calculation-create-ui.ts — nový podle existujícího retry vzoru | Validace/scoping uloženého pending a testovatelná retry logika. |
| lib/dal/core-calculation-create.ts — nový | Jediné RPC, getUser, serverový tenant a přísná kontrola odpovědi. |
| lib/dal/calculations.ts | Create deleguje na RPC bez dvou-INSERT fallbacku. Update se atomizuje v navazující větvi. |
| app/business-actions.ts | Create kontrakt, ověřený kontext, safe error mapa/revalidace; případná časná blokace unsafe editace před jakýmkoli DML. |
| components/CalculationCreateForm.tsx | Validní nuly, stejné výpočty, stable pending/retry a company/profile scope. |
| app/customers/[customerId]/calculations/new/page.tsx | Aktivní firma, role, scoped customer, klíč formuláře. |
| app/kalkulace/nova/page.tsx | Výběr zákazníků aktivní firmy. |
| app/kalkulace/nova/bez-zakaznika/page.tsx | Stejná autorita/scope a zachovaný lead prefill. |
| supabase/migrations/CLI-generated_atomic_core_calculation_create.sql | Skutečný timestamp vytvoří CLI. Additivní sloupce, registr, RPC/ACL/RLS a uzavření starého create. |
| supabase/tests/core-calculation-create.sql — nový | Skutečné role a rollback SQL scénáře. |
| scripts/test-core-calculation-create-sql.mjs — nový | PGlite s reálným schématem, autoritou a migrací; nejde o hosted souběh. |
| tests/core-calculation-create.test.ts — nový | Validace a skutečný DAL/serverový vstup s řízeným RPC. |
| tests/core-calculation-create-ui.test.ts — nový | Pending/retry a reset scope; skutečná komponenta v odpovídajícím browser harnessu. |
| tests/active-company-context.test.ts nebo úzký nový create-page test | Oba vstupy, company filter a odmítnutí starého submitu. |
| scripts/test-core-calculation-create-concurrency.mjs — nový | Dva skutečné Auth klienty, overlap a redigovaná evidence. Tajemství pouze chráněná fixture. |
| supabase/tests/core-calculation-create-barrier.sql — podle potřeby harnessu | Pozorovaná owner bariéra, dva waiting PID a rollback; bez zvýšení klientského timeoutu. |
| docs/diriqo/core-calculation-create-release.md — budoucí | Přesné revize/hash, výsledky, rollout, limity a nehotové akceptace. |

Regresně prověřit lib/dal/flow.ts:createQuoteFromCalculation, obě detail/edit stránky kalkulace, CalculationEditForm, CreateQuoteFromCalculationButton a veřejný/PDF výstup nabídky. Případné minimální čtení neznámých historických hodnot a dočasnou ochranu unsafe editace vymezit při implementaci; nejde o oprávnění k plošnému přepisu obrazovek.

## 8. Návazné výpočty a konverze

- Zachovat skupiny a pořadí položek, datum, status, poznámky, zákazníka a standalone cestu.
- Cena, náklad, DPH a marže mají dosavadní oddělený význam. Create nevytváří skutečný náklad zakázky, skladový pohyb, fakturu ani grant.
- createQuoteFromCalculation používá jen item_type customer. Interní materiál/ceny/marže nesmějí projít do nabídky, PDF ani public API.
- Současný převod dále filtruje total_price > 0. Nulový testovací prodejní řádek proto dokládá create, nikoli celý tok do nabídky. Omezení musí být explicitní v testech, nesmí se „vyřešit“ tichým vyřazením řádku při create. Změna pravidla bezplatné nabídky není skrytá součást tohoto PR.
- Převod kalkulace do nabídky sám zapisuje hlavičku/položky odděleně. Jeho atomicita není novým create RPC vyřešena; celý Core tok se proto neprohlásí za dokončený.
- Zachovat hotové invarianty převodu nabídky na zakázku i snapshotu zákaznické identity.
- Historické neznámé DPH/typ nejsou explicitní nula/materiál. Doplnění vyžaduje podklad a auditovanou změnu.

## 9. Povinné testy a důkazy

### SQL a Auth/RLS

- Cena 0/náklad 1: jedna hlavička, oba řádky, marže -1; nuly i částky po reloadu zachované.
- Všechny typy, datum, draft/ready, měna, customer i null.
- Dvě desetinná místa, odmítnutí třetího místa, přesný součin/součet/zaokrouhlení, overflow a záporná marže; podvržený klientský součet není autorita.
- Injektované selhání druhého řádku, deferred kontroly nebo pozdní autority: žádná nová hlavička, položky ani receipt.
- Cizí firma/zákazník, neaktivní či nekonzistentní profil, odebrané členství, worker/manager bez práva, anon a service_role odmítnuty.
- Disabled quotes, chybějící/expirující/revokovaný grant, chybný režim/původ odmítnuty; platný Core bez doplňků funguje.
- Stejné operation ID + payload replay, jiný payload konflikt, jiná firma nic neodhalí, smazaný výsledek nevznikne znovu.
- Starý přímý INSERT odmítnut před změnou; privátní registr/helpery mají zamýšlené ACL.
- Parent RLS: A nečte B, nelze připojit položku cizímu rodiči, interní ceny se nevydají neoprávněné roli.
- Syntetická stará data vložená před migrací zachována fingerprintem; nové neznámé sloupce null, žádná odhadovaná historie.
- Cleanup assertions po rollbacku: firmy, profily/Auth fixture, hlavičky, položky, registry a aktivní přístupy. Chyba testu nesmí nechat aktivní účet.

### Aplikace a UI

- Skutečný serverový create používá jeden RPC, bez přímých INSERT fallbacků nebo admin klienta.
- Neplatná odpověď po možném COMMIT je uncertain, nevzniká nové operation ID.
- Dvojklik, pending rerender, timeout, reload a retry zachovají stejný payload/ID.
- Company/profile switch oddělí pending; starý submit odmítnut serverem.
- Validní nula nezmizí, neplatná hodnota není převedena na nulu.
- Přihlášený UI create s ručním materiálem bez doplňků, detail, logout/login a reload; mobil a zachování formuláře po chybě samostatně.
- Zákaznický výstup má pouze prodejní údaje; nulový řádek a omezení současného převodu mají výslovné očekávání.
- Neatomický update není prezentován jako opravený; dočasné odmítnutí není cílové řešení.

### Skutečný souběh

PGlite, Promise.all ani postupné replay neprokazují překryv. Autorizovaný hosted test musí použít dvě čerstvé Auth relace a owner bariéru, která v témže HTTP intervalu pozoruje oba waiting PID. Owner polling obnovuje statistický snapshot, bariéra končí rollbackem. Očekávání: jedno created true, jedno false, stejné ID a jediná sada řádků; změněný payload konflikt bez dalších dat.

Soukromá fixture nepatří do Git/logů. Po testu logout obou relací a doložený úklid/deaktivace syntetických přístupů při zachování potřebného auditu.

## 10. Migrační postup, audit a návrat

1. Samostatná izolovaná větev z ověřeného main po předchozím release; tento plán nic nepřepíná.
2. Read-only preflight sloupců, numeric precision/scale, FK, ACL, policies/helperů, závislých funkcí/verzí, počtů a fingerprintů původních řádků.
3. Ověřit dostupný obnovitelný backup/snapshot a konkrétní odpovědnost za návrat; žádné tvrzení „zálohováno“ bez evidence.
4. Migraci založit instalovaným Supabase CLI přes ověřenou nápovědu. Nepřepisovat historii ani nevymýšlet timestamp.
5. Lokální rollback SQL, aplikační/UI testy, regrese snapshotu a Core převodu, lint/typecheck/build; výsledky oddělit podle vrstvy důkazu.
6. Po release autorizaci aplikovat přesné SQL/hash pouze v Diriqo test projektu. Znovu ověřit metadata/fingerprint a hosted rollback SQL.
7. Schema, nové RPC a uzavření starého create musí tvořit jednu transakční změnu. Žádná mezifáze „povolme tabulky, RPC potom“.
8. Nasadit odpovídající aplikaci; staré formuláře nemají částečný fallback. Přiznat krátké fail-closed období, pokud je nutné.
9. Autentizované UI a skutečný souběh na označených syntetických datech, bez finančního plnění nebo zákaznické komunikace.
10. Při chybě zastavit nové zápisy a použít ověřenou kompatibilní revizi/fix forward. Nedropovat nové sloupce/receipt, nemazat dokumenty ani verze kvůli rollbacku. Stará aplikace bez kompatibilní DB cesty není „obnovená funkčnost“.
11. Release report: commit/migration/deployment identity, testy, fingerprinty, Auth cleanup, nevyřešené části a skutečný rozsah akceptace.

## 11. Povinné navazující kroky

Atomický updateCalculation musí uložit hlavičku, položky a novou verzi pod revizí/zámkem v jedné transakci, zachovat originál při konfliktu a řešit retry bez přepisování historických neznámých údajů. Je povinnou součástí celkové opravy kalkulací, nikoli nepovinným vylepšením. Preferovat navazující ověřitelné PR v jednom implementačním bloku; trvalé vypnutí editace není dokončení.

Dále zůstává úplná atomicita kalkulace → nabídka a akceptace C05/P16. Customer-billing a customer-snapshot release mají vlastní důkazy; tento plán je nepřepisuje ani nerozšiřuje.
