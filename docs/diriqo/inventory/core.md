# Mapa kapitoly 5: globální jádro C01–C10

Stav: analytická mapa dokončena 10. 10. 2026; **bez implementace, nových testů a změn DB**. Podklad: `C:\Users\semis\.codex\attachments\b2680e79-3c1f-40b7-a3b2-e1487dce9a0e\Vložený text.txt`, kapitola 5, řádky 286–482.

## Rozsah a důkazní hranice

Cílový kód: `C:\vyvoj\diriqo`, čistá revize `208c9ead6dface1b0a25bfedd71ff398eb9dd480`. Zdrojový Hub: `C:\Users\semis\.codex\worktrees\hub-ui-audit-fixes-20261008\jspdhubhotovy`, revize `7aa079882a87f0cb7619009dfc7061c1e1eb9058`. Mapa není tvrzením o obsahu později připravené izolované cílové kopie. Diriqo je dle nového upřesnění uživatele testovací prostředí; **to nezahrnuje Hub a nedává implicitní pokyn resetovat data**. První zamýšlená dávka je pouze capability registry + DRAFT katalog + testy, bez živého přepnutí licencí. Tento dílčí úkol nic z toho neimplementuje.

Jádro obsahuje pracovníky, skutečnou práci, provozní schvalování, nákladové sazby a evidenci záloh. **Neobsahuje legislativní mzdy, zákonné nároky dovolené, odvody, české pracovněprávní smlouvy ani automatické mzdové srážky.** Staré požadavky na převod kompletních holdingových mezd nejsou novou podmínkou C03/C04/C08. Potřebné firemní a historické oddělení provozních nákladů zůstává.

Použity existující zprávy `C:\Users\semis\Documents\Codex\2026-10-10\hub-diriqo-audit\work\diriqo-product.md` a `C:\Users\semis\Documents\Codex\2026-10-10\hub-diriqo-audit\work\hub-administration.md`; doplňující čtení cílových symbolů a SQL bylo úzké. **Existující** znamená nalezený kód/model, nikoli úspěšný produkční zápis; **částečný** znamená použitelný základ s nesplněným kontraktem; **chybějící** znamená nedoloženou implementaci v kontrolovaných cestách; **ověřit** označuje neznámou DB/UI účinnost nebo souběh. Žádná C01–C10 zatím nemá důkaz splnění celého kontraktu.

Výstup byl připraven pro `C:\Users\semis\OneDrive\Dokumenty\ChatGPT\hub -_ diri 3\work\core-gap-map.md`. Zápis tam odmítla automatická kontrola oprávnění: „writing outside of the project; rejected by user approval settings“. Proto je dokument předán v původním dostupném auditním workspace; root jej může převzít do svého aktuálního workspace. Nejde o změnu produktového repozitáře.

## Společné základy a překážky

- Identita a tenant: existují `profiles`, `company_members`, aktivní firma a serverové helpery. Body: `C:\vyvoj\diriqo\lib\server-guards.ts:24` (`requireAuthenticatedUser`), `:48` (`requireActiveCompanyContext`), `:65` (`requireCompanyRole`), `:85` (`requireHubAccess`), `:103` (`requireWorkerAccess`); `C:\vyvoj\diriqo\lib\dal\auth.ts:23` (`requireHubDalContext`) a `:41` (`requireCompanyRoleDalContext`). Výběr firmy není oprávnění; každá služba ověří členství a tenant vazbu objektu.
- Před novými citlivými zápisy opravit audit D-01: zapisovatelná firemní role proti globálnímu `super_admin` guardu. Přesné body `C:\vyvoj\diriqo\supabase\migrations\20260425190000_proposed_role_separated_rls.sql:237`, `C:\vyvoj\diriqo\lib\superadmin.ts:14`, `C:\vyvoj\diriqo\proxy.ts:283`, `C:\vyvoj\diriqo\app\admin\companies\page.tsx:42`. Oddělit platformní oprávnění od role tenanta a chránit DB přímou cestu. Doložená cesta oprávnění není provedený produkční exploit.
- Matice action × scope (self / assigned / subordinate team / company), oddělené čtení cen/sazeb/dokumentů a schvalování není hotová jen existencí hrubých rolí. Rozšířit společnou vrstvu pro server, RPC/RLS i signed URLs; nevytvářet nesourodé page-only kontroly.
- Modulové brány: `C:\vyvoj\diriqo\lib\module-access.ts:5` (`isCompanyModuleEnabled`) bere chybějící klíč jako povolený; `:10` (`requireCompanyModule`), `C:\vyvoj\diriqo\lib\company-settings-shared.ts:1` (`COMPANY_MODULE_KEYS`). C01–C10 nesmí záviset na inventory/invoicing/AI/POS ani legacy payroll licenci. První registry/DRAFT dávka ještě nemá sama přepínat runtime; následující dávka musí vědomě převést význam bran a otestovat core bez doplňků.
- Peníze: SQL `numeric` existuje, aplikační `number`/`Math.round` není přesná desetinná aritmetika. `C:\vyvoj\diriqo\lib\economics.ts:16` převádí null/neplatné číslo na nulu, `:22` (`roundEconomicsMoney`) zaokrouhluje float, `:26` násobí float. Jednotný přesný formát částek/množství, měna a rounding pravidla musí projít vstupy, příkazy, agregacemi i PDF. Chybějící sazba není nula.
- Historie/audit: actor/time/reason, verze a audit potřebují stejnou transakci jako citlivý příkaz. `C:\vyvoj\diriqo\lib\dal\jobs.ts:51` (`logJobEconomicsAudit`) toleruje některé chyby auditní tabulky. Použité entity archivovat, nepřerušovat historické vazby.
- Čas: instants s časovým kontextem, celodenní absence jako lokální datum. Oddělit skutečné hodiny, odměnové/nákladové hodiny a zákazníkovi účtované hodiny. Popsat synchronizační triggery, aby stejný zdroj nepřidával náklad dvakrát.

