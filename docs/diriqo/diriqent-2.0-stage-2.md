# Diriqent 2.0 — druhá etapa: analytika a plány

Stav k 14. 10. 2026: implementováno a ověřeno lokálně v repozitáři **Diriqo**, větev `codex/diriqent-2.0`. JSPD Hub se nemění. Tato etapa navazuje na [první etapu](./diriqent-2.0-stage-1.md). Není nasazená a migrace nebyly aplikované na živou databázi.

## Oddělené režimy a cena

- `/diriqent`: deterministická podpora a základní informace za 0 Kč; bez rezervace, modelu a načítání firemních podkladů. Zůstává dostupná bez placeného modulu a AI klíče.
- `/diriqent?mode=work`: jednoduché dotazy k dostupným záznamům a dosavadní návrh zakázky. Rozpoznanou podporu vyřídí zdarma. Zjevné požadavky na analýzu nebo plán odkáže k samostatnému potvrzení, bez rezervace; původní text ponechá ve formuláři. Toto rozpoznání je omezené pravidly, není úplným klasifikátorem přirozeného jazyka. Běžný model má pokyn zpracovávat pouze jednoduché dotazy.
- `/diriqent?mode=advanced`: analýza nebo návrh kroků složitějšího úkolu. Uživatel vybere podklady, období a limit 1–50 Kč. První krok jen uloží neměnné zadání a ukáže potvrzení. Teprve souhlas s konkrétním zadáním, sazbou a maximální částkou dovolí rezervaci a spuštění.

Analytika používá **lokální testovací sazbu 2×**, plány **3×** běžného dotazu při stejné spotřebě tokenů. Jde o verze `diriqent-analytics-test-czk-v1` a `diriqent-plan-test-czk-v1`; produkční ceník ani placená nastavení se nemění. Interní podklad používá stávající testovací tokenové náklady a kurz, nikoli nově ověřený aktuální ceník poskytovatele. Skutečná spotřeba se zaokrouhlí nahoru na kreditní jednotku a omezí schválenou rezervou. Nepoužitelný výsledek účtuje nulu. Neznámá skutečná spotřeba zůstává k ověření.

Databázové potvrzení platí 10 minut a svazuje firmu, uživatele, aktuální rozsah oprávnění, režim, podklady, období, text, limit a verzi sazby. Spouštěcí požadavek obsahuje jeho ID a výslovně přijaté podmínky; klient znovu nedodává text ani podklady. Jedno potvrzení může vytvořit jedinou operaci. Stejné ID opakovaného požadavku vrací stejnou operaci, rezervace ani provider POST se neopakují. Potvrzení a cenový snímek zahájeného pokusu nelze přepsat.

Při ztrátě odpovědi formulář připouští, že již mohlo dojít ke spuštění, zachová původní ID a nabídne ověření stejného požadavku. Neumožní mezitím zahodit zadání tlačítkem Upravit. Jednoznačné prvotní odmítnutí před zahájením dovolí opravu. Neznámý výsledek poskytovatele se nereprodukuje dalším POST požadavkem.

## Co lze vyhodnotit

Období obsahuje nejvýše 90 kalendářních dní včetně obou hranic, podle Europe/Prague. Zakázky se vybírají podle začátku v období, vlastní směny podle zahájení v období. Nejde o výčet všech zakázek, které s obdobím časově souvisejí.

| Role | Provozní podklady | Finanční podklady |
| --- | --- | --- |
| Pracovník | Vlastní přidělené zakázky a vlastní směny | Nedostupné |
| Manažer | Zakázky aktivní firmy a pouze vlastní směny | Nedostupné |
| Administrátor firmy / super_admin | Zakázky aktivní firmy a vlastní směny | Nominální hodnota zakázek zvlášť podle měny |

Server počítá počty zakázek, dokončené a po termínu, vlastní dokončené směny a evidované vlastní hodiny. U hodin respektuje uložené opravy s předností `job_hours_override`, potom `hours_override`, potom délku dokončené směny. Finanční podklady zahrnují pouze evidované ceny zakázek; neprokazují tržby, úhrady, peníze na účtu, marži ani zisk. Měny se nesčítají. Mzdy a bankovní zůstatky se nenačítají.

Jeden běh načte nejvýše 200 zakázek a 500 vlastních směn, pro odkazy na konkrétní kroky předá nejvýše 30 zakázek. Výsledek ukazuje počty podkladů, čas snímku a upozornění na neúplný výběr nezávisle na textu modelu. Překročení velikosti kontextu požadavek odmítne před voláním poskytovatele, kontext potichu neořízne.

