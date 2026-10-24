# Zákaznický portál: obnovení vlastního přístupu a kontextu

Datum: 24. 10. 2026. Samostatný opravný celek připravený pro budoucí PR. Databázová migrace je aplikovaná pouze na testovacím projektu `wfcpfraxiuhuglnuaxqj`. Změna aplikace je zatím místní, bez commitu, CI a nasazení tohoto celku. Celá akceptace C05 ani připravenost portálu tímto dokumentem nejsou uzavřené.

## Problém a výsledné chování

Platně přihlášený zákazník bez zaměstnaneckého profilu a firemního členství nedokázal otevřít své nabídky. Živé RLS obsahovalo pouze čtení pro členy firmy a zápisy správce. Produktový lookup portálového účtu vracel HTTP 200 s prázdným výsledkem; `/portal/offers` přesměrovalo HTTP 307 na `/portal/login?error=no-portal-access` a zákaznické PDF vracelo HTTP 401. Stejná přihlášená identita současně úspěšně načetla jednu vlastní verzi nabídky přes zákaznické RPC. Chyba tedy nebyla v heslu ani ve vytvořené nabídce.

Druhou překážkou bylo následné čtení `customers` přes `service_role`, který na této tabulce nemá oprávnění SELECT. Oprava nepřidává široké serverové granty. Nová SELECT policy umožňuje zákazníkovi číst jen vlastní aktivní portálovou vazbu. Serverový guard po ověření `getUser()` volá bezparametrové `get_customer_portal_context()`; privátní funkce odvodí identitu z `auth.uid()`, vyžaduje právě jednu aktivní vazbu a spojí zákazníka současně podle `customer_id` i `company_id`. Vrací pouze identifikátory kontextu, kontaktní e-mail a zobrazovaná jména.

Chybějící, neaktivní, nejednoznačná či nekonzistentní vazba nevrátí kontext. Funkce počítá aktivní vazby před spojením se zákazníkem, takže nesprávná druhá vazba nemůže nejednoznačnost skrýt. Veřejný wrapper je `SECURITY INVOKER`, privátní funkce má prázdný `search_path`; EXECUTE je povoleno jen `authenticated`. Stávající firemní policies a oprávnění k zápisu zůstávají zachované.

## Ověření tohoto celku

- Místní PGlite nejprve reprodukoval skutečný výchozí problém `own_active_link_proxy_read`, po chybě ověřil rollback a poté aplikoval skutečnou migraci.
- Místní i hostovaná SQL sada: **33 scénářů + 5 kontrol rollbacku PASS**. Pokrývá vlastní a cizí identitu, firmu, neaktivní vazbu, zakázané vlastní INSERT/UPDATE/DELETE, správce a člena firmy, minimální DTO, ACL, nejednoznačné vazby a opětovné načtení po změně oprávnění.
- Cílené aplikační testy: **41/41 PASS**, `tests/customer-portal-context.test.ts` a existující `tests/portal-identity-security.test.ts`.
- TypeScript `tsc --noEmit`: PASS. Kontrola diffu: PASS. Nezávislé review dotčených souborů nenašlo blokující chybu.
- Skutečná předmigrační HTTP reprodukce používala samostatný cookie jar syntetického zákazníka; účet administrátora v prohlížeči nebyl přepínán. Testovací relace byla odhlášena.
- Hostovaná kontrola po migraci potvrdila shodu původních otisků zákazníků `a5d137e8392f76925dbe091492e5ee6e` a portálových vazeb `1bc6b5d2bb9a8731015d011e24823e6b` s preflight stavem. SQL fixture byly vráceny rollbackem.
- Supabase advisors před/po: **121 jednotlivých nálezů**, žádný přidaný ani odebraný. Tento výsledek neoznačuje dřívější nálezy za vyřešené.

Reprodukovatelné lokální příkazy používají existující absolutní cestu `PGLITE_MODULE` a Node 24:

```text
node scripts/test-customer-portal-context-sql.mjs
node node_modules/vitest/vitest.mjs run tests/customer-portal-context.test.ts tests/portal-identity-security.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

## Migrace a důkazy

Aplikovaná verze: `20261024065332_restore_customer_portal_context.sql`. Lokální soubor byl přejmenován na přesný timestamp hostované historie; obsah se nezměnil. SHA-256 těla souboru:

`5d42d2bb69338da61ddbb8261139341ba892f62a3ce11abfe5bd8afbabad19f6`

Privátní hostovaný důkaz: `artifacts/portal/context-hosted-20261024.json`, SHA-256:

`6afd47949859934c25a0c16f1a3fe5cc63d9685c2782501f05ad150181e60082`

Předmigrační HTTP reprodukce je v pracovním souboru `C:\Users\semis\AppData\Local\Temp\diriqo-core-ui-pr40-20261024\portal-repro\report.json`. Obsahuje HTTP statusy, výsledek přesných produktových projekcí a potvrzení odhlášení; neobsahuje přihlašovací heslo ani session tokeny.

Souběžně ověřené zachování veřejného PDF verze A po vytvoření B a konverzi je **oddělený důkaz C05**, nikoli důkaz nasazení této opravy portálu: SHA-256 `14688ceada8e9ab7c6bfa4e18defdc1ea6eea19cde0f9cc4dba0367ae558ea25` zůstalo byte-identické.

## Dokončení vydání a návrat

Po commitu a samostatném PR doložit CI, přesný SHA nasazení a přihlášené HTTP čtení seznamu, detailu konkrétní verze i skutečného PDF. Opakovat zákaznické čtení po nové verzi nabídky; kontrolovat absenci interního nákladového canary v JSON, HTML i extrahovaném PDF. Úspěch SQL nebo READY deployment sám tento průchod nenahrazuje.

Aplikovanou migraci neupravovat. Případná další změna oprávnění musí být nová cílená migrace. Nové objekty jsou čtecí a není potřeba mazat zákazníky ani vazby. Preferovat dopřednou opravu; návrat na předchozí aplikaci obnoví známý problém kontextu. Databázové funkce neodebírat, dokud na nich může záviset nasazený klient.

## Potvrzené hranice a další nálezy

- Oprava nepřidává zákazníkovi profil zaměstnance, členství ve firmě, placený modul ani novou možnost zápisu. E-mail se při tomto ověření neposílal.
- `createPortalInquiryAction` nadále čte `customers` přes admin klienta. Při ověřeném chybějícím SELECT tato část nedokáže načíst zákazníka; poptávkový tok tento celek neopravuje.
- Portálový dashboard současně načítá zakázky a faktury přes další admin readery. Jejich tabulková oprávnění a celý dashboard zde nejsou ověřené. Totéž platí pro odloženou opravu fakturačního exportu a QR.
- **Potvrzený rozpor kódu se schématem:** `app/api/customer-portal-users/route.ts:189` při vytvoření vazby neuvádí `company_id`. Živý katalog dne 24. 10. 2026 potvrdil `company_id uuid NOT NULL`, bez výchozí hodnoty, bez uživatelských triggerů a bez přepisovacích pravidel na `customer_portal_users`. Pokud se tato větev dostane k INSERT, nemůže požadavek ve stávajícím schématu uspět. Celý endpoint nebyl volán a jeho HTTP chyba není samostatně reprodukovaná; jeho standardní dokončení posílá resetovací e-mail. Oprava tohoto navazujícího rozsahu v tomto celku není provedena.