### Jak číst SQL účinnost

Níže jsou **poslední nalezené očíslované definice pro konkrétní změnu**, vedle známých nečíslovaných patchů. Nejde o tvrzení, že patche byly spuštěny nebo že nejvyšší datum souboru je poslední účinná DB definice. Diriqo má prázdný `20260408160615_remote_schema.sql`, bootstrap a nečíslované `supabase/patch-*.sql`; živý audit vrátil prázdnou historii migrací. **Poslední skutečně účinná lokální DB definice bez lokálního katalogu nebo reprodukovaného manifestu není doložena.** Před implementační migrací sestavit manifest/diff vůči zvolenému cíli; nespouštět všechny patche naslepo.

Předané živé důkazy původního auditu: 69 public tabulek s RLS, ale 9 bez policies včetně `quote_items` a `invoice_items`; katalog potvrdil D-01. `ENABLE RLS` neprokazuje funkční oprávněný zápis. Nová živá DB kontrola zde neproběhla. Podklady: `C:\Users\semis\Documents\Codex\2026-10-10\hub-diriqo-audit\work\live-metadata.json` a související JSON. U níže uvedených konkrétních SQL souborů proto zůstává živá účinnost **ověřit**, pokud není výslovně uveden živý důkaz.

## C01 — Zakázky a podzakázky

**Stav: částečný.** Existují ruční zakázky, přiřazení, hierarchie a převod nabídky. Nedoložen celý oddělený automat koncept → plán → běží → práce hotova → uzavřeno, zvláštní předání, pause/cancel s historií a autorizovaný reopen. Přijetí nabídky není zahájení práce; close nezávisí na faktuře/platbě.

**Cílové soubory/symboly:** `C:\vyvoj\diriqo\app\jobs\actions.ts:433` (`createJobsAction`), `:724` (`createParentSummaryJobAction`), `:846` (`detachJobFromParentAction`), `:880` (`attachJobToParentAction`), `:966` (`createJobGroupFromDropAction`), `:1150` (`deleteJobSafelyAction`); `C:\vyvoj\diriqo\lib\dal\flow.ts:204` (`createJobFromQuote`), `:306` (`markJobCompleted`); `C:\vyvoj\diriqo\app\business-actions.ts:514`, `:557`; seznam `C:\vyvoj\diriqo\app\jobs\page.tsx:838` a detail `C:\vyvoj\diriqo\app\jobs\[jobId]\page.tsx`.

**Tabulky:** rozšířit `jobs`, `job_assignments`, customer/contact vazby, `quotes`; nevytvářet nové paralelní jobs. Ověřit task/stage, historii stavu, unique číslo/company, owner/currency/tags a verzi přijatého rozpočtu. Parent/child stejná firma, bez cyklu; vlastní částka rodiče není agregát. `createJobFromQuote` již vrací nalezený job před zápisem i po chybě závodu. Header/děti/approve však vznikají odděleně: po chybě dítěte může catch vrátit neúplný existující parent jako úspěch. Unique index nezaručuje atomický převod.

**SQL:** `C:\vyvoj\diriqo\supabase\migrations\20260421113000_add_parent_job_grouping.sql`; interní job flag `20260426113000_add_jobs_internal_flag.sql` ve stejné složce; poslední nalezená mazací RPC definice `C:\vyvoj\diriqo\supabase\migrations\20260509100000_harden_delete_job_safe.sql:3`. `C:\vyvoj\diriqo\supabase\patch-job-flow-commands.sql:4` přidává source_quote_id, `:7` unique kořen `(company_id, source_quote_id)`.

