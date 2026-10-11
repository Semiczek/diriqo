# Externí cloudové úložiště – pouze poznámky

Stav k 11. 10. 2026. Na přání uživatele jde pouze o rozvahu: nebyla objednána služba, vytvořen bucket, změněn tarif ani přesunuta data.

Externí objektové úložiště lze později použít pro originály DOCX/XLSX, obrázky a větší exporty. Aktivní obsah editoru, firemní oprávnění, revize, vazby na zakázky a audit mají zůstat v autorizovaném backendu Diriqo/JSPD. Dnešní normalizovaná persistence odstranila souhrnnou aplikační hranici 64 MiB bez zavedení dalšího poskytovatele.

| Varianta | Posouzení pro tento projekt |
| --- | --- |
| Privátní Supabase Storage | První kandidát k prototypu: hostitelé už používají Supabase. Storage podporuje oprávnění přes Postgres RLS. Politika musí vycházet ze skutečného členství ve firmě a vazby na Office soubor; samotné vlastnictví uživatelem nebo první segment cesty nestačí. [Oficiální řízení přístupu](https://supabase.com/docs/guides/storage/security/access-control). |
| Privátní Cloudflare R2 přes S3 API | Kandidát při velkém množství binárních souborů a stahování. Firma a oprávnění se musí ověřit v našem backendu před vystavením krátce platného podpisu pro jediný objekt a operaci. Podpis je přístupový údaj, nikoli náhrada firemních oprávnění. [Oficiální podepsané URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/). |

R2 Standard v době kontroly uvádí 0,015 USD/GB-měsíc, 4,50 USD/milion zápisových operací a 0,36 USD/milion čtecích operací; přímý odchozí přenos z R2 neúčtuje. Volná kvóta zahrnuje 10 GB-měsíc, milion Class A a deset milionů Class B operací. Přidružené služby mohou mít vlastní poplatky. Jde o orientaci z veřejného ceníku, nikoli kalkulaci našeho účtu nebo objednávku. [Ceník R2](https://developers.cloudflare.com/r2/pricing/).

## Návrh společného adaptéru

Toto je náš navržený postup, ne již implementovaná funkce:

1. Server z čerstvě ověřeného kontextu vytvoří upload intent pro `company_id + file_id + blob_id`. Klient si nesmí sám určit firmu, provider, bucket ani libovolnou URL.
2. Soubor nahraje do privátní karantény pod nezaměnitelným klíčem. Přístupový podpis bude krátce platný, jen pro jednu operaci; původní objekty nebude možné přepsat.
3. Backend ověří skutečné bajty, formát, limit, SHA-256 a bezpečnost dokumentu. Až potom transakčně připojí metadata k souboru a firmě. Objekt a databáze nemají společnou transakci, proto musí být dokončení idempotentní a osiřelé uploady řízeně uklízené.
4. Každé stažení znovu ověří aktivní členství, roli, stav Office a vazbu objektu na firmu. Klíče služeb zůstanou výhradně na serveru. Veřejný bucket pro firemní dokumenty nepoužívat.
5. Migrace bude kopírovat a kontrolovat hash po jednotlivých firmách. Stávající originály se odstraní až po samostatně schváleném a ověřeném přechodu; možnost návratu a záloha se nesmí opírat jen o živou kopii u stejného poskytovatele.

Před výběrem je třeba znát skutečný objem dat, růst verzí, počet čtení/zápisů, požadovanou dobu uchování, umístění dat a podmínky zpracování. Úložné poplatky jsou náklady infrastruktury; požadavek na nulové licence editorů zůstává zachován. Pozdější přímý upload může odstranit limit webové uploadové cesty, ale sám nezvětší bezpečný limit editovatelného dokumentu nebo výpočetní kapacitu spreadsheetu.

Pro kasu nemá Office objektový adaptér nahrazovat její lokální databázi, frontu offline operací nebo synchronizaci. Sdílení poskytovatele nesmí znamenat sdílení přístupových klíčů mezi Diriqo a JSPD ani obcházení jejich firemních ID.
