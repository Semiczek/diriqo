# Staging Diriqo Office

Tato sada používá oddělené Supabase větve. Její unit a hostitelské kontraktní testy nejsou důkazem vzdáleného staging běhu. Skutečné běhy obou hostitelů jsou již doloženy v `reports/staging-hub.json`, `reports/staging-diriqo.json` a navazujících reportech podle [TESTING.md](TESTING.md). Hostitelské Next servery běžely lokálně proti vzdáleným větvím se syntetickými daty, nikoli jako veřejné nasazení. Produkční databáze se tímto postupem nemigrují ani neplní testovacími daty.

## 1. Prostředí a kontrola cíle

Nejprve vytvořte dočasnou větev po schválení případné ceny. Nekopírujte produkční uživatele, hesla ani firemní data. Aktuální parent/branch ID ověřte v přihlášeném dashboardu nebo pomocí `list_branches`. Název větve musí obsahovat `office-staging`. Větev nikdy neslučujte do produkce.

Do `reports/staging-targets.json` vložte pouze skutečně ověřené identifikátory:

```json
{
  "schemaVersion": 1,
  "hosts": {
    "hub": {
      "projectRef": "REF_NOVE_OVERENE_VETVE",
      "parentRef": "yrxfozthravgbbcqklzy",
      "organizationId": "ljkxtwounsysoalxgsvw",
      "branchId": "UUID_VETVE",
      "name": "office-staging-20261011",
      "verifiedAt": "AKTUALNI_UTC_ISO_CAS"
    }
  }
}
```

Pro Diriqo použijte host `diriqo`, parent `wfcpfraxiuhuglnuaxqj` a organizaci `uxtwbwyxadetdybttoug`. Ověření platí nejvýše 24 hodin. Manifest je lokální záznam kontroly, nikoli kryptografická atestace Supabase; nikdy do něj nezapisujte domnělé ID. Oba produkční project refs jsou ve spouštěči výslovně zakázané. URL se odvozuje z ověřeného ref, nelze ji přepsat parametrem nebo `.env`.

Před migrací a seedem proveďte read-only katalogovou kontrolu podle [STAGING_PROVISIONING.md](STAGING_PROVISIONING.md). Repozitáře nemají úplnou výchozí definici všech hostitelských tabulek. Prázdný `remote_schema.sql` není základ, ze kterého lze bezpečně odhadnout produkční strukturu. Neznámý povinný sloupec, enum nebo trigger znamená zastavení přípravy a doplnění schématu z ověřeného staging katalogu.

Samotný preflight SQL prošel lokální kontrolou v transakci `READ ONLY` pro oba hostitelské fixtures, včetně rozpoznání neprázdné databáze a zamítnutých práv authenticated na dvě tabulky `office_private`. Report `reports/staging-preflight-local.json` je pouze lokální důkaz. Opakování: `node tests/staging-preflight-local.mjs` s již prověřeným `OFFICE_PGLITE_MODULE` podle TESTING.md; tato volitelná kontrola nic neinstaluje a není součástí vzdáleného staging běhu.

## 2. Syntetické účty

Ve větvi vytvořte dvě testovací firmy a sedm samostatných účtů: `ownerA`, `editorA`, `readerA`, `ownerB`, `editorB`, `readerB`, `aiA`. Každý lidský účet smí být členem jen své testovací firmy. AI je editor firmy A se serverově nastaveným `app_metadata.office_principal = "ai"`. Běžné účty nesmějí mít tento AI claim. Role, profily a hostitelské capability nastavte podle skutečného katalogu a provisioning dokumentu.

Použijte Supabase Auth Admin API `createUser` s potvrzeným e-mailem, aby nevznikaly odchozí pozvánky. Doména musí být `office-staging.invalid`, například `office-owner-a-<run>@office-staging.invalid`. Admin klíč slouží pouze k oddělenému provisioningu nové větve; testovací spouštěč ho nepřijímá. Testy používají skutečné přihlášení heslem, poté `/auth/v1/user` a vlastní JWT každého účtu.

Lokálně vytvořte `.staging/hub.credentials.json` (analogicky pro Diriqo):

```json
{
  "schemaVersion": 1,
  "projectRef": "REF_NOVE_OVERENE_VETVE",
  "publishableKey": "PUBLIKOVATELNY_KLIC_TETO_VETVE",
  "actors": {
    "ownerA": {
      "email": "office-owner-a-run@office-staging.invalid",
      "password": "UNIKATNI_NAHODNE_HESLO_NEJMENE_16_ZNAKU",
      "userId": "SKUTECNE_AUTH_USER_UUID",
      "tenantId": "SKUTECNE_UUID_TESTOVACI_FIRMY_A",
      "principal": "human"
    }
  }
}
```

Doplňte všech sedm účtů ve stejném tvaru. `aiA` má principal `ai`. Složka `.staging/` je ignorována a není součástí distribučního archivu. Soubor chraňte oprávněními OS; hesla ani JWT neposílejte do chatu, reportů či Git. Účty včetně dat zaniknou při schváleném odstranění dočasné větve. Skript sám nic nemaže a nevytváří účty, větve ani nové tarify.

## 3. Běh

```powershell
# Bez sítě a zápisů: kontrola cíle, identity konfigurace a publishable klíče
node scripts/staging-run.mjs --host hub

# Skutečná přihlášení, oddělené authenticated RPC a označené testovací dokumenty
node scripts/staging-run.mjs --host hub --execute --race-rounds 3
node scripts/staging-run.mjs --host diriqo --execute --race-rounds 3
```