**Guardy/Hub:** zachovat customer ověření `actions.ts:293`, pracovníky `:332`, tenant DAL; doplnit action/scope, revizi a transakční idempotenci. Opravit D-06 company-unscoped seznam. Hub `C:\Users\semis\.codex\worktrees\hub-ui-audit-fixes-20261008\jspdhubhotovy\app\customer-work\actions.ts:546` již volá `hub_quote_jobs_v1` s intentem/revizí; zdrojová migrace `supabase/migrations/20261003111746_atomic_quote_lifecycle_v1.sql`. Převzít princip; ruční Hub create je také neatomický.

**Testy:** cílové `C:\vyvoj\diriqo\tests\active-company-switch.test.ts`, `auth-guards.test.ts`, `economics.test.ts` ve stejné složce jsou dílčí. Zdroj Hub `scripts/jobs-read-model.test.mjs` měl v minulém auditu 17/17 PASS, ne DB průchod.

**Akceptace:** C01-01 bez inventory/invoicing/AI vytvořit job, ruční rozpočet, práci a close. C01-02 opakovaný/souběžný převod stejné přijaté verze vrací stejnou kompletní zakázku; chyba uprostřed nezanechá poloviční hierarchii. C01-03 vlastní parent 100 + děti 200+300 = 600 ve všech přehledech i při filtrování/stránkování. Navíc cizí firma/cyklus/reopen guard a zachování práce/nákladů po cancel.

## C02 — Zákazníci, kontakty a místa

**Stav: částečný.** Zákazníci, kontakty, země a volitelné IČO existují. Nedoloženo úplné archive/restore/controlled merge ani univerzální více míst. Současné destruktivní cesty odporují zachování historie.

**Cílové body:** `C:\vyvoj\diriqo\app\customers\actions.ts:91` (`createCustomerAction`), `:172` (`updateCustomerAction`); `C:\vyvoj\diriqo\app\customers\[customerId]\contacts\actions.ts`; `C:\vyvoj\diriqo\app\customers\[customerId]\delete\actions.ts:56`; `C:\vyvoj\diriqo\app\jobs\actions.ts:1094` (`detachCustomerFromJobAction`). Dvě poslední cesty mažou vazby/nulují klienta, nejsou archivace. `C:\vyvoj\diriqo\app\api\quotes\[quoteId]\pdf\route.ts:583` (`customerToSnapshot`) staví data z aktuálně joinovaného zákazníka (`:752`); název helperu není důkaz uloženého neměnného snapshotu.

**Tabulky/SQL:** `customers`, `customer_contacts`, `job_customer_contacts`, `jobs.customer_id/contact_id/address`, `quotes`. Kontakt není automaticky provozovna. Zdrojová gastro doručovací místa nejsou automaticky univerzální C02 model. `C:\vyvoj\diriqo\supabase\migrations\20260409230000_add_customer_billing_fields.sql`, `C:\vyvoj\diriqo\supabase\migrations\20260414210000_add_customer_web_lead_fields.sql`; role `C:\vyvoj\diriqo\supabase\migrations\20260425190000_proposed_role_separated_rls.sql`; nečíslované `C:\vyvoj\diriqo\supabase\patch-diriqo-runtime-schema.sql:46`, `:169` a `C:\vyvoj\diriqo\supabase\patch-tenant-isolation-audit.sql`. Účinná multi-site/archive migrace není doložena.

**Guardy:** merge ověří oba zákazníky, dopad vazeb a auditovanou transakci. Archivovaný klient není výchozí nový výběr, ale historický detail zůstává. Vydaný doklad čte uložený snapshot. Archivaci vynutit serverem, ne jen skrytím tlačítka.

**Testy/akceptace:** specializovaný customer E2E test nenalezen v současné sadě. C02-01 zahraniční klient bez IČO má dvě místa a zakázky. C02-02 změna adresy nezmění vydanou nabídku/API/PDF. C02-03 archivace zachová vazby, vyřadí z default výběru a restore obnoví použitelnost. Navíc merge rollback a přímé API odpojení použitého masteru.

## C03 — Pracovníci, členství a nákladové sazby

**Stav: částečný, podstatné existující základy.** Pracovník bez loginu již existuje: RPC vytváří profil s NULL auth_user_id/user_id a worker členství. Existují i firemní sazby v `worker_payment_settings`. Mezery jsou historie/účinnost a nesjednocené použití s globálními sazbami, nikoli úplná absence těchto schopností.

