import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/config'

export type LegalDocumentType = 'terms' | 'privacy' | 'cookies' | 'dpa' | 'security'

export type LegalDocumentSection = {
  id: string
  title: string
  body: string[]
  bullets?: string[]
}

export type LegalDocumentDefinition = {
  type: LegalDocumentType
  version: string
  locale: Locale
  title: string
  shortTitle: string
  summary: string
  publishedAt: string
  requiresAcceptance: boolean
  sections: LegalDocumentSection[]
}

export const CURRENT_LEGAL_VERSION = '2026.05.17'
export const REQUIRED_LEGAL_ACCEPTANCE_TYPES: LegalDocumentType[] = ['terms', 'privacy']

const publishedAt = '2026-05-17T00:00:00.000Z'

const csDocuments: LegalDocumentDefinition[] = [
  {
    type: 'terms',
    version: CURRENT_LEGAL_VERSION,
    locale: 'cs',
    title: 'Podmínky používání aplikace Diriqo',
    shortTitle: 'Terms',
    summary:
      'Pravidla pro používání SaaS platformy Diriqo, firemní účty, uživatele, zakázky, směny, fotografie, komunikaci, portály, mobilní aplikace a budoucí placené funkce.',
    publishedAt,
    requiresAcceptance: true,
    sections: [
      {
        id: 'scope',
        title: '1. Účel služby a firemní účet',
        body: [
          'Diriqo je profesionální SaaS platforma pro řízení provozu firem. Umožňuje spravovat zakázky, zákazníky, zaměstnance a spolupracovníky, směny, docházku, fotografie, nabídky, fakturaci, komunikaci, zákaznický portál, mobilní aplikace a související provozní agendu.',
          'Účet v aplikaci je zpravidla veden jako firemní nebo organizační účet. Osoba, která firmu založí nebo spravuje, potvrzuje, že je oprávněna organizaci zastupovat nebo že má oprávnění službu pro organizaci používat.',
        ],
        bullets: [
          'organizace odpovídá za správnost a zákonnost dat vložených do Diriqo',
          'organizace odpovídá za nastavení rolí, přístupů a oprávnění svých uživatelů',
          'uživatelé musí chránit své přihlašovací údaje a nepředávat je dalším osobám',
        ],
      },
      {
        id: 'roles',
        title: '2. Uživatelé, zaměstnanci, role a odpovědnost organizace',
        body: [
          'Diriqo podporuje role jako vlastník firmy, administrátor, manažer, pracovník a další role, které mohou být přidány v budoucnu. Přístup k datům a funkcím je odvozen od nastavení organizace a technických oprávnění v aplikaci.',
          'Organizace odpovídá za to, že do aplikace pozve pouze oprávněné osoby, že jim přidělí přiměřená oprávnění a že přístup odebere, pokud pro něj zanikne důvod.',
        ],
      },
      {
        id: 'operations',
        title: '3. Zakázky, směny, docházka a provozní data',
        body: [
          'Data o zakázkách, směnách, docházce, pracovní době, nákladech, úkolech a zákaznících slouží jako provozní evidence organizace. Diriqo nenahrazuje účetní, mzdové, daňové, pracovněprávní ani bezpečnostní poradenství.',
          'Uživatel odpovídá za správnost zadaných údajů, za včasnou kontrolu exportů a za to, že výstupy z aplikace použije v souladu s právními povinnostmi své organizace.',
        ],
      },
      {
        id: 'photos',
        title: '4. Fotografie, soubory a obsah',
        body: [
          'Aplikace může umožňovat nahrávání fotografií, příloh a dalších souborů k zakázkám nebo komunikaci. Organizace odpovídá za to, že má právní důvod k pořízení, uložení a sdílení těchto materiálů.',
          'Do Diriqo je zakázáno ukládat nezákonný obsah, obsah porušující práva třetích osob, škodlivý kód, nadbytečná zvláštní data nebo materiály, které nesouvisí s oprávněným provozem organizace.',
        ],
      },
      {
        id: 'offline-sync',
        title: '5. Mobilní aplikace, offline režim a synchronizace',
        body: [
          'Některé funkce mohou být dostupné v mobilní aplikaci nebo v offline režimu. Offline synchronizace může záviset na zařízení, připojení, stavu lokální databáze, konfliktu změn, nastavení oprávnění a dostupnosti infrastruktury.',
          'Diriqo vynakládá přiměřené úsilí, aby konflikty synchronizace řešilo srozumitelně a bezpečně. Organizace však bere na vědomí, že při souběžných úpravách, výpadku připojení nebo pozdějším nahrání dat mohou vzniknout konflikty, zpoždění nebo nutnost ruční kontroly.',
        ],
      },
      {
        id: 'smart-features',
        title: '6. Nabídky, fakturace, komunikace a chytré funkce',
        body: [
          'Diriqo může obsahovat nástroje pro tvorbu nabídek, kalkulací, faktur, e-mailové komunikace, zákaznického portálu, exportů, API, integrací, webhooků, analytiky a budoucích AI funkcí.',
          'Výstupy z těchto funkcí mají podpůrný charakter. Organizace musí před odesláním nebo použitím zkontrolovat ceny, sazby, splatnosti, daňové údaje, textace, přílohy, adresáty a zákonnost komunikace.',
        ],
      },
      {
        id: 'availability',
        title: '7. Dostupnost, údržba a infrastruktura',
        body: [
          'Služba nemusí být dostupná nepřetržitě. Mohou nastat plánované odstávky, aktualizace, bezpečnostní zásahy, výpadky připojení, výpadky poskytovatelů infrastruktury nebo jiné technické události.',
          'Diriqo využívá nebo může využívat třetí strany jako hosting, databázové služby, úložiště, e-mailové služby, platební služby, analytiku, push notifikace a další infrastrukturu. Výpadek služeb jako Supabase, Vercel, Stripe nebo obdobných poskytovatelů může ovlivnit dostupnost Diriqo.',
        ],
        bullets: [
          'žádný informační systém není zcela bezchybný nebo nepřetržitě dostupný',
          'provozovatel vynakládá přiměřené odborné úsilí na bezpečnost a stabilitu',
          'organizace má mít vlastní procesy pro kritické provozní situace a kontrolu důležitých dat',
        ],
      },
      {
        id: 'auditability',
        title: '8. Auditní logy, souhlasy a dohledatelnost',
        body: [
          'Diriqo může uchovávat auditní informace o přihlášení, změnách dat, udělení souhlasů, exportech, odeslané komunikaci a dalších bezpečnostně nebo provozně významných událostech.',
          'Auditní záznamy slouží k ochraně organizace, uživatelů, zákazníků i provozovatele, k řešení incidentů, sporů, bezpečnosti a compliance.',
        ],
      },
      {
        id: 'security-abuse',
        title: '9. Bezpečnost, abuse prevention a zakázané jednání',
        body: [
          'Uživatel nesmí obcházet bezpečnostní opatření, pokoušet se získat neoprávněný přístup, narušovat provoz, zneužívat API, provádět scraping, reverse engineering, automatizované vytěžování dat, rozesílání spamu nebo ukládat škodlivý obsah.',
          'Provozovatel může přístup omezit, pozastavit nebo ukončit, pokud existuje důvodné podezření na zneužití, bezpečnostní incident, porušení podmínek, neplacení budoucích placených služeb nebo právní riziko pro Diriqo, zákazníky nebo třetí osoby.',
        ],
      },
      {
        id: 'billing-third-parties',
        title: '10. Předplatné, třetí strany a budoucí placené funkce',
        body: [
          'Diriqo je připraveno pro budoucí předplatné, platební brány, zákaznický billing portál, enterprise plány, doplňkové moduly, API access a integrace. Konkrétní ceny, limity a platební podmínky mohou být uvedeny samostatně.',
          'Platební údaje může zpracovávat specializovaný poskytovatel plateb. Diriqo nenese odpovědnost za výpadky, odmítnutí platby, změny pravidel nebo technické incidenty třetích stran mimo rozsah přiměřené kontroly provozovatele.',
        ],
      },
      {
        id: 'liability',
        title: '11. Omezení odpovědnosti',
        body: [
          'Diriqo je poskytováno jako provozní SaaS nástroj. Provozovatel odpovídá pouze v rozsahu stanoveném právními předpisy a těmito podmínkami. Nepřebírá odpovědnost za podnikatelská rozhodnutí organizace, obsah vložený uživateli, nesprávná oprávnění, chybné vstupy, konflikty offline synchronizace ani škody způsobené třetími stranami.',
          'Pokud je podle práva přípustné omezení odpovědnosti, je celková odpovědnost provozovatele omezena na částku zaplacenou za službu za posledních 12 měsíců, případně na přiměřený limit uvedený v individuální smlouvě. Toto omezení se nepoužije tam, kde by bylo podle práva nepřípustné.',
        ],
      },
      {
        id: 'termination',
        title: '12. Ukončení účtu, export a změny služby',
        body: [
          'Organizace může požádat o ukončení účtu nebo export dat podle dostupných funkcí a technických možností služby. Po ukončení může být přístup omezen a data mohou být uchována pouze po nezbytnou dobu pro právní, bezpečnostní, účetní nebo auditní účely.',
          'Provozovatel může službu, její části nebo konkrétní moduly měnit, pozastavit nebo ukončit, zejména z technických, bezpečnostních, právních, obchodních nebo provozních důvodů. Změny budou prováděny přiměřeně a s ohledem na legitimní očekávání zákazníků.',
        ],
      },
    ],
  },
  {
    type: 'privacy',
    version: CURRENT_LEGAL_VERSION,
    locale: 'cs',
    title: 'Ochrana osobních údajů',
    shortTitle: 'Privacy',
    summary:
      'Vysvětlení, kdy Diriqo vystupuje jako správce a kdy jako zpracovatel, jaké kategorie dat se zpracovávají a jaká práva mají subjekty údajů.',
    publishedAt,
    requiresAcceptance: true,
    sections: [
      {
        id: 'roles',
        title: '1. Role Diriqo při zpracování dat',
        body: [
          'Diriqo může při různých typech zpracování vystupovat v odlišných rolích. U účtu, podpory, bezpečnosti, technických logů a budoucího billingu vystupuje zpravidla jako správce. U provozních dat vložených organizací vystupuje zpravidla jako zpracovatel podle pokynů organizace.',
        ],
        bullets: [
          'správce: účet, autentizace, billing, podpora, bezpečnost, technické logy, abuse prevention',
          'zpracovatel: zaměstnanci, zákazníci, zakázky, fotografie, docházka, komunikace, portálová data a provozní evidence zákazníka',
        ],
      },
      {
        id: 'categories',
        title: '2. Kategorie osobních údajů',
        body: [
          'Aplikace může zpracovávat identifikační a kontaktní údaje, pracovní role, docházku, směny, úkoly, fotografie, komunikaci, fakturační údaje, technické logy, auditní záznamy, údaje o zařízení, preferencích, oprávněních a budoucí údaje související s platbami nebo integracemi.',
        ],
      },
      {
        id: 'purposes',
        title: '3. Účely a právní základy',
        body: [
          'Diriqo zpracovává údaje pro poskytování služby, zabezpečení, autentizaci, správu účtu, plnění smlouvy, podporu, prevenci zneužití, plnění právních povinností, obhajobu právních nároků a budoucí billing. Organizace odpovídá za právní základ u dat, která do aplikace vkládá jako správce.',
        ],
      },
      {
        id: 'retention',
        title: '4. Uchování, export a výmaz',
        body: [
          'Data jsou uchovávána po dobu trvání účtu a poté po nezbytnou dobu podle smluvních, právních, bezpečnostních, účetních a auditních potřeb. Organizace může exportovat nebo mazat data podle dostupných funkcí a oprávnění.',
        ],
      },
      {
        id: 'rights',
        title: '5. Práva subjektů údajů',
        body: [
          'Subjekty údajů mohou mít právo na přístup, opravu, výmaz, omezení zpracování, přenositelnost, námitku nebo stížnost u dozorového úřadu. Pokud jde o data spravovaná organizací, Diriqo zpravidla předá žádost organizaci nebo jí poskytne přiměřenou součinnost.',
        ],
      },
      {
        id: 'subprocessors',
        title: '6. Subprocesory a mezinárodní prvky',
        body: [
          'Diriqo může využívat subprocesory pro hosting, databázi, úložiště, e-mail, platby, analytiku, monitoring, podporu, mobilní služby, push notifikace nebo AI a integrační funkce. Provozovatel bude udržovat přiměřený přehled subprocesorů a při změnách poskytne zákazníkům vhodnou informaci.',
        ],
      },
      {
        id: 'security',
        title: '7. Bezpečnost',
        body: [
          'Diriqo používá přiměřená technická a organizační opatření, zejména autentizaci, autorizaci, oddělení tenantů, server-side guardy, soukromé úložiště, auditní záznamy a omezení přístupů. Žádné opatření však nemůže zaručit absolutní bezpečnost.',
        ],
      },
    ],
  },
  {
    type: 'cookies',
    version: CURRENT_LEGAL_VERSION,
    locale: 'cs',
    title: 'Cookies a podobné technologie',
    shortTitle: 'Cookies',
    summary:
      'Přehled technologií používaných pro přihlášení, bezpečnost, preference, měření a budoucí produktovou analytiku.',
    publishedAt,
    requiresAcceptance: false,
    sections: [
      {
        id: 'essential',
        title: '1. Nezbytné cookies',
        body: [
          'Diriqo používá nezbytné cookies a lokální úložiště pro přihlášení, bezpečnost, relaci, jazyk, aktivní firmu a základní fungování aplikace. Bez nich nelze službu spolehlivě poskytovat.',
        ],
      },
      {
        id: 'preferences',
        title: '2. Preferenční a provozní data',
        body: [
          'Aplikace může ukládat volby uživatele, například jazyk, stav onboarding průvodce, lokální pracovní stav, dočasné hodnoty formulářů nebo informace potřebné pro offline režim.',
        ],
      },
      {
        id: 'analytics',
        title: '3. Analytika a budoucí rozšíření',
        body: [
          'V budoucnu může Diriqo používat analytiku, monitoring výkonu, crash reporting, produktové měření nebo marketingové cookies. Pokud to bude vyžadovat právo, bude před jejich použitím získán odpovídající souhlas.',
        ],
      },
    ],
  },
  {
    type: 'dpa',
    version: CURRENT_LEGAL_VERSION,
    locale: 'cs',
    title: 'GDPR a Data Processing Addendum',
    shortTitle: 'GDPR',
    summary:
      'Základní zpracovatelský rámec pro situace, kdy organizace používá Diriqo ke zpracování dat zaměstnanců, zákazníků, zakázek, fotografií, docházky a komunikace.',
    publishedAt,
    requiresAcceptance: false,
    sections: [
      {
        id: 'controller-processor',
        title: '1. Rozlišení správce a zpracovatele',
        body: [
          'Organizace je správcem provozních dat, která do Diriqo vkládá a u nichž určuje účely a prostředky zpracování. Diriqo je u těchto dat zpracovatelem a zpracovává je podle pokynů organizace, smlouvy a dostupných funkcí služby.',
          'Diriqo je samostatným správcem pro vlastní účetní, bezpečnostní, podpůrné, billingové a provozní zpracování.',
        ],
      },
      {
        id: 'processing-scope',
        title: '2. Předmět, povaha a účel zpracování',
        body: [
          'Předmětem zpracování je poskytování cloudové aplikace pro řízení provozu firem. Zpracování zahrnuje ukládání, zobrazení, úpravy, přenos, synchronizaci, export, audit, zálohování a zabezpečení dat podle nastavení organizace.',
        ],
      },
      {
        id: 'data-subjects',
        title: '3. Kategorie subjektů a dat',
        body: [
          'Subjekty údajů mohou zahrnovat administrátory, zaměstnance, pracovníky, dodavatele, zákazníky, kontaktní osoby, portálové uživatele a osoby zachycené v provozních fotografiích nebo komunikaci.',
        ],
      },
      {
        id: 'instructions',
        title: '4. Pokyny, subprocesoři a součinnost',
        body: [
          'Pokyny organizace jsou dány smlouvou, nastavením aplikace, oprávněními a používáním funkcí. Diriqo může zapojit subprocesory, pokud poskytují přiměřené záruky. Diriqo poskytne přiměřenou součinnost při žádostech subjektů údajů, incidentech, auditech a ukončení služby.',
        ],
      },
      {
        id: 'return-delete',
        title: '5. Vrácení a výmaz dat',
        body: [
          'Po ukončení služby budou data podle dostupných funkcí exportována, vymazána nebo anonymizována, pokud jejich další uchování nevyžaduje právo, bezpečnost, audit, obhajoba nároků nebo technické zálohovací cykly.',
        ],
      },
    ],
  },
  {
    type: 'security',
    version: CURRENT_LEGAL_VERSION,
    locale: 'cs',
    title: 'Informace o bezpečnosti',
    shortTitle: 'Security',
    summary:
      'Přehled bezpečnostního modelu Diriqo, tenant isolation, server-side guardů, auditovatelnosti a odpovědností zákazníka.',
    publishedAt,
    requiresAcceptance: false,
    sections: [
      {
        id: 'model',
        title: '1. Bezpečnostní model',
        body: [
          'Diriqo staví bezpečnost na autentizaci uživatele, server-side autorizaci, tenant izolaci, RLS politikách, soukromém úložišti, minimalizaci klientských oprávnění a auditních záznamech.',
        ],
      },
      {
        id: 'customer-responsibility',
        title: '2. Odpovědnosti zákazníka',
        body: [
          'Organizace odpovídá za správu uživatelů, bezpečnost hesel, nastavení rolí, kontrolu exportů, zákonnost vloženého obsahu, interní procesy a odebrání přístupu osobám, které jej už nepotřebují.',
        ],
      },
      {
        id: 'incidents',
        title: '3. Incidenty, logy a dostupnost',
        body: [
          'Diriqo může monitorovat bezpečnostní události a uchovávat technické logy potřebné pro provoz, prevenci zneužití a řešení incidentů. V případě významného incidentu bude postupováno přiměřeně povaze rizika a právním povinnostem.',
        ],
      },
      {
        id: 'future',
        title: '4. Připravenost na enterprise a globální růst',
        body: [
          'Architektura je připravena pro Stripe billing, mobilní aplikace, push notifikace, GPS funkce, analytiku, API, integrace, webhooky, AI funkce, audit logy a enterprise plány. Každá nová schopnost musí zachovat server-side guardy, tenant izolaci a přiměřenou auditovatelnost.',
        ],
      },
    ],
  },
]

function cloneForLocale(locale: Locale): LegalDocumentDefinition[] {
  return csDocuments.map((document) => ({
    ...document,
    locale,
  }))
}

export function getLegalDocuments(locale: Locale = DEFAULT_LOCALE) {
  if (locale === 'cs') return csDocuments
  return cloneForLocale(locale)
}

export function getLegalDocument(type: LegalDocumentType, locale: Locale = DEFAULT_LOCALE) {
  return getLegalDocuments(locale).find((document) => document.type === type) ?? csDocuments[0]
}

export function documentToPlainText(document: LegalDocumentDefinition) {
  const lines = [
    document.title,
    `Verze: ${document.version}`,
    `Publikováno: ${new Date(document.publishedAt).toISOString().slice(0, 10)}`,
    '',
    document.summary,
    '',
  ]

  for (const section of document.sections) {
    lines.push(section.title)
    lines.push(...section.body)

    if (section.bullets?.length) {
      lines.push(...section.bullets.map((item) => `- ${item}`))
    }

    lines.push('')
  }

  return lines.join('\n')
}
