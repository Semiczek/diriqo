# Android testovací vydání — 11. 10. 2026

Dvě online hybridní APK 0.1.0-test, Android 8+. My Diriqo (`com.diriqo.my`) otevírá vlastní práci na `/mobile/my`; Diriqo Manager (`com.diriqo.manager`) provozní přehled na `/mobile/manager`. Server je výhradně Diriqo, `app.diriqo.com`; žádné propojení s JSPD Hubem.

Obě varianty sdílejí existující logo Diriqo a paletu fialová `#7c3aed`, modrá `#2563eb`, tyrkysová `#06b6d4` s bílými plochami. Samostatný zelený motiv Manageru byl na přání uživatele odstraněn. Zelená se používá pouze pro úspěch/stav práce.

## Doložené ověření

- Android: obě varianty sestavené, podpisy APK ověřené, lint a 14 běhů JVM policy testů úspěšné. GitHub Android APK workflow úspěšné na `9bd78b3`.
- Vyhrazený emulátor Android API 37: obě aplikace 2/2 instrumentační testy. Úvod, konfigurace WebView, skutečné vykreslené veřejné přihlášení z nasazeného mobilního vstupu, stav bez internetu a přečtení syntetického lokálního souboru přes file chooser callback. Žádné uživatelské přihlašovací údaje ani obchodní záznamy v emulátoru. Emulátor po zkoušce ukončen.
- Webová část PR #8: 902 Vitest testů, TypeScript, ESLint, GitHub CI a Vercel build úspěšné. Produkční nasazení `36a82c68c92a725159d7034d07241645cb6cccfb`, deployment `dpl_9h1GXgfsbWf2NXmNi5FKM1wHfANt` READY s aliasem `app.diriqo.com`.
- Přihlášené webové UI na Demo / Adam Admin: My Diriqo 11 přiřazených zakázek, Manager 24 zakázek, 6 aktivních členů, 0 běžících směn a odkazy na dostupné moduly. Kontrola v šířce 390 px. Živé ověření pod čistou rolí worker/manager se tím netvrdí; oddělení rolí kontrolují serverové testy.
- Následná oprava: 39 souborů / 930 Vitest testů, TypeScript a cílený ESLint úspěšné. Nová APK se sjednocenou značkou znovu prošla sestavením, lintem, 14 JVM testy a kontrolou podpisů.

## Opravy z živé kontroly

Serverový `service_role` v existující databázi neměl potřebné tabulkové ani sloupcové SELECT oprávnění. To neodhalily mockované TS testy. Cílená migrace `20261011175514_mobile_server_runtime_grants.sql` poskytuje jen potřebné sloupce a operace pro serverové přehledy, směny a fotky. Nepřidává veřejné granty, DELETE, mzdové údaje ani správu členství; RLS zůstává aktivní. Skutečný SQL test `tests/mobile-runtime-grants-verification.sql` prošel v projektu `wfcpfraxiuhuglnuaxqj` včetně provedení čtecích dotazů jako service_role.

Mobilní fotky používají ověřené company/job/category cesty, serverem autorizovaný upload a potvrzení metadat. Volby Fotka před / Fotka po otevírají přímo výběr souboru; původní tlačítko Po nemělo dostupný file input. Časy práce používají firemní časové pásmo i při serverovém vykreslení.

## Hranice a pilot

APK mají testovací podpis. Nejde o Google Play vydání, plně nativní pracovní obrazovky, offline synchronizaci, push, GPS docházku ani biometrické přihlášení. Skutečný fotoaparát, ukládání dokumentů, přihlášení a celý pracovní den na fyzickém telefonu vyžadují pilot. Syntetický test file chooseru není důkazem fyzické kamery nebo vzdáleného uploadu. Souběžný start směny z více zařízení není atomický.

APK neobsahují service-role ani OpenAI klíč. Relace obou aplikací jsou oddělené. Role, aktivní firma a placené moduly zůstávají serverově vynucené.

## Předávané soubory

- My-Diriqo-0.1.0-test.apk — SHA256 `F19C31B6221C74C3F1188DC098236A36DB189F6C42E466B3B3746B3069103B36`
- Diriqo-Manager-0.1.0-test.apk — SHA256 `766F2A5FA18A35E2032AF9C3887559C080EF0D07ECA87F3F1CBF01440BD23819`

Zdroj Androidu a sestavení: `apps/android/README.md`. Při rollbacku zachovejte obchodní data a historické fotografie. Web před PR #8 neobsahuje mobilní vstupy. Nová databázová oprávnění neodvolávejte bez posouzení užívajících serverových cest.
