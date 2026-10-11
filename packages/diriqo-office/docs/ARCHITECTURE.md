# Diriqo Office – technická architektura

## Rozsah a zdrojové revize

Společné proprietární jádro je balíček `@diriqo/office`. Oba hostitelé dostávají identický sestavený balíček; jejich rozdílná autentizace zůstává v malých serverových adaptérech. Veškeré nové zdroje vznikají v tomto pracovním adresáři.

Auditované zdroje:

- JSPD Hub: `C:\jspdhubfinalni\jspdhubhotovy`, `9f77597d4112ce929e8664828cd4a4ea0f1b8b41`. Původní checkout má rozpracované změny. Integrace zde vychází z commitu a nepřebírá jeho necommitované změny.
- Diriqo: `C:\Users\semis\OneDrive\Dokumenty\ChatGPT\hub -_ diri 3\diriqo`, `746800d5d189e7cf9b8c61496edc88755581d7cc`. Čistý aktuálnější checkout; jeho historie obsahuje starší `C:\vyvoj\diriqo`.
- Oba: Next.js 16.2.0, React 19.2.4, Supabase Auth/Postgres/Storage, TypeScript. Skutečné produkční revize ani stav migrací nejsou tímto lokálním auditem potvrzeny.

## Hranice komponent

`src/core/types.ts` je společný transportní kontrakt. `OfficeWorkspace` spravuje soubory, složky, šablony, otevřený obsah a stav uložení. `DocumentEditor` používá Tiptap OSS; `SpreadsheetEditor` používá FortuneSheet OSS s výpočetním enginem. Editory neznají Supabase ani přístupové klíče. Hostitelský transport volá autorizované Server Actions a souborové HTTP endpointy.

`OfficeService` zajišťuje oprávnění, validaci, revize, idempotenci, návrhy změn a audit. Lokální referenční persistence slouží demonstračnímu běhu a automatickým testům. Produkční adaptér volá transakční Postgres RPC; databáze znovu ověřuje členství a povolení modulu. Kontrola na klientovi je pouze uživatelské rozhraní.

Kanonický text je strukturovaný Tiptap JSON, sešit je vlastní kanonický workbook snapshot převáděný adaptérem FortuneSheet. `schemaVersion: 1` umožňuje budoucí řízené převody. Jazyk uživatelského prostředí je oddělený od interního formátu vzorců. Vzorce používají názvy enginu, desetinnou tečku a čárku mezi argumenty. Tlačítka Office mají sedm jazyků; úplné překlady vestavěných nabídek FortuneSheet se evidují jako omezení.

## Izolace firem a zápisy

Server získá aktivní firmu a profil z existujícího hostitelského guardu, ověří `auth.getUser()` a explicitní `office_settings.enabled`. Výchozí stav je vypnuto, chybějící tabulka nebo řádek znamená odmítnutí. Nový modul se nepřidává do legacy loaderu, který v Diriqo automaticky zapíná chybějící moduly.

Otevřený pracovní prostor si připne firmu, uživatele a režim čtení z počátečního serverového kontextu. Refresh serverového stromu ani změna cookie mu automaticky nepřepne transport, firmu nebo rozpracovaný obsah. Požadavky obsahují očekávané ID firmy; server ho porovná s čerstvým autentizovaným kontextem. Cizí cookie tedy nezmění cílovou firmu rozepsaného dokumentu.

Hostitelský `OfficeClient` ověřuje kontext přes read-only `/api/office/context` s `no-store`, při návratu do panelu, změně viditelnosti, obnovení sítě a pravidelně ve viditelném panelu. Zpráva přes `localStorage` pouze vyvolává novou serverovou kontrolu; nepředává důvěryhodnou identitu ani roli. Starší asynchronní výsledek kontroly nemůže znovu povolit transport po novější změně. Při odlišném či nedostupném kontextu se operace pozastaví a draft zůstane v paměti. Uživatel může stáhnout pracovní zálohu, obnovit původní kontext nebo výslovně otevřít aktuální firmu v novém panelu. Serverové tenant guardy chrání i interval před klientským zjištěním změny.

Role hostitele se mapují na Office `owner`, `editor`, `reader`; identita vlastníka souboru je samostatné pole. Role zaměstnance není automaticky povýšena na editora. Diriqo navíc zachovává existující kontrolu capability `core.files.upload` pro nové zápisy. To je oprávnění vlastního SaaS, nikoliv licence třetí strany.

