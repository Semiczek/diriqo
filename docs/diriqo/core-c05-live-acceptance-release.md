# C05: akceptace základních nabídek

24. 10. 2026. **C05-01, C05-02 a C05-03 jsou HOTOVO pro původní text scénářů.** Aktuální matice má 8 HOTOVO / 46 ČÁSTEČNĚ / 3 CHYBA / 11 CHYBÍ / 5 NEOVĚŘENO. Celý P16 ani komerční připravenost produktu tím nejsou doložené.

PR [#40](https://github.com/Semiczek/diriqo/pull/40), [#41](https://github.com/Semiczek/diriqo/pull/41) a [#42](https://github.com/Semiczek/diriqo/pull/42) jsou sloučené. Ověřená aplikace na app.diriqo.com: `3ed450a2d349cc65e03a5791fcc20abb340611f1`, deployment `dpl_HrdJJEanAPhsSCWqNdh7DhWNhaNf`. CI [40072843882](https://github.com/Semiczek/diriqo/actions/runs/40072843882): 2449 testů v 84 souborech PASS, Office 62 PASS + 1 podmíněný SKIP, build 107 stránek, lint 0 chyb / 3 existující varování. Tento dokument pouze přehodnocuje uložené výsledky; nové testy nespouští.

| Scénář | Uzavřený důkaz |
|---|---|
| C05-01 | Syntetická firma s jedinou licencí Core: přihlášené UI vytvořilo zákazníka a ruční materiál, uložilo kalkulaci, ověřilo reload a skutečně stáhlo PDF s řádky 100 Kč a 0 Kč. Sklad ani Smart Quotes nebyly podmínkou. |
| C05-02 | Owner/public PDF a portálové JSON, HTML i obě PDF neobsahují interní kontrolní náklad 123,45 Kč ani poznámku INTERNAL-C05. Samostatný portálový zákazník bez zaměstnaneckého profilu a členství: 427 HTTP/DTO asercí PASS, anonymní požadavek 401, neplatné selektory 400, cizí zákazník odmítnut. Po odebrání přístupu 17 kontrol ve stejné relaci PASS. |
| C05-03 | Přijatá verze A za 100 Kč zůstala zachována po vydání B za 250 Kč. Zakázka jednoznačně odkazuje na A a má cenu 100 Kč. Veřejné PDF A před/po B a konverzi je byte-identické; portál samostatně vrací A 100 + 0 Kč a B 250 + 0 Kč. |

Historická Core cesta není vynechána: migrace `20261022033222` vytváří zákaznický dokument explicitní projekcí a legacy readery čtou tento snímek; `get_public_offer_by_token` a položkový wrapper mají omezený výstup. Sdílený parser v `lib/core-quote-lifecycle.ts`, DAL `lib/dal/core-quote-customer-read.ts`, projekce `lib/core-quote-presentation.ts` a renderer `lib/core-quote-pdf.ts` nepředávají interní náklady ani marže. Důkaz tvoří [lifecycle checkpoint](core-quote-lifecycle-release.md): lokálně 115 + 5 kontrol úklidu + 21 legacy migračních regresí, hosted 115 + 5, a aplikační testy zákaznických odpovědí a PDF v aktuálním CI. Nový živý legacy HTTP canary běh se netvrdí; 21 legacy kontrol není 21 samostatných testů úniku dat.

Veřejné PDF A zachovalo SHA-256 `14688ceada8e9ab7c6bfa4e18defdc1ea6eea19cde0f9cc4dba0367ae558ea25`. Shoda se týká stejné veřejné cesty před změnami a po nich. Portálové PDF obsahuje také fakturační adresu, veřejné jen jméno; shoda bajtů mezi těmito dvěma cestami se netvrdí.

Navazující živá regrese [PR #41](quote-confirmed-operation-release.md) ověřila publikaci i ruční syntetické odmítnutí nabídky za 1 Kč: po otevření potvrzeného výsledku na stejné URL jsou tlačítka znovu dostupná bez úplného reloadu. [PR #42](customer-portal-context-release.md) obnovilo vlastní zákaznický kontext; nejde o akceptaci všech portálových funkcí.

Důkazní manifest je v řízených privátních artefaktech: `artifacts/quotes/c05-live-acceptance-20261024.json`, SHA-256 `07caf3fbc90df38b5bef0aa78656786a085c8f0f2a541990fc14e67b90f8be6a`. Obsahuje přesné syntetické identifikátory, DB vazby, HTTP výsledky, PDF a úklid. SQL a Auth ověřování proběhlo pouze v testovacím projektu `wfcpfraxiuhuglnuaxqj`.

Úklid obnovil UI v Diriqo Demo, deaktivoval jedno dočasné členství a odvolal oba testovací granty; jejich neměnná pole a obchodní historie zůstaly zachované. Samostatný portálový Auth účet je blokovaný, heslo změněné, relace i aktivní portálové přístupy mají počet 0. Běžný účet administrátora zůstal aktivní. Neproběhlo rozhodnutí skutečného zákazníka, platba ani odeslání e-mailu. Úplný P16, Smart Quotes, poptávky/dashboard/vytváření portálových účtů a odložený export faktury zůstávají mimo tuto akceptaci.