**Cílové body:** `C:\vyvoj\diriqo\app\workers\new\page.tsx:167` (`createWorker`), RPC `:210`; `C:\vyvoj\diriqo\app\api\worker-invites\route.ts` a větve activate/validate/revoke; `C:\vyvoj\diriqo\app\settings\company\actions.ts:308` (`updateWorkerPaymentSettings`), upsert `:327`; `C:\vyvoj\diriqo\lib\company-settings.ts:318` (`getWorkerPaymentSettings`), `:361` (`getEffectiveWorkerPaymentSettings`). Getter při chybějícím řádku inicializuje sazbu z profilu a zapisuje ji. `C:\vyvoj\diriqo\app\workers\[workerId]\finance\actions.ts:171` (`updateWorkerProfileAction`) stále mění globální default_hourly_rate `:215`; `C:\vyvoj\diriqo\lib\dal\economics.ts:98`, `:245` dál používá profile/shift fallback.

**Tabulky:** `profiles`, `company_members`, `worker_invites`, `worker_payment_settings`; team/manager vazby cíleně ověřit. Worker settings má UNIQUE(company_id, profile_id), hourly/fixed rate; přečtená definice nemá currency/unit/effective-from/to verze. Rozšířit sazbu navázanou na firmu/pracovníka, nevkládat ji do globální identity. Citlivé údaje nepovinné; současné create vyžaduje telefon. Řízené připojení pozdějšího účtu ke stejnému pracovníkovi ověřit end-to-end.

**SQL:** poslední invite/unauth-worker definice `C:\vyvoj\diriqo\supabase\migrations\20260513100000_add_worker_invites.sql:41` (`create_worker_profile_for_invite`), NULL identity `:88`, membership `:118`; firemní sazby `C:\vyvoj\diriqo\supabase\migrations\20260506170000_add_company_settings_module.sql:163`; globální legacy `C:\vyvoj\diriqo\supabase\migrations\20260502120000_add_payroll_settings_and_contractors.sql:21`. Není požadováno zapnutí Hub employment přípravy nebo českých zákonných typů smluv.

**Guardy:** správa osoby, link identity, změna sazby a čtení sazby jsou odlišné akce. Manager A neznamená manager B. Opravit company-unscoped přehledy D-05; RLS union legitimních firem nestačí pro active company. Schválený náklad nese historický snapshot.

**Testy/akceptace:** `C:\vyvoj\diriqo\tests\worker-invites.test.ts:41` testuje telefon/token/expiry helpery, ne celé připojení osoby. Role/switch helpery nejsou DB security test. C03-01 manažer zadá práci člověku bez účtu; pozdější link nezduplikuje osobu ani práci. C03-02 stejný člověk manager A / worker B má oddělená práva na serveru i v DB. C03-03 sazba od listopadu nezmění schválené říjnové náklady. Navíc currency/unit, nepřístupná sazba a politika překryvu účinností.

## C04 — Čas a schvalování práce

**Stav: částečný.** Timer, manuální směny, assignment a hodinové vstupy existují. Nedoložen kompletní draft/submitted/approved/returned s neměnnou schválenou verzí a opravou. Přestávky, překryvy, DST, approval scope a atomický jediný timer vyžadují doplnění/ověření.

**Cílové body:** `C:\vyvoj\diriqo\app\moje-prace\actions.ts:39` (`getWorkerContext`), `:55` (`assertAssignedJob`), `:102` (`startMyJobShiftAction`), `:169` (`stopMyJobShiftAction`), `:222` (`completeMyJobAction`); `C:\vyvoj\diriqo\app\work-shifts\[shiftId]\edit\page.tsx:358`; `C:\vyvoj\diriqo\lib\dal\jobs.ts:197` (`updateWorkShift`); `C:\vyvoj\diriqo\lib\labor-calculation.ts`. Start má lookup a následný insert, což samo nezaručuje souběhovou jedinečnost.

**Tabulky/SQL:** `work_shifts`, `work_logs`, `job_assignments`, sazby/snapshoty. Poslední nalezená číslovaná definice `sync_job_assignment_from_shifts`: `C:\vyvoj\diriqo\supabase\migrations\20260425203000_archive_job_assignments.sql:17`; příchody dále synchronizuje `C:\vyvoj\diriqo\supabase\migrations\20260425210000_sync_shift_arrivals_to_assigned_jobs.sql:4`, trigger `:75`. Starší základ `20260410001000_sync_work_shifts_into_job_assignments.sql` v téže složce; runtime `C:\vyvoj\diriqo\supabase\patch-diriqo-runtime-schema.sql:124`, `:542`. Před změnou popsat skutečný výsledný trigger chain. Unique aktivního timeru v DB zde není doložena; nejde o úplný audit všech indexů.

**Guardy:** self jen assigned job/company, write-for-other a approve zvlášť. Service-role cesta vyžaduje objektový guard i atomickou kontrolu vazeb. OSVČ automatické schválení jen explicitní politika. Oprava = navazující revize a nový approval, ne přepis schváleného podkladu.