Zápis obsahu, obnova a schválení používají očekávanou revizi; mutace nesou `idempotencyKey`. Kopie vytváří nový soubor a nemá CAS pole. Současná verze, nová historická verze, audit a stav schváleného návrhu se mění v RPC atomicky. Stejný klíč s jiným obsahem je chyba. Obnova vytváří další verzi; historie se nepřepisuje. Vazba na zakázku či zákazníka se ověřuje současně podle ID záznamu a firmy.

Obnovení starší verze vyžaduje vlastní pojmenovaný DOM dialog, nikoli `window.confirm`. Před jeho otevřením se dokončí skutečně rozepsaná úprava a uloží draft. Potvrzení připne ID souboru, cílovou a aktuální revizi, generaci lokálních změn, transport a idempotentní klíč. Změna dokumentu, revize, oprávnění, transportu nebo nová rozepsaná buňka potvrzení zneplatní. Opakování po neznámém síťovém výsledku používá stejný klíč. Zpožděná odpověď nepřepíše novější lokální práci; shodný obsah nově připojeného editoru nevytváří falešné automatické uložení. Dialog má popisek, popis, počáteční fokus na zrušení a návrat fokusu; během odesílání nelze potvrzení opakovat ani zavřít Escape.

## Import, export a originály

Import pracuje v Node workeru s limitem času a paměti. Obecný formátový adaptér má limit vstupu 12 MiB, rozbaleného ZIP 48 MiB, nejvýše 2 048 položek, 100 000 vyplněných buněk a v editovatelném modelu 32 listů. Připravené HTTP integrace mají nižší vstupní limit 3 MiB uvedený níže. ZIP validátor kontroluje centrální i lokální hlavičky, CRC, duplicity, cesty, velikosti a kompresní poměr. ZIP64, šifrované archivy, makra, vložené aktivní objekty a externí sešity odmítá.

Konverzní adaptéry jsou vlastní a používají veřejný OOXML formát. Podporovaná podmnožina a upozornění jsou součástí výsledku. Žádné odkazy se na serveru nenačítají. XML DTD/ENTITY nejsou povolené. HTML prochází allowlist sanitizací; vzdálené obrázky a aktivní objekty se odstraňují. CSV importuje hodnoty jako text, export neutralizuje potenciální vzorce.

Původní bajty se uchovají odděleně od editovatelného obsahu s SHA-256. Export nikdy nenahrazuje originál. PDF má synchronní serverový export s vlastní omezenou sazbou A4, vloženým nemodifikovaným Geist pod OFL, opakovanou hlavičkou/patičkou a čísly stran. Podporuje běžný text, seznamy a jednoduché tabulky; obrázky nahrazuje alternativním textem, svisle sloučené buňky odmítá. Podrobné meze a varování jsou v [PDF_EXPORT.md](PDF_EXPORT.md). Nepoužívá cloud render ani čtení fontu z disku.

Stažení PDF i tlačítko Tisk nejprve dokončí editaci a uložení a projdou autorizovaným exportem. Tisk poté otevře nativní dialog prohlížeče. Tiskový CSS ponechává dokument v běžném toku, skrývá vedlejší hostitelské UI a uvolňuje flex/scroll omezení pouze na předcích otevřeného papíru. Tisk používá systémové fonty a sazbu prohlížeče, takže se nemusí shodovat se serverovým PDF. Nejde o obecný PDF editor ani záruku věrnosti Wordu či Excelu.

## Hostitelské HTTP meze

Oba hostitelé omezují skutečně serializovaný UTF-8 JSON požadavku na 3 800 000 bajtů, odpověď na 4 350 000 bajtů a nahraný soubor na 3 MiB. Multipart čte skutečný proud s rezervou 65 536 bajtů pro formulář; nespoléhá na deklarovaný `Content-Length`. Base64 originálu o maximální povolené velikosti se vejde do odpovědi. Odmítnutí se vrací jako `OFFICE_HOST_LIMIT`, u souborového HTTP endpointu se stavem 413. Import kontroluje normalizovaný obsah i varování před uložením; export kontroluje odpověď před zápisem exportního auditu.