Výstup má strukturovanou odpověď, závěry, odkazy na dostupné metriky, případně navržené kroky a omezení. Reference metrik a zakázek server validuje proti skutečnému snímku. Výklad AI vyžaduje lidské posouzení. Plán nic automaticky nezakládá, nepřiřazuje, neposílá ani nemění v zakázkách, fakturách nebo docházce. Existující potvrzování jednotlivého návrhu zakázky zůstává samostatné.

## Oprávnění a historie

Příprava, rezervace a provider claim používají aktuální serverové členství. Vyšší cenový limit nezvyšuje oprávnění. Změna role zneplatní nepoužité potvrzení s předchozím rozsahem. Historie a jednotlivý i úplný export nadále používají ochranu z první etapy: manažer po snížení role nedostane své starší administrátorské výsledky ani podklady.

Analýzy mají vlastní režim konverzace, samostatnou historii v UI a oddělený kontext pro model. Běžný chat nemůže pokračovat v konverzaci analytiky, ani pokud zatím neobsahuje operace. Pokročilý kontext sestavuje databáze; ignoruje podklady podvržené volajícím. Interní pomocná RPC i tabulka potvrzení nemají přímé oprávnění pro klienty.

Již doručená data a stažené exporty nelze zpětně odvolat. Kontrola otevřené stránky z první etapy omezuje přístup po změně identity; každý nový serverový požadavek má nezávislé ověření.

## Ověření s omezenou RAM

- **418 aplikačních testů**: celý běh 11 sad prošel s 410 testy, poté dotčená sada opět prošla s 31 testy včetně osmi nových regresí nejistého spuštění. Pokrytá je bezplatná podpora, režimy, validace, tarif, limity, role, historie/export, provider claim, parsování výsledků a ztracené odpovědi. Provider i API/DB transport jsou v těchto testech mockované.
- **142 SQL asercí**: 6 migračních, 36 původních kreditních, 42 rozsahů oprávnění a 58 potvrzené analytiky/plánů. Runner načítá skutečné migrace do jednoho lokálního PGlite, včetně přímých RLS/RPC, cenového stropu, zaokrouhlení, opakování, změn role, filtrace podkladů a oddělení měn. Okolní Auth/Core/entitlement vrstva zůstává minimální fixture. Po běhu databázi zavře.
- Omezená kontrola TypeScriptu části Diriqent včetně importů a testů prošla s limitem 512 MB. ESLint upravených souborů a kontrola whitespace prošly.

Testovací příkazy se spouštějí postupně, nikoli zároveň:

```powershell
node --max-old-space-size=384 node_modules/vitest/vitest.mjs run tests/diriqent-work.test.ts tests/diriqent-work-server.test.ts tests/diriqent-work-execution.test.ts tests/diriqent-support.test.ts tests/diriqent-domain.test.ts tests/diriqent-provider.test.ts tests/diriqent-support-boundary.test.ts tests/diriqent-actions-access.test.ts tests/diriqent-server-access.test.ts tests/diriqent-context-watch.test.ts tests/diriqent-page.test.ts --maxWorkers=1 --no-file-parallelism
node --max-old-space-size=384 scripts/test-diriqent-role-scope.mjs
node --max-old-space-size=512 node_modules/typescript/bin/tsc --project tsconfig.diriqent.json --noEmit
```

384/512 MB jsou limity JavaScript heapu, nikoli záruka stejného limitu celkové RAM procesu. Nebyl spuštěn plný build, dev server, browser ani živé placené API. Toto ověření neprokazuje produkční Supabase, souběžné transakce ani přihlášené UI. Použití dosavadního klíče zůstává schválené; klíč nebyl kopírován do pracovní kopie ani měněn.

## Nasazení a další rozsah

Před zpřístupněním je potřeba ve schváleném prostředí aplikovat postupně `20261013185010_diriqent_role_scopes.sql` a `20261014041318_diriqent_work_quotes.sql`, nasadit aplikaci a ověřit role i skutečný průchod v prohlížeči. Bez markeru nové migrace analytika odmítne spuštění; bezplatná podpora funguje dál.

Tato etapa pokrývá analytiku dostupných zakázek/vlastní docházky a návrhy práce nad nimi. Automatické provádění vícekrokových úloh napříč moduly, úplná finanční analytika, nové Office AI nástroje a napojení kontextu aktuální stránky jsou navazující rozsah.