**Testy/akceptace:** `C:\vyvoj\diriqo\tests\labor-calculation.test.ts:9` caps job hours skutečnými, `:24` duration fallback; ne DST/revize/souběh. C04-01 dvě záložky/dvojklik = jediný aktivní timer osoby/company. C04-02 noc+break+DST má správné skutečné trvání. C04-03 oprava zachová originál, znovu se schválí a ovlivní náklad jednou. Navíc overlap politika a neoprávněný approver.

## C05 — Kalkulace a jednoduché nabídky

**Stav: částečný.** Manuální kalkulace/položky/verze, nabídky/public token/PDF existují. Nedoložena kompletní neměnná přijatá verze a transakční tok; živý audit navíc potvrdil quote_items bez policies.

**Cílové body:** `C:\vyvoj\diriqo\lib\dal\calculations.ts:36` (`createCalculation`), `:89` (`updateCalculation`), verze `:119`; `C:\vyvoj\diriqo\lib\dal\quotes.ts:7` (`updateQuote`); `C:\vyvoj\diriqo\lib\dal\flow.ts:69` (`createQuoteFromCalculation`), `:155` (`approveQuote`), `:189` (`acceptPublicOffer`); `C:\vyvoj\diriqo\app\business-actions.ts:239`, `:408`, `:442`, `:476`, `:495`, `:573`; formuláře `C:\vyvoj\diriqo\components\CalculationCreateForm.tsx`, `CalculationEditForm.tsx`, `QuoteEditForm.tsx`, `QuoteActionsPanel.tsx` ve stejné složce; PDF `C:\vyvoj\diriqo\app\api\quotes\[quoteId]\pdf\route.ts`, `C:\vyvoj\diriqo\app\api\offers\[token]\pdf\route.ts`.

**Tabulky:** `calculations`, `calculation_items`, `calculation_versions`, `calculation_version_items`, `quotes`, `quote_items`, public-offer události. Přijetí přesné verze obsahu/podmínek, klientský snapshot C02, ruční přijetí actor/time/evidence. Materiál nemusí být skladová karta; náklady/marže nesmí být v zákaznickém response ani skrytě. Stav draft/ready/sent/accepted/rejected/expired/replaced/withdrawn uchovává historii.

**SQL:** `C:\vyvoj\diriqo\supabase\migrations\20260410090000_add_calculations_and_quotes.sql`, `C:\vyvoj\diriqo\supabase\migrations\20260413143000_add_calculation_versions.sql`; poslední nalezená public-offer číslovaná definice `C:\vyvoj\diriqo\supabase\migrations\20260509133000_add_company_logo_to_public_offers.sql:8`; grant `C:\vyvoj\diriqo\supabase\migrations\20260508153000_grant_service_role_quote_runtime.sql`; patche `C:\vyvoj\diriqo\supabase\patch-diriqo-quotes-runtime.sql`, `patch-public-offers-runtime-functions.sql`, `patch-public-offer-portal-security.sql` ve stejné složce.

**Guardy/Hub:** oddělit tvorbu/nacenění/approve a public token scope; atomický header/items/snapshot/audit. Hub má `hub_save_calculation_v1`, `hub_mutate_quote_v1`, `hub_quote_jobs_v1` ve zdrojových `supabase/migrations/20261003104140_atomic_calculations_v1.sql`, `20261003111746_atomic_quote_lifecycle_v1.sql`; volání `app/customer-work/actions.ts:319`, `:376`, `:546`. Hub createQuoteFromCalculation ještě zapisuje odděleně `:489`, není vzor hotové atomické operace.

**Testy/akceptace:** `C:\vyvoj\diriqo\tests\public-token-security.test.ts` jen helpery, ne celý tok. C05-01 ruční materiál bez inventory → základní PDF. C05-02 zákaznické API/PDF bez interní ceny/marže včetně skrytých polí. C05-03 nová verze nezmění přijatou; job ukazuje správný snapshot. Dále stale token/souběžné přijetí, withdrawn verze a rollback bez osiřelého headeru. Ruční evidence přijetí není kvalifikovaný podpis.

## C06 — Kalendář a plánování

**Stav: částečný.** Eventy a assignments existují; nedoložen zdrojový projekční model job/assignment/absence, konflikt politika a optimistic locking přesunu.

**Cílové body:** `C:\vyvoj\diriqo\app\calendar\actions.ts:64` (`createCalendarEventAction`), `:222` (`updateCalendarEventAction`), `:348` (`deleteCalendarEventAction`); `C:\vyvoj\diriqo\app\calendar\page.tsx`, `new/page.tsx`, `events/[eventId]/page.tsx` pod stejnou složkou. Create ověří job `:106`, členy `:121`, event/assignment zapisuje odděleně `:143`, `:167`. Update totéž `:299`, `:309`, `:323`.

