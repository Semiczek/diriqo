# Office: oprava produkčního originu

Interní provozní záznam, **12. 10. 2026; dokončeno pro oba hosty**. Diriqo i Hub mají opravenou konfiguraci, nový READY deployment na nezměněném Git SHA a ověřený negativní upload přes skutečné UI. Konfiguraci i produkční kroky provedl koordinátor. Autor tohoto záznamu provedl pouze kontrolu zdrojů a lokálních důkazů. Strojový souhrn koordinátora: [office-production-origin-20261012.json](../reports/office-production-origin-20261012.json).

## Nález a oprava

Závěrečná kontrola zjistila, že `OFFICE_PUBLIC_ORIGIN` chyběla v projektových i sdílených proměnných obou produkčních hostů. Načtení pracovní plochy a průchod menu tento problém neodhalily: GET tuto uploadovou kontrolu nepoužívá.

Koordinátor nastavil serverovou proměnnou typu **Config**, pouze pro **Production**, odděleně v příslušných projektech:

| Host | Proměnná | Přesná hodnota |
| --- | --- | --- |
| Diriqo | `OFFICE_PUBLIC_ORIGIN` | `https://app.diriqo.com` |
| JSPD Hub | `OFFICE_PUBLIC_ORIGIN` | `https://hub.jspd.cz` |

Hodnoty jsou bez koncového lomítka, cesty, wildcardu nebo seznamu domén. Nejde o tajný klíč ani klientskou proměnnou. Preview a staging musí zachovat svůj vlastní origin. Doklad nastavení: [Diriqo](../reports/office-production-diriqo-origin.jpg), [Hub](../reports/office-production-hub-origin.jpg).

## Proč byl potřeba nový deployment

Hostitelský `lib/office/http-limits.ts` nejprve čte výslovné `OFFICE_PUBLIC_ORIGIN`. Pokud chybí, dovoluje pouze důvěryhodný fallback `VERCEL=1` a platný hostname `VERCEL_URL` s koncovkou `.vercel.app`. Tento fallback označuje konkrétní deployment, nikoli automaticky jeho vlastní doménu. Požadavek z `app.diriqo.com` nebo `hub.jspd.cz` proto nesplní shodu s takovým fallbackem. Chybné výslovné nastavení selže bez fallbacku.

Sdílená funkce `assertOfficeRequestOrigin` vyžaduje přesnou shodu `Origin`, odpovídající veřejný `Host` a buď chybějící `Sec-Fetch-Site`, nebo hodnotu `same-origin`. Důvěryhodný origin nikdy neodvozuje z požadavku či forwarded hlaviček. Chybná konfigurace vrací `OFFICE_ORIGIN_CONFIGURATION`, nesoulad požadavku `OFFICE_FORBIDDEN`. V souborovém endpointu jsou obě chyby vrácené jako HTTP 400.

Změna projektové konfigurace sama nezmění prostředí již vytvořeného deploymentu. Je nutné nové sestavení/nasazení stejného Git SHA, potvrzení READY a ověření, že produkční alias směřuje právě na tento deployment. Není potřeba změna zdrojů, balíčku editoru, SQL ani oprávnění. Stejný origin guard chrání i Diriqo `POST /api/office/company`; oprava tedy souvisí také s přepnutím firmy z Office.

## Nasazení a aktuální důkaz

| Host / pokus | Deployment | Zdroj | Výsledek |
| --- | --- | --- | --- |
| Diriqo – nový deployment | `dpl_7kPL3HVvtZ3EnvtwZ4w1CaFdcY1D` | `bfa6514efce88df13abf506eb4c487af054b2868` | READY; koordinátor ověřil přes skutečné produkční UI odmítnutí neplatného DOCX s `OFFICE_FORMAT`. |
| Hub – první API pokus | `dpl_BazVaU5Xx7tpWtxxS3PYrqF9dTq9` | Požadován nezměněný main | Neúspěch `git_info_fail`; produkční alias nebyl přepnut. Nejde o úspěšné nasazení opravy. |
| Hub – následný UI pokus | `dpl_DF6DgMNgfQtFVvuwEuErfChSJPq1` | `12c1803ae2feccc58048e2af2b3853798df53efa` | READY, potvrzený alias `hub.jspd.cz`; koordinátor ověřil přes skutečné produkční UI odmítnutí neplatného DOCX s `OFFICE_FORMAT`. |

