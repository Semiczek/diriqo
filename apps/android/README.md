# My Diriqo a Diriqo Manager pro Android

Dvě samostatně instalovatelné **online testovací aplikace** nad stejným Diriqo účtem. Nativní Android část poskytuje úvod, navigaci, bezpečný WebView, výběr souborů, volbu fotoaparátu, ukládání dokumentů a chybovou obrazovku. Pracovní obrazovky a jejich autorizace běží na `https://app.diriqo.com`. Toto vydání není kompletně nativní klient ani offline synchronizace.

| Varianta | Balíček | Serverový vstup |
| --- | --- | --- |
| My Diriqo | `com.diriqo.my` | `/mobile/my` |
| Diriqo Manager | `com.diriqo.manager` | `/mobile/manager` |

My Diriqo: vlastní přiřazené zakázky, start/stop směny, pracovní fotografie a předání dokončené práce. `/mobile/my/finish` zpřístupňuje pouze vlastní otevřené směny i po expiraci licence nebo odstranění přiřazení. Starší rozpracovaná přiřazení se doplňují nad posledních 100 záznamů.

Manager: provozní přehled zakázek, aktivního týmu, běžících směn a dostupných modulů. Vyžaduje roli manager/company_admin/super_admin v právě zvolené firmě. **Role manager tím nezískává administraci cen, mezd ani plnou editaci Core zakázek.** Existující moduly nadále vynucují svoje role a licence.

## Instalace testovacího APK

Android 8.0 nebo novější, připojení k internetu a aktuální Android System WebView. Na telefonu otevřete odpovídající APK a přihlaste se běžným účtem Diriqo. Obě aplikace mohou být nainstalované zároveň; přihlášení mají oddělená. Pokud Android zobrazí potvrzení instalace z daného zdroje, dokončete ho sami. Nevypínejte ochranu telefonu. Žádné tajné klíče nejsou potřeba.

Debug APK jsou určené pro interní zkoušky. Pro Google Play je potřeba samostatný release podpis, AAB, záznam aplikace a dokončené ověření na telefonech. Klíče pro release se do repozitáře neukládají.

## Sestavení a testy

JDK 21+ (lokálně ověřeno JBR 25), Android SDK 36/build-tools 36.0.0, Gradle wrapper 9.5.0 a AGP 9.3.0. V `ANDROID_HOME` nastavte cestu k Android SDK.

```powershell
.\gradlew.bat --no-daemon :app:assembleEmployeeDebug :app:assembleManagerDebug
.\gradlew.bat --no-daemon :app:testEmployeeDebugUnitTest :app:testManagerDebugUnitTest :app:lintEmployeeDebug :app:lintManagerDebug
```

APK vzniknou v `app/build/outputs/apk/{employee,manager}/debug/`. V synchronizované složce může OneDrive zamknout mezivýstupy; nastavte `DIRIQO_ANDROID_BUILD_ROOT` na nesynchronizovanou absolutní cestu a případně `--project-cache-dir` mimo OneDrive.

Pro instrumentační test použijte **nový vyhrazený emulátor** bez skutečných účtů. Test ověřuje spuštění, zabezpečení WebView, skutečný veřejný přihlašovací formulář a stav při odpojení. Nepřihlašuje uživatele ani nevytváří obchodní záznamy. Výsledné obrázky jsou v externí soukromé složce aplikace `files/test-evidence/`.

```powershell
.\gradlew.bat --no-daemon :app:connectedEmployeeDebugAndroidTest
.\gradlew.bat --no-daemon :app:connectedManagerDebugAndroidTest
```

## Bezpečnost a hranice

- Přihlášení probíhá přímo na Diriqo HTTPS originu. Žádný service-role/OpenAI klíč, bearer token z webu ani JavaScript bridge se do Android kódu nepřenáší.
- WebView odmítá cleartext, TLS chyby, neznámé hlavní originy, file/content navigace a nepovolené externí intent URI. Automatické JavaScript popupy a vzdálené požadavky na mikrofon/polohu jsou zamítnuté.
- Výběr a focení spouští uživatel; fotoaparát dostává dočasný přístup pouze k jednom náhodně pojmenovanému souboru v cache. Nevyžadujeme plošné čtení úložiště ani polohu na pozadí.
- Dokument se uloží do místa vybraného uživatelem; limit 25 MB, cookies pouze na app.diriqo.com. Povolené přesměrování do privátního podepsaného Diriqo Storage URL nepřenáší cookies.
- Backup a přenos dat mezi zařízeními jsou vypnuté. Nativní odhlášení odstraní cookies a místní webová data jen této aplikace. Mobilní webové odhlášení odvolá pouze aktuální Supabase relaci.
- Zápisy se bez internetu neukládají do outboxu ani automaticky neopakují. Obnovení načítá GET stránku; uživatel má před opakováním nejasného výsledku ověřit skutečný stav.
- Push notifikace, offline režim, biometrické přihlášení, GPS docházka a publikace na Google Play nejsou součástí tohoto vydání. Kamera, dokumenty a přihlášený pracovní průchod potřebují také pilotní ověření na skutečném telefonu.
- Starší serverové spuštění směny používá read-before-insert; samostatný DB krok je potřeba pro úplnou ochranu proti současnému spuštění z více zařízení. Aplikace z toho nedělá důkaz atomické synchronizace.

## Nasazení a návrat

Nejdřív nasaďte webové mobilní vstupy z této změny, teprve poté distribuujte APK. Nevzniká nová databáze ani migrace. Při rollbacku webu na verzi před mobilními vstupy budou APK bez pracovního přehledu; přihlášení a běžný web jsou samostatné. Nemažte pracovní záznamy ani licence kvůli rollbacku aplikace.

Technické reference: [AGP 9.3](https://developer.android.com/build/releases/agp-9-3-0-release-notes), [WebView](https://developer.android.com/reference/android/webkit/WebView), [Supabase lokální odhlášení](https://supabase.com/docs/reference/javascript/auth-signout).