**Tabulky/SQL:** `calendar_events`, `calendar_event_assignments`, zdroje `jobs`, `job_assignments`, `absence_requests`. Poslední nalezená specifická policy `C:\vyvoj\diriqo\supabase\migrations\20260411131000_fix_rls_calendar_module.sql`, širší role `C:\vyvoj\diriqo\supabase\migrations\20260425190000_proposed_role_separated_rls.sql`, nečíslovaný `C:\vyvoj\diriqo\supabase\patch-tenant-isolation-audit.sql`. Před přidáním relation cíleně ověřit existující sloupce; event nesmí být nezávislou kopií job stavu.

**Guardy:** requireHubDalContext/calendar gate nestačí pro action/scope. Přesun projekce mění původní objekt jen s jeho právem a expected revision. Pending absence odlišena, colleague privacy C07. Override konfliktu vědomý/auditovaný; plán není skutečně odpracováno.

**Testy/akceptace:** žádný specializovaný calendar test doložen. C06-01 approved absence upraví dostupnost/kolize. C06-02 worker nemůže přesunout neoprávněnou událost přímým server voláním. C06-03 druhý ze dvou přesunů stejné verze dostane konflikt. Navíc rollback event/assignments, timezone a standalone planned/done/cancelled.

## C07 — Nepřítomnosti

**Stav: částečný.** Žádost a approve/reject existují; nejsou doloženy draft/submit/withdraw/approved-cancel, důvod manager on-behalf, konfigurace provozních typů a bezpečný availability read model.

**Cílové body:** `C:\vyvoj\diriqo\app\absences\page.tsx`; `C:\vyvoj\diriqo\app\absences\actions.ts:18` (`updateAbsenceStatusAction`), admin guard `:22`, company-scoped update `:37` s původním pending. Užitečná souběhová podmínka není celý workflow.

**Tabulky/SQL:** `C:\vyvoj\diriqo\supabase\patch-diriqo-runtime-schema.sql:181` definuje `absence_requests` (start/end timestamptz), `:197` ještě `absences` (date_from/to date). Server approval používá `absence_requests`. **Nevytvořit třetí model** bez zjištění autority a klientů starých dvou. Poslední nalezená číslovaná obecná role policy `C:\vyvoj\diriqo\supabase\migrations\20260425190000_proposed_role_separated_rls.sql`; účinný all-day kontrakt není doložen.

**Guardy:** self submit / manager on-behalf s důvodem, approver jen tým/company. Kolega dostává jen unavailable interval bez důvodu/HR příloh. Absence nikdy automaticky nepřepisuje směny. Core nepočítá zákonnou dovolenou/náhrady.

**Testy/akceptace:** specializované absence testy nedoloženy. C07-01 lokální celodenní data přežijí změnu zobrazovacího pásma. C07-02 approver vidí kolizi, kolega jen unavailable. C07-03 approved cancel je zvláštní auditovaný krok, aktualizuje dostupnost, uchová historii a nemění směny. Navíc on-behalf reason, partial-day a approval/cancel závod.

## C08 — Zálohy pracovníkům

**Stav: částečný.** Žádost a jedno vyplacení existují. Oddělené schválení/více plateb/vyúčtování/vrácení chybí v doložené cestě. Nejde o invoice deposit, bankovní převod ani automatickou mzdovou srážku.

**Cílové body:** `C:\vyvoj\diriqo\app\advance-requests\actions.ts:82` (`updateAdvanceRequestStatusAction`); stav union `:6` approved/rejected/paid; guard `:87`, podmínky `:123`, `:131`; request update `:157` a worker_advances `:184` až `:218` nejsou jedna transakce. Upsert reprezentuje jednu platbu; nové UI/příkaz/SQL musí rozlišit request/approved amount a financial/settlement stavy.

**Tabulky/SQL:** `advance_requests`, `worker_advances`. Nejprve určit zda druhá tabulka zůstane platebním ledgerem či souhrnem s událostmi. `C:\vyvoj\diriqo\supabase\migrations\20260429143000_add_advance_request_id_to_worker_advances.sql:45` unique advance_request_id znamená nejvýše jeden navázaný řádek. **Pouze odstranit index bez změny upsertů, čtení a idempotence je nebezpečné.** `C:\vyvoj\diriqo\supabase\patch-diriqo-runtime-schema.sql:211`, `:234`; role RLS `20260425190000_proposed_role_separated_rls.sql` ve složce migrations. Historii nerozpadat na fiktivní dílčí platby.

**Guardy/Hub:** oddělené request/approve/pay/settle; company/person/currency/approved ceiling serverem z DB. Souběžné platby nepřekročí limit. Hub `C:\Users\semis\.codex\worktrees\hub-ui-audit-fixes-20261008\jspdhubhotovy\supabase\migrations\20261003095506_atomic_advance_payout_v1.sql` (`hub_pay_advance_request_v1`), scope doplněn `20261005090000_advance_requests_company_scope.sql` ve stejné složce, je inspirace atomické idempotence, **nikoli hotový partial-payment/settlement model C08**.

