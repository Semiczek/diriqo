# Produktový kontrakt Diriqa

Verze zadání 0.1 ze dne 10. 10. 2026. Zdroj: `source-specification-v0.1.txt`, převzatý beze změn od uživatele. Tento dokument shrnuje hranice pro implementaci; akceptační scénáře z originálu zůstávají platné.

## Rozhodnuté hranice

- Uživatel výslovně potvrdil modulární prodej: společný základ a samostatně placené části. Každý modul má vlastní produktový rozsah, cenu a období. Ověřená úhrada automaticky založí oprávnění dané firmy/pokladny; návrat z platební stránky ani zapnutí menu nic neudělují. Kód a schéma modulu se zavádějí řízenou migrací před jeho prodejem, platba aktivuje jeho připravené funkce. Opakovaná platební událost nesmí opakovat aktivaci nebo přepsat data modulu.
- Cílem je existující `Semiczek/diriqo`, nikoli nový fork Hubu. Přenos je selektivní a zachová stávající identitu, onboarding, zákaznická data a funkce cíle.
- Společná platforma zajišťuje Auth, tenanty, členství, role, zařízení, soubory, audit a nároky. Diriqo a DiriPOS jsou dva veřejné vstupy do stejné platformy. Samostatný POS nevyžaduje zakázkové jádro ani druhou databázi zákazníků.
- První etapa přenáší kód, schéma a syntetické vzory. Nepřenáší živá data, soubory, účty, tokeny či logy Hubu.
- Jeden tenant odpovídá jednomu právnímu subjektu. Osoba může mít více členství, ale firemní role, pracovní vztahy, sazby a data zůstávají oddělené.
- Jádro obsahuje C01–C10: zakázky, zákazníky, pracovníky, čas, kalkulace a jednoduché nabídky, kalendář, absence, zaměstnanecké zálohy, soubory a předání, základní ekonomiku. Legislativní mzdy a plné účetnictví do něj nepatří.
- Archivace zachovává historii. Schválená práce, přijatá nabídka a vydaný doklad mají historický snímek; změna dnešní sazby nebo kontaktu ho nepřepisuje.
- Jazyk, zemský režim, měna, časové pásmo a obor jsou nezávislé dimenze. Přítomnost země v konfiguraci není potvrzením podpory jejích daňových nebo POS pravidel.

## Produkty a závislosti

| Produkt | Technická závislost | První obchodně povolená kombinace |
|---|---|---|
| `diriqo_core` | Platforma | Samostatně |
| `pos` | Platforma a ověřený zemský režim | Samostatně nebo s Diriqem; kapacita po logické pokladně |
| `inventory` | Platforma a sdílený katalog | S Diriqem nebo POS, jednou za tenant |
| `invoicing` | Platforma a ověřený zemský režim | S Diriqem nebo POS, jednou za tenant |
| `smart_quotes` | Základní nabídky jádra | S aktivním jádrem |
| `fleet` | Platforma; vazba na zakázku volitelná | S aktivním jádrem |
| `ai_assistant` | Oprávněné zdroje, nástroje a kredit | S Diriqem nebo POS; kredit sám neodemkne cílový modul |

Konverzační AI není podmínkou pro autorizované OCR v jiném modulu. Sklad není podmínkou pro ruční materiál v zakázce nebo pro základní prodejní katalog POS. Ukončení modulu odděluje nové operace od historie a úzce vymezeného vypořádání původních událostí.

## Cenový katalog pouze pro návrh a testy

Veškeré nové částky jsou návrh v CZK bez DPH. Nemění `lib/plans.ts`, stávající EUR odběratele, Stripe ceny ani veřejný checkout. Nový katalog má vlastní verzi a žádné datum veřejné účinnosti. Přechod starých předplatných potřebuje samostatné pravidlo a auditovaný původ nároku.

