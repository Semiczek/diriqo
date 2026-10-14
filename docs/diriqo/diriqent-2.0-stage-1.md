# Diriqent 2.0 — první etapa

Stav k 14. 10. 2026: lokální implementace na větvi `codex/diriqent-2.0`, výchozí commit `ac07949`. Změny nejsou nasazené ani aplikované na živou databázi. Původní checkout s rozpracovanou fakturací zůstává oddělený.

## Dostupné chování

- `/diriqent` otevírá podporu bez kreditu. Po ověření aktivního členství používá pouze místní katalog návodů. Nemá business RPC, rezervaci kreditu ani volání modelu. Funguje bez placeného modulu a bez nakonfigurovaného AI klíče. Neznámé otázky žádají upřesnění; odpovědi na firemní data nevymýšlí.
- `/diriqent?mode=work` otevírá dosavadní placenou práci s daty a návrhy. Otevření nic neúčtuje, odeslání má výslovný limit. Rozpoznaný návod, základní otázka nebo odmítnutí oprávnění i zde vrací podporu za 0 Kč. Přechod z podpory sám nespustí AI ani nepřenese požadavek k provedení.
- Navigace a stávající panel nápovědy odkazují na podporu i bez licence Diriqenta. Samostatné OCR zachovává oprávnění příslušného modulu a dosavadní účtování.
- Návrhy zakázek zůstávají pod samostatným potvrzením administrátora. Existující kreditní ledger, limity, idempotence, vyúčtování a testovací tarif `diriqent-test-czk-v1` se nemění.

## Oprávnění a změna role

Rozsah záznamu se přiděluje v databázi podle aktuálního členství: `worker`, `manager`, `company_admin`. Klient ani text otázky jej nenastavují. Aplikační role `company_admin` a `super_admin` reprezentují administrátorský rozsah; právní vlastnictví firmy systém touto rolí neprokazuje.

Historie, názvy rozhovorů, výsledky, návrhy, jednotlivý i úplný export a kontext historie pro poskytovatele ověřují aktuální rozsah. Po změně administrátora na manažera se jeho dřívější administrátorské záznamy nezpřístupní. Při změně rozsahu je nutný nový rozhovor; nelze znovu použít původní request ID k načtení vyššího rozsahu. Vlastní nižší historie zůstává čitelná po zvýšení role. Jiný účet ani jiná firma k ní nezískají přístup.

Nejednoznačné staré záznamy s `requires_manager=true` se konzervativně převedou na `company_admin`, včetně starých manažerských rozhovorů. Staré vlastní pracovní záznamy zůstanou `worker`; návrhy jsou vždy administrátorské. Obsah se nemaže. Nová aplikace bez migračního markeru placenou práci odmítne ještě před rezervací kreditu; podpora zůstává dostupná.

Otevřená stránka při návratu do okna nebo při změně firmy nejprve skryje obsah a ověří členství. Nejistota nebo změna identity obsah odpojí až do obnovení stránky. Kontrola používá stávající událost přepnutí firmy z DashboardShell/Office. Stejná role při krátkém ověřování neztrácí rozepsané zadání. V aktivní záložce probíhá kontrola nejvýše každých 30 sekund; skryté záložky se nedotazují. Již doručený obsah či dříve stažený export nelze zpětně odvolat. Server a databáze ověřují každý nový požadavek nezávisle na tomto UI opatření.

## Ověření a omezení

Prošlo 221 testů Vitest (osm sad; po poslední úpravě samostatně zopakována sada šesti kontrol identity) a 84 SQL asercí: šest migračních, 36 původních integračních a 42 oprávnění. SQL regrese zahrnuje také 1001 novějších nepřístupných administrátorských operací a 60 rozhovorů: nevyčerpají manažerův limit exportu a nevytlačí jeho dostupnou historii. Kontroly rolí se provádějí před stránkováním a počítáním záznamů.

Testy běží bez skutečných klíčů a placených API. Lokální SQL runner načítá skutečné dvě původní migrace Diriqenta a novou migraci do PGlite 0.5.9; okolní Auth/Core/module-entitlement vrstva je minimální testovací fixture. Ověřuje přímé RLS, RPC, změny rolí, původní kreditní integraci a zachování dat. Neprokazuje chování živého Supabase, souběžných transakcí ani kompletního prohlížeče s přihlášenými účty.

Paměťově omezené příkazy se spouštějí jednotlivě:

```powershell
node --max-old-space-size=384 node_modules/vitest/vitest.mjs run tests/diriqent-support.test.ts tests/diriqent-domain.test.ts tests/diriqent-provider.test.ts tests/diriqent-support-boundary.test.ts tests/diriqent-actions-access.test.ts tests/diriqent-server-access.test.ts tests/diriqent-context-watch.test.ts tests/diriqent-page.test.ts --maxWorkers=1 --no-file-parallelism
node --max-old-space-size=512 node_modules/typescript/bin/tsc --project tsconfig.diriqent.json --noEmit
node --max-old-space-size=384 scripts/test-diriqent-role-scope.mjs
```

Závislost SQL runneru je pouze v ignorovaném `work/validation-deps`; instalační příkaz s pevnou verzí je v jeho hlavičce. Čistý checkout pro TypeScript potřebuje běžný lokální `next-env.d.ts` s referencemi na `next` a `next/image-types/global`, který Next obvykle generuje a Git ignoruje.

Celoprojektový TypeScript překročil záměrný limit 640 MB; limit nebyl zvýšen. Omezená kontrola upravené části včetně jejích importů prošla s limitem 512 MB. ESLint upravených souborů prošel. Plný build a přihlášený browser test nebyly kvůli vysokému využití RAM spuštěny.

Před nasazením je nutné aplikovat `20261013185010_diriqent_role_scopes.sql` ve schváleném prostředí a otestovat přihlášené role nad skutečnými politikami. Dále následují nástroje napříč moduly, Office AIAdapter, kontext aktuální stránky a samostatné sazby složitější analytiky. První etapa tyto nové analytické funkce ani jejich ceny nezavádí.