Spouštěč nesahá do `.env` hostitelů. Odmítne service-role/secret klíč, produkční ref, neověřenou či starou větev, přesměrování a JWT jiného projektu. Všechny identity přihlásí před první Office mutací. Nepřebírá odpověď poskytovatele do diagnostické chyby, takže se do reportu nekopírují tokeny nebo hesla. HTTP požadavky mají časové a velikostní limity; mutace nemají automatický retry. Kontrolní běh vytváří pouze označené syntetické Office soubory. Standardně třikrát zopakuje čtyři kolizní scénáře.

Izolační sada kontroluje obě firmy a role, cizí ID i podvržené company ID, dokumenty i sešity, historii, neměnné originály, kopii/obnovu, idempotenci a návrh AI s lidským schválením. Kolizní sada spouští dva HTTP požadavky po společné bariéře: dvě změny stejné revize, totožný retry, stejný klíč s různým obsahem a nezávislé firmy. Ověřuje přesnou výslednou revizi a obsah celé historie. Časování síťových požadavků nedokazuje konkrétní pořadí PostgreSQL zámků.

Úspěch RPC je označen `RPC_PASS_ACCEPTANCE_PENDING`. Neznamená kompletní akceptaci hostitelské aplikace. Dokončete také přihlášený průchod `/office` a `/api/office/files`, změnu aktivní firmy, vypnutí modulu za provozu, přímé privátní granty/RLS, vazby na zakázky, upload/download přes hostovaný worker a chování při ztrátě připojení. Výsledky browseru a hosting limitů evidujte samostatně. PDF tisk vyžaduje vizuální kontrolu.

### Doložené běhy obou hostitelů

Výsledky z 11. 10. 2026: každý host RPC 410/410 kontrol při 239 požadavcích, výchozí vypnutí/zapnutí 14, následné vypnutí/obnova 7 a vazby/přímý přístup 22. Diriqo navíc capability 6 + 2. Host HTTP prošel 49 kontrolami Hubu a 47 Diriqo. Samostatné `reports/staging-hub-inflight-lock-proof.json` a `reports/staging-diriqo-inflight-lock-proof.json` přidávají každý 12 kontrol vypnutí během ukládání a sanitizované pozorování zámků v nezávislých DB sessions. Nezaměňujte finální Diriqo důkaz se starším neúspěšným `staging-diriqo-inflight.json`, kde se HTTP operace nepřekryly.

Pro opakování in-flight scénáře nejprve připravte označený soubor přes `scripts/staging-inflight.mjs prepare`, poté spusťte `run` v koordinaci s odděleným DB pozorováním na ověřené staging větvi. Samotný helper používá skutečný lidský JWT pro save i operátorské vypnutí, čeká na dokončení obou požadavků před opětovným zapnutím a neprokazuje DB čekání pouze časem HTTP. Dočasné DB pozorovací prostředky po testu odstraňte a odstranění ověřte. Nevkládejte JWT ani surový text SQL požadavků do reportu.

Selhání automatického branch replay se neopravuje odhadem hostitelských tabulek. Diriqo bylo pro tento běh připraveno skutečným bootstrapem a konkrétními zdrojovými migracemi s výjimkami zaznamenanými v `reports/staging-diriqo-provenance.json`. Nejde o úplnou reprodukci hostitelského schématu. Finální UI scénáře a veřejný deployment stále vyžadují samostatný důkaz.

Hub získal po výslovně schváleném read-only přístupu ke zdrojovému technickému katalogu skutečné schéma potřebné pro Office. Shoda 13 relací, 4 enumů a 16 funkcí, RLS a explicitních oprávnění je v `reports/hub-schema-fidelity.json`; žádné produkční aplikační řádky ani uživatelé se nekopírovali. Tuto cestu nelze nahradit bootstrapem Diriqo ani testovacími PGlite fixtures.

Lokální přípravu oddělujte od stagingu: `npm test` nevyžaduje host checkouty; `npm run test:hosts:check` a `npm run test:hosts` vyžadují dva skutečné izolované checkouty na revizích z `release/DELIVERY.json` s aplikovanými patchemi podle [ENABLEMENT.md](ENABLEMENT.md). Tyto příkazy neprovádějí vzdálené operace ani nové instalace.

## 4. Náklady a úklid

Původní kontrola ceny 11. 10. 2026 našla JSPD Holding s.r.o. na Pro a Diriqo na Free. Uživatel následně sám potvrdil upgrade Diriqo na Pro; dočasné větve obou hostitelů již vznikly. Zaznamenaná nabídka branch compute byla 0,01344 USD/h bez daně; pro Hub byl schválen strop 1 USD. Jde o záznam konkrétní kontroly ceny, nikoli záruku konečné faktury nebo automatické vynucení rozpočtu skriptem. Před dalším zřizováním znovu ověřte cenu a oprávnění. U větví mohou přibýt poplatky za spotřebu ([oficiální pravidla](https://supabase.com/docs/guides/platform/manage-your-usage/branching)). Jde o infrastrukturu, nikoli licenci editoru.

Po testech uložte reporty bez tajných údajů a odstraňte pouze výslovně určenou dočasnou větev. Před odstraněním znovu ověřte její ID a parent. Nemergujte migrace, nepřepínejte produkční flagy a neměňte tarif bez samostatného schválení. Poté zneplatněte lokální manifest odstraněné větve a odstraňte její lokální testovací přístupové údaje.

## Ukončený běh 11. 10. 2026

Obě větve z tohoto běhu jsou smazané, jejich nepřítomnost ověřena přes `list_branches`, lokální servery zastavené. `reports/staging-targets.json` má prázdné `hosts`, takže další síťový běh selže bezpečně. Historické reporty zachovávají ID zaniklých cílů; pro opakování je nutná nová schválená větev a aktuální kontrola manifestu. Výsledek: [STAGING_ACCEPTANCE.md](STAGING_ACCEPTANCE.md), úklid `reports/staging-cleanup.json`.