**Testy/akceptace:** worker-payroll helper nepokrývá platby/souběh. C08-01 requested5000 / approved3000 / dvě platby: správné paid/unpaid/unsettled v téže měně. C08-02 retry stejného payment intentu nepřidá platbu; souběh respektuje ceiling. C08-03 platba/vrácení/vyúčtování mají evidence a nepřidají další pracovní náklad. Změna approved částky vyžaduje nové rozhodnutí/důvod.

## C09 — Soubory, fotografie a předání

**Stav: fotografie částečné; obecné verzované předání chybějící v kontrolovaných cestách.** Private foto/metadata/signed URL existují; draft/ready/presented/confirmed/returned protocol se zachováním zrušených/předchozích potvrzených verzí nedoložen.

**Cílové body:** `C:\vyvoj\diriqo\lib\job-photo-storage.ts:59` (`buildJobPhotoStoragePath`), `:87` (`resolveJobPhotoAccessScope`), `:155` (`verifyJobPhotoAccess`); `C:\vyvoj\diriqo\app\api\job-photos\route.ts:156` GET, `:308` POST, `:518` PATCH, `:626` DELETE; `C:\vyvoj\diriqo\app\api\job-photos\url\route.ts:19` GET, `:76` URL s TTL30min. Nová doménová vrstva předání se napojí na existující job/file; názvy nových tabulek až po cílené inventuře, ne duplikát příloh.

**Tabulky/SQL:** `job_photos`, `storage.objects`, `jobs/job_assignments`. Poslední číslovaná změna metadat `C:\vyvoj\diriqo\supabase\migrations\20260508110000_add_job_photo_notes.sql:1`; bucket policy `C:\vyvoj\diriqo\supabase\migrations\20260426103000_ensure_job_photos_bucket.sql:22`; nečíslované `C:\vyvoj\diriqo\supabase\patch-job-photo-storage-pipeline.sql`, `C:\vyvoj\diriqo\supabase\patch-tenant-isolation-audit.sql`. Audit D-11 doložil mismatch generovaného job/category path vs company/job/category policy a omezení worker upsert UPDATE. Neřešit plošným otevřením bucketu.

**Guardy/Hub:** každý upload/change/delete/fresh URL ověří aktuální objektové právo. Ověřit parent-group rozšíření; HR přílohy mají jiné právo. Již vydané signed URL není okamžitě revokovatelné; zvolit krátkou zdokumentovanou TTL nebo auth proxy. Manuální potvrzení není kvalifikovaný podpis. Zdroj Hub `C:\Users\semis\.codex\worktrees\hub-ui-audit-fixes-20261008\jspdhubhotovy\lib\documents\documentService.ts` může dát princip scope/archivace; OCR/chat nesmí být core závislost. Hotový univerzální Hub handover audit nedoložil.

**Testy/akceptace:** cílové specializované foto/handover testy nedoloženy. C09-01 assigned worker foto → manager verzované ruční předání/PDF. C09-02 cizí ID po odnětí práva nezíská nové URL; vydané URL odpovídá TTL/proxy kontraktu. C09-03 oprava vytváří novou verzi a zachová původní obsah/přílohy/potvrzení. Navíc upload retry, private bucket a zákaz výmazu použité přílohy.

## C10 — Ekonomika zakázek

**Stav: částečný.** Práce, ruční náklady, ceny a agregace existují. Nedoložen jednotný schválený nákladový zdroj/snapshot, úplnost sazeb, srovnatelná měna/báze, deduplikace externích zdrojů a nezávislost základního výpočtu na invoice tabulkách.

**Cílové body:** `C:\vyvoj\diriqo\lib\dal\economics.ts:130` (`listJobEconomicsSummaries`), shifts `:151`, logs `:175`, assignments `:198`, costs `:224`, loop `:241`, invoice vazba `:307`, `:323` (`getInvoiceRevenueByJobId`); `C:\vyvoj\diriqo\lib\economics.ts:16`, `:22`, `:26`, `:58` (`buildJobEconomicsSummary`); `C:\vyvoj\diriqo\lib\dal\jobs.ts:74` (`updateJobPrice`), `:102` (`createJobCostItem`), `:146` (`deleteJobCostItem`), `:173` (`updateJobAssignmentEconomics`); `C:\vyvoj\diriqo\app\business-actions.ts:600`, `:616`, `:650`, `:666`.