[Snímek výsledku Diriqo](../reports/office-production-diriqo-invalid-import.jpg) a [snímek výsledku Hub](../reports/office-production-hub-invalid-import.jpg) dokládají `OFFICE_FORMAT` na pracovní ploše. Koordinátor u obou hostů ověřil, že po neplatném uploadu nevznikl soubor. Jde o novější kontrolu než původní [deployment/UI report](../reports/office-production-deployment-ui-20261012.json), který eviduje předchozí deployment ID; aktuální nahrazující deploymenty a původ chybné konfigurace zachycuje [origin report](../reports/office-production-origin-20261012.json). Výsledné sjednocení provozního stavu patří do [OFFICE_MAIN_RELEASE.md](OFFICE_MAIN_RELEASE.md).

## Bezpečný negativní upload

Použitý soubor [office-origin-probe-invalid.docx](../reports/office-origin-probe-invalid.docx) obsahuje přesně sedm ASCII bytů `INVALID`, bez BOM a bez konce řádku; lokálně ověřený SHA-256 je `1ee01cc6701e8bfb4d21161c9e414870dbb33e9d515e4015dbb85b719d9d1efc`. Neobsahuje ZIP, makro, odkaz, firemní údaje ani aktivní obsah. Přípona `.docx` zajistí volbu DOCX parseru, který soubor odmítne již kvůli délce menší než 22 bytů.

Kontrola musí začít na čisté pracovní ploše bez otevřeného dokumentu a bez neuložené editace. UI totiž před importem volá `flush()`; u otevřeného rozpracovaného dokumentu by tento krok mohl uložit předchozí editaci. Na čisté ploše jsou počitadla změn shodná a žádné uložení není potřeba. Soubor se vybírá přes skutečné tlačítko **Nahrát soubor** a nativní výběr souboru, bez skrytého fetch/eval, přebírání cookies nebo vkládání platného dokumentu.

Pořadí `POST /api/office/files` je stejné u obou hostů:

1. Ověřit důvěryhodný origin.
2. Ověřit přihlášenou identitu, aktivní firmu, členství, právo zápisu a zapnutí Office.
3. Porovnat `X-Office-Tenant` s firmou autorizovanou serverem.
4. Omezeně načíst multipart a zkontrolovat velikost souboru.
5. Počkat na importní worker. `importDocx` volá `readSafeZip`, který u této fixture vyhodí `OFFICE_FORMAT: Invalid ZIP or file too large`.
6. Teprve po úspěšném parseru by vznikla služba a volání `service.import`. U neplatné fixture se tento bod neprovede.

Očekávaná odpověď je HTTP 400 s JSON `{"error":"OFFICE_FORMAT"}` a UI textem `OFFICE_FORMAT`. Nevznikne Office dokument, původní soubor, verze, importní audit ani idempotentní záznam. Běžné provozní HTTP či autentizační logy nejsou tímto tvrzením vyloučené. Při neopraveném originu by cesta skončila dříve s `OFFICE_FORBIDDEN` nebo `OFFICE_ORIGIN_CONFIGURATION`.

## Co tento důkaz potvrzuje a co ne

`OFFICE_FORMAT` místo originové chyby potvrzuje, že skutečný UI požadavek prošel kontrolou originu a dostal se za autentizační a firemní kontrolu. Zobrazený kód je sanitizovaný: sám nerozlišuje všechny vnitřní formátové chyby, takže není samostatným důkazem přesné větve parseru. Bezpečnost odmítnutí před persistencí vyplývá z uvedeného pořadí zdrojového kódu a z neplatného obsahu fixture.

Nejde o úspěšný produkční import, test zápisu/obnovy dokumentu, exportu, přepnutí firmy, kolize dvou uživatelů ani fyzického tisku nebo pokladny. Úspěšné zápisové scénáře a izolaci dvou firem dokládají oddělené stagingové testy. Tato konfigurace nerozšiřuje žádná oprávnění, nemění firemní ID a nevypíná ochranu proti CSRF.