Před změnami existujícího souboru host načte oprávněný obsah nebo vybranou historickou verzi/návrh a prověří očekávanou odpověď s rezervou 65 536 bajtů. Schválení vrací nainstalovaný soubor bez druhé kopie obsahu v návrhu. Tato předběžná kontrola není ve stejné SQL transakci jako zápis: zejména kopie bez CAS nebo souběžná externí změna mohou způsobit úspěšný commit následovaný chybou doručení nadlimitní odpovědi. Chyba transportu není důkaz rollbacku; rozhodující jsou RPC revize a idempotentní účtenky. Historický obsah nad hostitelským limitem může být přes tuto integraci nedostupný, přestože splňuje větší limit databáze.

## Diriqent

Office API nabízí autorizované vyhledání a načtení, oblast sešitu, metadata/vzorce, typovaný návrh nové verze, rozdíl a samostatné schválení. Obsah dokumentu je nedůvěryhodný datový vstup. AI principal nesmí schvalovat své návrhy ani provádět běžné přímé zápisy. Schválení vyžaduje čerstvou autorizaci člověka a shodnou revizi. Připravená strukturovaná data jsou podklad; automatický zápis do účetnictví, skladu ani jiných domén se tímto nepovoluje.

Kancelářské editory ani základní operace nepoužívají placené SDK, licenční server, editor cloud, telemetrii či externí AI API. Nákladová metadata AI jsou rozhraní pro budoucí integraci, nikoliv implementované účtování kreditů.

## Distribuce a zapnutí

Kód je oddělený na klientský, serverový a typový vstup. React je peer dependency hostitele; editory a formátové adaptéry jsou zabalené se zachovanými licenčními oznámeními. Verze a integrita každé nové přímé i nepřímé závislosti jsou uzamčené v lockfile a licenční evidenci. Změna závislosti bez nové kontroly neprojde CI.

Next sestavuje smíšený balíček bez externalizace celého jeho názvu. Host předává importní funkci pevnou lokální URL distribuovaného workeru; URL není součástí požadavku uživatele. Trasování serverových souborů explicitně zachovává worker, jeho ESM package.json a všechna licenční oznámení. Ověření sestavy kontroluje manifest i skutečný DOCX/XLSX import z distribuované cesty.

Před produkčním zapnutím je nutné aplikovat připravenou přídavnou migraci na správný hostitel, provést testy s jeho skutečnými účty a ověřit aktivní firemní kontext. Nasazení a změny produkčních dat nejsou součástí lokálního demonstračního testu. Hostitelská kontrola archivu ověřuje také hash evidence assetů, vlastní fontové bajty a plný OFL; samotná přítomnost souboru nestačí.

Dočasný veřejný staging má samostatnou proxy hranici zapnutou pouze `OFFICE_STAGING_ONLY=1`: pevný schválený Supabase ref, přesný HTTPS origin, časové ukončení a explicitní seznam Office/auth/company-switch/logout cest a nezbytných statických souborů. Při chybné konfiguraci nebo uplynutí lhůty odmítá přístup. Bez této proměnné zachovává proxy původní rozsah hostitelských rout. Tento režim ani jeho environment proměnné nepatří do produkce a nenahrazují autorizaci. Podmínky, cíle a hranice důkazů jsou v [PUBLIC_STAGING.md](PUBLIC_STAGING.md).

## Upřesnění hostitelského přístupu

JSPD mapuje existující roli `worker` pouze na čtenáře Office. Přístup mimo Office se tím nerozšiřuje. Výslovný `active_company_id` musí být platný a odpovídat aktivnímu členství; cizí nebo chybný výběr se odmítá. Jen při úplné absenci cookie může čerstvá Office relace použít jedinou aktivní firmu pracovníka; nula či více možností přístup neumožní. Login přijímá pro návrat pouze přesné `/office`, jinak zachovává původní chování.

Oba hostitelé umožní autentizovanému zaměstnanci přesnou cestu `/logout`. GET nic neodhlašuje; potvrzovací tlačítko spustí Server Action s `signOut({scope: 'local'})`, po úspěchu vymaže volbu aktivní firmy a vrátí přihlášení. Office odkaz otevře odhlášení v novém panelu, aby původní draft zůstal dostupný. Změna neuděluje další firemní roli.

## Normalizovaná persistence v2

Sdílený databázový adaptér rozděluje soubory, verze, návrhy, originály, účtenky a audit do privátních tabulek s povinným company_id a složenými firemními vazbami. Souhrnný limit 64 MiB se v nové RPC cestě nepoužívá. Podrobný datový model, stránkované čtení, souběžné zámky a migrační postup jsou v [NORMALIZED_PERSISTENCE.md](NORMALIZED_PERSISTENCE.md).