**Mezery:** shift/profile fallback, ve čteném dotazu bez volby schválené revize práce. Deduplikace work_logs/assignment podle job+profile není univerzální identita konkrétního nákladového zdroje. Zisk v `buildJobEconomicsSummary` vychází z invoicedRevenue; core musí fungovat bez fakturace a zobrazit plán/skutečnost, dohodnuto/fakturováno/zaplaceno samostatně. Null→0 může vytvořit falešnou marži; float nesplňuje přesná čísla. Toto není důkaz zjištěné chybné živé výplaty.

**Tabulky/SQL:** `job_cost_items`, `work_shifts`, `work_logs`, `job_assignments`, sazby, `job_economics_audit`; invoice_items/invoices/invoice_jobs jako volitelný adaptér. `expenses/fixed_costs` nejsou automaticky druhý náklad stejného zdroje. `C:\vyvoj\diriqo\supabase\migrations\20260506170000_add_company_settings_module.sql:292` job_cost_items; `C:\vyvoj\diriqo\supabase\migrations\20260506143000_add_job_cost_item_rpc.sql:30` (`create_job_cost_item`). Poslední nalezená číslovaná definice view `C:\vyvoj\diriqo\supabase\migrations\20260426110000_add_profit_to_job_economics_summary.sql:4`; **stejné job_economics_summary** předefinují `C:\vyvoj\diriqo\supabase\patch-job-economics-source-of-truth.sql:61` a `C:\vyvoj\diriqo\supabase\patch-diriqo-runtime-schema.sql:572`. Širší modul `C:\vyvoj\diriqo\supabase\migrations\20260516120000_add_costs_module.sql:13` tento kontrakt nenahrazuje. Která definice je účinná vyžaduje manifest/katalog.

**Guardy:** čtení marží, zadání nákladu, approval práce, změna sazby a historický recalc zvlášť. Approval uloží cost snapshot práce/revize/rate verze; oprava je auditovaná návazná událost. Unique source ID/company chrání retry i pozdější invoice link. Parent cena je alokace nebo dodatečné plnění podle explicitního pravidla, nikdy obojí současně. Záloha není druhý pracovní náklad.

**Testy/akceptace:** `C:\vyvoj\diriqo\tests\economics.test.ts:10` a labor helper testy jsou začátek. Legacy economics test očekává 3×19.9 = 59.699999999999996, takže green by neprokázal novou decimal přesnost. C10-01 approved hodiny + ruční materiál/cesta fungují bez inventory/invoicing, plán/skutečnost v téže měně a daňové bázi. C10-02 chybějící sazba je neúplnost/provisional, nikoli jistá nula/marže. C10-03 replay zdroje/pozdější invoice link nepřidá náklad znovu. Přidat přesné decimal příklady, currency mismatch, approved correction a parent rollup.

## Doporučené závislosti dalších dávek

1. Nyní plánovaná registry + DRAFT katalog dávka může proběhnout bez implementace domén a bez runtime přepnutí. Evidence C01–C10 patří do capability registry jako stav, nikoli jako marketingové tvrzení, že vše už funguje.
2. Před citlivými doménovými zápisy připnout manifest schématu, vyřešit tenant/platform role boundary a společný action/scope model; připravit decimal/currency, audit/revize/idempotenci.
3. Rozšířit stávající customers/jobs/worker membership: archivace, místa, stavové automaty a historické nákladové sazby; C05 neměnné verze, C01 atomický převod. Nepárovat osoby jen podle jména/e-mailu.
4. Sjednotit práci/approval/cost snapshot C04+C10, potom absence/calendar projekce C07+C06. Staré triggery měnit jen se známým výsledným řetězcem a kontrolou historie.
5. C08 více plateb/vyúčtování kompatibilní migrací; C09 autorizované přílohy/verzované předání. Core ověřit s vypnutými doplňky, až potom adaptéry inventory/invoice/AI/POS.

Je to návrh závislostí, nikoli provedená implementace nebo souhlas s produkčním nasazením/mazáním. Přenos Hub dat je zvláštní krok source→target ID map, zachování vazeb/verzí a karantény nejednoznačných záznamů. Současná sazba nesmí být domyšlena jako historická.

## Stav testů

V tomto úkolu **žádné testy ani build neběžely**. Cílová sada má sedm souborů: active-company-switch, auth-guards, economics, labor-calculation, public-token-security, worker-invites, worker-payroll. Původní audit skončil na infrastrukturním `spawn EPERM`: 0 spuštěných testů, 7 chyb runneru; není to 7 produktových regresí ani passing suite. Citované Hub testy jsou z předchozího auditu.

Po autorizaci příslušných změn validovat skutečný kontrakt: modelové testy decimal/čas/rollup, izolovaná DB/RLS/souběh pro transakce a UI průchod company A/B + worker/manager/no-login worker. Migrace, live katalog, data a UI dokazovat odděleně. Pouhá existence tlačítka nebo test zrcadlící implementaci nenahrazuje 30 výše uvedených acceptance scénářů.
