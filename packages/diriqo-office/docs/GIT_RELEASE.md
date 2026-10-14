# Diriqo Office – aktuální Git release a online staging

> **Historický report z 11. 10. 2026.** Aktuální `main`, produkční nasazení, důkazy a omezení jsou v [OFFICE_MAIN_RELEASE.md](OFFICE_MAIN_RELEASE.md). Office je nyní základní funkcí všech existujících i nových firem se zachováním explicitního administrátorského vypnutí. Níže uvedené stagingové adresy, stav PR a výchozí vypnutí popisují tehdejší stav.

Stav 2026-10-11T20:33:38.888Z: Office je na Gitu a oba přesné commity jsou nasazené do existujících **oddělených stagingů**. Produkce, její nastavení ani firemní přepínače se tímto releasem neměnily. Zveřejnění zdrojů v již veřejném repozitáři `Semiczek/diriqo` uživatel výslovně schválil.

| Host | Přesný commit | PR | Online Office |
| --- | --- | --- | --- |
| JSPD Hub | `9000ea60913aa2d37834d5978904c25b99acd8e9` | [PR #15](https://github.com/Semiczek/jspdhubhotovy/pull/15) | [Otevřít Hub staging](https://office-staging-a2u77maa7-jspdholding-7510s-projects.vercel.app/office) |
| Diriqo | `c6982ac9f31abcd6c07203be950e21274ae89a49` | [PR #14](https://github.com/Semiczek/diriqo/pull/14) | [Otevřít Diriqo staging](https://office-staging-diriqo-gbcpaca73-jspdholding-7510s-projects.vercel.app/office) |

Oba deploymenty jsou **READY**, mají `target: staging` a Git metadata odpovídající commitům v tabulce. Hub deployment je `dpl_2j8ZYEFP3jjx8hJJtAjyYJMhqUTh`, Diriqo `dpl_AScQDzYmkZuZZ4gLfMzBAVYXsERM`. Automatické Git deploymenty větve `codex/office-menu-release` jsou blokované přes `vercel.json`; ruční nasazení použilo výhradně existující izolované stagingové projekty a přesný Git commit.

## Důkazy podle ověřené verze

| Kontrola | Výsledek a rozsah |
| --- | --- |
| Aktuální celý Hub webový testovací CI job | **1803 PASS, 7 přeskočeno, 0 selhání** z 1810 testů; [job 114566389128](https://github.com/Semiczek/jspdhubhotovy/actions/runs/38171986427/job/114566389128) na `9000ea60913aa2d37834d5978904c25b99acd8e9` |
| Aktuální celá Diriqo CI sada | **1017 Vitest PASS + 8/8 přenositelných Office testů**; [job 114566563228](https://github.com/Semiczek/diriqo/actions/runs/38172068414/job/114566563228) na `c6982ac9f31abcd6c07203be950e21274ae89a49` |
| Aktuální změna navigace – každý host | **8/8 PASS**, skutečně vykreslené odkazy a firemní/autorizační kontrakty |
| Aktuální Hub navigační a provozní regrese | **21/21 PASS**; zahrnuje cílených 8 testů, počty se nesčítají |
| Čerstvé HTTP testy aktuálního Hub deploymentu | **50/50 PASS**, stagingové přihlášení a autorizované operace |
| Čerstvé HTTP testy aktuálního Diriqo deploymentu | **48/48 PASS**, stagingové přihlášení a autorizované operace |
| Nezměněné sdílené jádro | **186 PASS**; **38 runtime souborů** shodných s archivem obou hostů |
| Historické integrační testy Office hostů | **102 PASS**, před poslední změnou navigace |
| Historická celá lokální sada JSPD Hub | **1801 PASS, 7 přeskočeno**; čistý checkout `09a4224a1dc93ae3bec56ae0bf36e64b69e3823f` před během i po něm |
| Historická celá lokální sada Diriqo | **1017 PASS** na `54cee6a7f876105fd9d25b5a8ee78f0ed8ba49b0` |
| Licence sdíleného jádra | **129 přesných balíčků a jeden OFL font PASS**; kontrola zakázané/neznámé přepočtené evidence a SBOM |

CI workflow na obou přesných aktuálních commitech jsou zelené, včetně licenčních a sdílených kontrol. Přesné commity a shrnutí dokončených celých testovacích CI jobů dokládá `reports/git-current-ci-tests.json`; jeho otisk a identity běhů jsou v `reports/git-office-release.json`. Aktuální celé CI sady jsou samostatné důkazy, historické celé lokální sady se jim nepřipisují. Přenositelných 8 Office testů Diriqo a lokálních 8 cílených testů jsou opakované běhy stejné sady, nikoli další různé testy. Aktuální HTTP protokoly `reports/public-staging-hub-http.json` a `reports/public-staging-diriqo-http.json` jsou vázané na nová deployment ID. Starší `reports/validation.json` zachovává původní důkazy.

## Firma, menu a kasa

Office je výchozně vypnuté samostatně pro `company_id`. V Hubu má existující oprávněný `super_admin` v menu **Nastavení Office**. V Diriqo má oprávněný platformový administrátor vstup přes **Nastavení → Firma → Diriqo Office**. Oba vedou na `/office/settings`; po zapnutí pro ověřenou firmu se v menu objeví **Diriqo Office**. Zobrazení odkazu nenahrazuje serverovou autorizaci.

Každá operace Office ověřuje aktuální identitu, firemní členství, oprávnění a stav modulu. Privátní data a vazby obsahují firemní ID. Změna firmy v jiném panelu nesmí přesměrovat rozpracovaný dokument k jiné firmě. Testy odmítají cizí firmu a neautorizované role; klientské `companyId` samo o sobě není oprávnění.

Poslední kontrola odhalila, že globální styly FortuneSheet a pravidlo `@page` mohou po klientském přechodu přetrvat a ovlivnit například tisk protokolu v jiném modulu. Vstupy do Office, návraty a Diriqo cookie odkazy uvnitř Office proto nově načítají celý dokument. Nemění to editorový archiv ani pokladní výpočty. [Kontrola izolace CSS](OFFICE_CSS_ISOLATION_REVIEW.md) dokládá nalezené cesty, root layout i automatické/klávesové akce. Přihlášený přechod a následný tisk v Chrome zatím ověřený není.

Runtime editoru a Office SQL se proti předchozímu ověřenému stagingu nezměnily. Starší testy dvou firem, databázových zámků, obnovy verzí, kapacity nad 64 MiB a PDF proto dokládají jen stejné jádro a stejné SQL. Nejsou důkazem čerstvě ověřeného celého hostitele, nativního tiskového dialogu ani hardware.

Produkční pokladna ani data se při ověřování nepoužívaly. Kasa zůstává pod původními rolemi a firemními pravidly. **Fyzická kasa, terminál, zásuvka, tiskárna a párování zařízení nejsou ověřené. Přihlášené menu a přepínání firem mezi panely v Chrome také nejsou ověřené.** Chrome nově otevřel přihlašovací stránky obou deploymentů v tabulce; samotná login stránka není důkazem přihlášeného UI.

## Nasazení a zbývající kroky

Jediné upravitelné jádro je v Diriqo `packages/diriqo-office`, zdrojový otisk `d844f69bb86553869de0b0ede504c11910c63fb72e2cc7105dd4ecaf7d274769`. Oba hosty konzumují archiv SHA-256 `fc8b602dc57267f504bbd4d02788b8dc349f4cb03d282fe62008e9d0538e5c5a`. Kanonický zdroj, lockfile a licence jsou pod Gitem; `.gitattributes` chrání přesné bajty evidence.

Případné pozdější schválené nasazení musí respektovat hostitelský `docs/OFFICE_RELEASE.md`: **core a správný host adaptér → normalizace → oprava receipt COMMIT**, bez přepisování aplikovaných migrací. Modul se zapíná pouze pro explicitně ověřenou firmu. Toto předání nepovoluje migrace ani zapnutí v produkci.

CI je dokončené. Zbývá přihlášená vizuální kontrola menu, panelů a navigace/tisku, případně samostatná provozní kontrola fyzického zařízení. Zděděné bezpečnostní nálezy jiných hostitelských modulů nejsou tímto odstraněné. Automatické testy nepotvrzují neomezenou produkční připravenost.

Databázové stagingové větve mají schválený provoz do **12. 10. 2026 19:00 Praha**, úklid je naplánovaný na **18:55**; tím se netvrdí jeho provedení. Přihlášení je v místním neveřejném `.staging/PUBLIC_ACCESS.md`, nikdy v Gitu. Externí cloudové úložiště zůstalo pouze popsané v `docs/EXTERNAL_STORAGE_NOTES.md`, bez objednání nové služby.