| Tarif nebo doplněk | Měsíční návrh | Jednotka a kapacita |
|---|---:|---|
| Solo | 299 Kč | Firma, 1 plný uživatel, 0 dalších pracovníků |
| Team | 699 Kč | Firma, 3 plní uživatelé, 10 dalších pracovníků |
| Company | 1 299 Kč | Firma, 5 plných uživatelů, 30 dalších pracovníků |
| Další plný uživatel | 149 Kč | Místo v tenantovi, včetně vlastního pracovního profilu |
| Dalších deset pracovníků | 199 Kč | Balíček míst v tenantovi |
| Sklad a dodavatelé | 299 Kč | Firma, návrh 3 aktivních skladů |
| Fakturace | 199 Kč | Firma |
| Chytré nabídky | 299 Kč | Firma, spotřební AI zvlášť |
| Vozový park | 199 Kč | Firma a 5 aktivních vozidel, další 29 Kč |
| Diriqent | 199 Kč | Firma, zahrnuto 100 Kč prodejního kreditu za uhrazený měsíc |
| POS Mini | 100 Kč | Jedna pokladna; ročně výslovně 1 000 Kč |
| POS Classic | 399 Kč | Jedna pokladna |
| POS Gastro | 699 Kč | Jedna pokladna; neznamená automaticky výrobu nebo sklad |

Návrh roční ceny je 90 % dvanácti měsíčních plateb; Mini má vlastní roční cenu. Solo tedy 3 229,20 Kč. Kredit lze dokoupit po 100/300/1 000 Kč. Kapacity jsou zakoupené na období, ne počty přihlášení. Role manažera s vlastním časem se neúčtuje dvakrát. Archivovaná osoba nebo vozidlo historii zachovává; vozidlo v servisu stále čerpá aktivní místo.

## Životní cyklus a autorita

Známá schopnost + zemská dostupnost + platný nárok + aktivní identita + oprávnění k akci + rozsah objektu musí být splněny společně. Samotný název tarifu, role nebo boolean v menu nestačí. Nové neznámé klíče se odmítají. Registr schopností není důkaz, že všechny jeho položky už mají obrazovku a zápis.

`draft` neuděluje placenou práci. `active` dovoluje výslovně přidělené schopnosti. `grace` má konec a nakonfigurované operace. `readonly` a skončené předplatné dovolují pouze výslovně zachované čtení/export po dobu retence a autorizované vypořádání původní události. Zrušení obnovování nezkrátí zaplacené období. Odebrání členství nebo bezpečnostní blokace má přednost před historií i zaplacenou licencí.

Návrhy pro testy: trial 30 dní, grace 7 dní, historie/export 90 dní, POS offline oprávnění nejvýše 24 hodin. Automatický purge je vypnutý. Zahrnutý AI kredit se nepřevádí, koupený ve v0.1 automaticky neexpiruje. Reserve/settle/release musí být atomické a idempotentní; skutečný náklad poskytovatele se nezaměňuje s prodejním kreditem.

## Otevřená rozhodnutí a nehotové důkazy

- Veřejná účinnost nového ceníku, přesné prorace, převod starých EUR nároků a obchodní retenční pravidla.
- Podporované kombinace země, daňového dokladu, offline prodeje a konkrétního hardwaru. Zpočátku nic neoznačovat za ověřeno bez akceptace.
- Nasazení a přidělení platformního superadministrátora musí zachovat legitimní přístup a odstranit autoritu uživatelsky měnitelného company membership.
- Scope více pokladen: nový model musí umět odlišnou licenci pokladny, nebo smíšený nákup výslovně nepodporovat.
- Skutečná cílová ekonomika 5× až 10× nákladů se teprve měří; ceník ji nezaručuje.

Uživatel v navazující zprávě výslovně určil celé současné Diriqo jako testovací prostředí. To dovoluje připravovat ověřování na Diriqu; neznamená smazat stávající data ani měnit provozní Hub. Produkční nasazení, reálné účtování a komunikace zákazníkům zůstávají samostatně autorizované kroky.
