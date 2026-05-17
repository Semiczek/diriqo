import type { Locale } from '@/lib/i18n/config'

export type TutorialStep = {
  id: string
  target: string
  title: string
  content: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
  action?: 'click' | 'read' | 'navigate'
  href?: string
}

export type HelpPageKey =
  | 'dashboard'
  | 'jobs'
  | 'customers'
  | 'workers'
  | 'calendar'
  | 'absences'
  | 'advance_requests'
  | 'finance'
  | 'invoices'
  | 'costs'
  | 'calculations'
  | 'quotes'
  | 'leads'
  | 'offers'
  | 'settings'
  | 'first_steps'

export type TutorialDefinition = {
  id: string
  pageKey: HelpPageKey
  title: string
  shortDescription: string
  steps: TutorialStep[]
}

export type PageHelpDefinition = {
  pageKey: HelpPageKey
  label: string
  shortTitle: string
  shortDescription: string
  shortSteps: string[]
  tutorial: TutorialDefinition
}

export type HelpUiText = {
  help: string
  openHelp: string
  openRunningHelp: string
  runningGuide: string
  step: string
  of: string
  helpTitle: string
  closeHelp: string
  shortGuide: string
  startGuide: string
  openFullHelp: string
  close: string
  continue: string
  done: string
  goToForm: string
  goToNextPage: string
  goToPage: string
  endTutorial: string
  back: string
  skipStep: string
  missingTarget: string
}

const introHelpStep: TutorialStep = {
  id: 'floating-help',
  target: '[data-tour="floating-help-button"]',
  title: 'Tady najdeš nápovědu',
  content:
    'Když si nebudeš jistý, klikni sem. Nápověda se vždy přizpůsobí stránce, na které právě jsi.',
  placement: 'left',
  action: 'read',
}

const currentPageHelpStep: TutorialStep = {
  id: 'current-page-help',
  target: '[data-tour="floating-help-panel"]',
  title: 'Nápověda pro aktuální stránku',
  content:
    'V panelu najdeš krátký návod, krokové navedení a odkaz na plnou nápovědu. Můžeš ho kdykoliv zavřít.',
  placement: 'left',
  action: 'read',
}

export const onboardingIntroTutorials: Record<'quick' | 'detailed', TutorialDefinition> = {
  quick: {
    id: 'intro-help-quick',
    pageKey: 'first_steps',
    title: 'Rychlé seznámení',
    shortDescription: 'Ukáže, kde najdeš kontextovou nápovědu a jak s ní pracovat.',
    steps: [
      introHelpStep,
      currentPageHelpStep,
      {
        id: 'dashboard-overview',
        target: '[data-tour="nav-dashboard"]',
        title: 'Přehled',
        content: 'Přehled je rychlý souhrn dnešní práce, upozornění a základní provozní ekonomiky.',
        placement: 'right',
        action: 'read',
      },
      {
        id: 'jobs-overview',
        target: '[data-tour="nav-jobs"]',
        title: 'Zakázky',
        content: 'Zakázky propojují zákazníka, termín, pracovníky, kalendář a dokončení práce.',
        placement: 'right',
        action: 'read',
      },
    ],
  },
  detailed: {
    id: 'intro-help-detailed',
    pageKey: 'first_steps',
    title: 'Podrobný tutorial',
    shortDescription: 'Začne nápovědou a potom ukáže hlavní části aplikace.',
    steps: [
      introHelpStep,
      currentPageHelpStep,
      {
        id: 'settings',
        target: '[data-tour="nav-companySettings"]',
        title: 'Nastavení firmy',
        content: 'Tady upravíš údaje firmy, jazyk, menu a členy týmu.',
        placement: 'right',
        action: 'read',
      },
      {
        id: 'workers',
        target: '[data-tour="nav-workers"]',
        title: 'Pracovníci',
        content: 'Pracovníci se přiřazují na zakázky a pomáhají plánovat kapacitu.',
        placement: 'right',
        action: 'read',
      },
      {
        id: 'calendar',
        target: '[data-tour="nav-calendar"]',
        title: 'Kalendář',
        content: 'Kalendář ukazuje zakázky a události podle dnů, týdnů nebo měsíců.',
        placement: 'right',
        action: 'read',
      },
      {
        id: 'absences',
        target: '[data-tour="nav-absences"]',
        title: 'Nepřítomnosti',
        content: 'Tady schvaluješ dovolené, nemoc a další nepřítomnosti pracovníků.',
        placement: 'right',
        action: 'read',
      },
      {
        id: 'jobs',
        target: '[data-tour="nav-jobs"]',
        title: 'Zakázky',
        content: 'Zakázka je hlavní pracovní jednotka Diriqa. Odtud se plánuje, dokončuje a fakturuje.',
        placement: 'right',
        action: 'read',
      },
      {
        id: 'costs',
        target: '[data-tour="nav-costs"]',
        title: 'Náklady',
        content: 'Náklady dávají provozní pohled na fixní, zakázkové a jednorázové výdaje.',
        placement: 'right',
        action: 'read',
      },
    ],
  },
}

export const pageHelpDefinitions: Record<HelpPageKey, PageHelpDefinition> = {
  first_steps: {
    pageKey: 'first_steps',
    label: 'První kroky',
    shortTitle: 'Začni bez zdržování',
    shortDescription: 'Vyber režim, projdi si nápovědu a vrať se k práci, kdykoliv potřebuješ.',
    shortSteps: [
      'Vyber, jestli chceš začít hned, rychle se seznámit, nebo projít detailní tutorial.',
      'Když si nebudeš jistý, klikni na nápovědu vpravo dole.',
      'Tutorial můžeš kdykoliv zavřít nebo spustit znovu.',
    ],
    tutorial: onboardingIntroTutorials.quick,
  },
  dashboard: {
    pageKey: 'dashboard',
    label: 'Přehled',
    shortTitle: 'Jak číst přehled',
    shortDescription: 'Přehled ukazuje dnešní práci, věci k řešení a orientační provozní výsledky firmy.',
    shortSteps: [
      'Nahoře vidíš vybraný měsíc, rychlé akce a poznámky.',
      'KPI karty ukazují dnešní zakázky, aktivní směny, dokončené zakázky, čekající fakturaci a orientační výsledek.',
      'Blok „Co potřebuje pozornost“ tě navede na věci, které je dobré zkontrolovat.',
      'Dnešní práce a souhrny týdne ukazují, co je naplánované, hotové a co čeká na fakturaci.',
      'Ekonomika je provozní pohled pro rozhodování, ne účetnictví.',
    ],
    tutorial: {
      id: 'dashboard-overview',
      pageKey: 'dashboard',
      title: 'Přehled krok za krokem',
      shortDescription: 'Vysvětlí hlavní karty, upozornění a provozní ekonomiku.',
      steps: [
        {
          id: 'dashboard-hero',
          target: '[data-tour="dashboard-hero"]',
          title: 'Horní přehled',
          content: 'Tady vidíš vybraný den a měsíc, hodnotu objednané práce a rychlé odkazy na novou zakázku, zakázky a zákazníky.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-quick-notes',
          target: '[data-tour="dashboard-quick-notes"]',
          title: 'Rychlé poznámky',
          content: 'Sem si můžeš uložit krátké interní poznámky pro tým. Hodí se na věci, které nechceš hned řešit jako zakázku.',
          placement: 'left',
        },
        {
          id: 'dashboard-kpi-section',
          target: '[data-tour="dashboard-kpi-section"]',
          title: 'Hlavní čísla měsíce',
          content: 'Tyto karty dávají rychlou odpověď, co se dnes děje a jak si měsíc provozně stojí.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-kpi-today-jobs',
          target: '[data-tour="dashboard-kpi-today-jobs"]',
          title: 'Dnešní zakázky',
          content: 'Ukazuje počet zakázek naplánovaných na dnešek. Když číslo nesedí, pokračuj do Zakázek nebo Kalendáře a zkontroluj termíny.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-kpi-active-workers',
          target: '[data-tour="dashboard-kpi-active-workers"]',
          title: 'Aktivní směny',
          content: 'Ukazuje, kolik pracovníků má právě započatou směnu. Pomáhá rychle poznat, kdo je teď v práci.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-kpi-completed-jobs',
          target: '[data-tour="dashboard-kpi-completed-jobs"]',
          title: 'Dokončené zakázky',
          content: 'Tady vidíš, kolik zakázek je v aktuálním měsíci hotových. Pokud je hotovo, další logický krok bývá kontrola fakturace.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-kpi-waiting-invoice',
          target: '[data-tour="dashboard-kpi-waiting-invoice"]',
          title: 'Čeká na fakturaci',
          content: 'Tato karta ukazuje práci připravenou k fakturaci. Když je zde částka, je dobré otevřít fakturaci nebo detail zakázky.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-kpi-profit',
          target: '[data-tour="dashboard-kpi-profit"]',
          title: 'Orientační výsledek',
          content: 'Ukazuje provozní výsledek měsíce podle dostupných tržeb a nákladů. Není to účetní ani daňový výsledek.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-attention',
          target: '[data-tour="dashboard-attention"]',
          title: 'Co potřebuje pozornost',
          content: 'Tady najdeš věci k rychlé kontrole: zakázky čekající na fakturaci, nabídky nebo absence. Kliknutím se dostaneš na konkrétní seznam.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-today',
          target: '[data-tour="dashboard-today"]',
          title: 'Dnešní provoz',
          content: 'Tahle část ukazuje aktivní směny, dnešní zakázky a odpracovaný čas. Je to rychlá kontrola, co se děje právě teď.',
          placement: 'top',
        },
        {
          id: 'dashboard-day-jobs',
          target: '[data-tour="dashboard-day-jobs"]',
          title: 'Dnešní a zítřejší zakázky',
          content: 'Přepínačem můžeš zkontrolovat dnešek nebo zítřek. Z karty zakázky se dostaneš rovnou do detailu.',
          placement: 'top',
        },
        {
          id: 'dashboard-month-summary',
          target: '[data-tour="dashboard-month-summary"]',
          title: 'Souhrn zakázek za měsíc',
          content: 'Tady sleduješ vybraný týden v měsíci: počet zakázek, dokončené práce a věci čekající na fakturaci.',
          placement: 'top',
        },
        {
          id: 'dashboard-month-economy',
          target: '[data-tour="dashboard-month-economy"]',
          title: 'Ekonomika měsíce',
          content: 'Graf a tabulka ukazují objednáno, fakturováno, práci, náklady a orientační výsledek. Slouží pro řízení firmy, nenahrazuje účetnictví.',
          placement: 'top',
        },
        {
          id: 'dashboard-job-decisions',
          target: '[data-tour="dashboard-job-decisions"]',
          title: 'Zakázky podle výsledku',
          content: 'Dole najdeš zakázky s dobrým výsledkem a zakázky, které stojí za kontrolu. Pomáhá to rychle poznat, kde vzniká zisk nebo riziko.',
          placement: 'top',
        },
      ],
    },
  },
  jobs: {
    pageKey: 'jobs',
    label: 'Zakázky',
    shortTitle: 'Přehled, detail a nová zakázka',
    shortDescription: 'Zakázky mají přehled, detail s řízením práce a formulář pro založení nebo úpravu.',
    shortSteps: [
      'V přehledu vidíš počty zakázek, dnešní práci a stav fakturace.',
      'Kliknutím na kartu otevřeš detail zakázky.',
      'V detailu řešíš stav, pracovníky, ekonomiku a komunikaci.',
      'Přes Novou zakázku nebo Upravit zakázku se dostaneš do formuláře.',
    ],
    tutorial: {
      id: 'create-job',
      pageKey: 'jobs',
      title: 'Zakázka krok za krokem',
      shortDescription: 'Ukáže přehled, detail i založení nebo úpravu zakázky napříč stránkami.',
      steps: [
        {
          id: 'jobs-overview',
          target: '[data-tour="jobs-overview-summary"]',
          title: 'Přehled zakázek',
          content: 'Tady vidíš rychlý souhrn zakázek, dnešní práci a čekání na fakturaci.',
          placement: 'left',
        },
        {
          id: 'jobs-filters',
          target: '[data-tour="jobs-filters"]',
          title: 'Filtrování přehledu',
          content: 'Tady si zúžíš přehled podle textu, zákazníka, měsíce, řazení nebo stavu zakázky.',
          placement: 'bottom',
        },
        {
          id: 'jobs-list',
          target: '[data-tour="jobs-list"]',
          title: 'Seznam zakázek',
          content: 'Každá karta zakázky vede na detail. V detailu potom řešíš stav, pracovníky, komunikaci a dokončení.',
          placement: 'top',
        },
        {
          id: 'job-detail-header',
          target: '[data-tour="job-detail-header"]',
          title: 'Detail zakázky',
          content: 'Detail ukazuje zákazníka, termín, hlavní stav a rychlé akce pro úpravu nebo dokončení.',
          placement: 'bottom',
        },
        {
          id: 'job-detail-status',
          target: '[data-tour="job-detail-status"]',
          title: 'Stav zakázky',
          content: 'Tady rychle poznáš, v jakém stavu je práce a fakturace.',
          placement: 'top',
        },
        {
          id: 'job-detail-workers',
          target: '[data-tour="job-detail-workers"]',
          title: 'Pracovníci na zakázce',
          content: 'Tady přidáš pracovníky, nastavuješ hodiny a vidíš cenu práce.',
          placement: 'top',
        },
        {
          id: 'job-detail-economics',
          target: '[data-tour="job-detail-economics"]',
          title: 'Ekonomika zakázky',
          content: 'Tady se drží cena, práce, náklady a orientační výsledek zakázky.',
          placement: 'top',
        },
        {
          id: 'job-detail-communication',
          target: '[data-tour="job-detail-communication"]',
          title: 'Komunikace',
          content: 'Tady se drží zprávy k zakázce, aby komunikace nezmizela v osobních schránkách.',
          placement: 'top',
        },
        {
          id: 'new-job',
          target: '[data-tour="new-job-button"]',
          title: 'Nová zakázka',
          content: 'Klikni sem. Průvodce se přesune na stránku nové zakázky a povede tě dál formulářem.',
          placement: 'left',
          action: 'click',
          href: '/jobs/new',
        },
        {
          id: 'job-customer',
          target: '[data-tour="job-customer"]',
          title: 'Zákazník',
          content: 'Vyber zákazníka, pro kterého zakázku vytváříš.',
          placement: 'bottom',
        },
        {
          id: 'job-title',
          target: '[data-tour="job-title"]',
          title: 'Název zakázky',
          content: 'Název by měl být krátký a jasný, aby se v přehledu dobře hledal.',
          placement: 'bottom',
        },
        {
          id: 'job-date',
          target: '[data-tour="job-date"]',
          title: 'Datum',
          content: 'Nastav datum a čas zakázky.',
          placement: 'bottom',
        },
        {
          id: 'job-workers',
          target: '[data-tour="job-workers"]',
          title: 'Pracovníci',
          content: 'Přidej pracovníky, kteří budou na zakázce pracovat.',
          placement: 'top',
        },
        {
          id: 'job-edit-settings',
          target: '[data-tour="job-edit-settings"]',
          title: 'Nastavení zakázky',
          content: 'Při úpravě zakázky tady měníš zákazníka, kontakt a název.',
          placement: 'bottom',
        },
        {
          id: 'job-edit-schedule',
          target: '[data-tour="job-edit-schedule"]',
          title: 'Termín a místo',
          content: 'Tady upravíš čas, datum a adresu zakázky.',
          placement: 'bottom',
        },
        {
          id: 'job-save',
          target: '[data-tour="job-save"]',
          title: 'Uložení',
          content: 'Ulož zakázku. Potom se zobrazí v přehledu a kalendáři.',
          placement: 'top',
        },
      ],
    },
  },
  customers: {
    pageKey: 'customers',
    label: 'Zákazníci',
    shortTitle: 'Jak pracovat se zákazníky',
    shortDescription: 'U zákazníka držíš kontakt, historii zakázek a navazující práci.',
    shortSteps: [
      'Vytvoř nového zákazníka.',
      'Doplň e-mail, telefon a adresu, pokud je znáš.',
      'U zákazníka sleduj historii zakázek a komunikaci.',
    ],
    tutorial: {
      id: 'customers-overview',
      pageKey: 'customers',
      title: 'Zákazníci v Diriqu',
      shortDescription: 'Kde najít zákazníky a jak je používat.',
      steps: [
        {
          id: 'customers-header',
          target: '[data-tour="customers-header"]',
          title: 'Přehled zákazníků',
          content: 'Tady najdeš databázi zákazníků, kontaktní údaje a historii práce.',
          placement: 'bottom',
        },
        {
          id: 'customers-search',
          target: '[data-tour="customers-search"]',
          title: 'Vyhledávání',
          content: 'Vyhledej zákazníka podle názvu, e-mailu, telefonu nebo kontaktní osoby.',
          placement: 'bottom',
        },
        {
          id: 'customers-list',
          target: '[data-tour="customers-list"]',
          title: 'Seznam zákazníků',
          content: 'Kliknutím na kartu otevřeš detail zákazníka se zakázkami, nabídkami a kontakty.',
          placement: 'top',
        },
        {
          id: 'new-customer',
          target: '[data-tour="new-customer-button"]',
          title: 'Nový zákazník',
          content: 'Tady založíš nového zákazníka.',
          placement: 'left',
        },
      ],
    },
  },
  workers: {
    pageKey: 'workers',
    label: 'Pracovníci',
    shortTitle: 'Tým, směny a výplaty',
    shortDescription: 'Pracovníci se přiřazují k zakázkám, mají sazby, směny, zálohy a nepřítomnosti.',
    shortSteps: [
      'V přehledu sleduj měsíc, odpracované hodiny a výplaty.',
      'Přidáním pracovníka vytvoříš člena týmu nebo externistu.',
      'V detailu pracovníka vidíš výplatu, směny, zakázky, zálohy a nepřítomnosti.',
    ],
    tutorial: {
      id: 'workers-overview',
      pageKey: 'workers',
      title: 'Pracovníci krok za krokem',
      shortDescription: 'Ukáže přehled týmu, vytvoření pracovníka a detail pracovníka.',
      steps: [
        {
          id: 'workers-summary',
          target: '[data-tour="workers-summary"]',
          title: 'Souhrn týmu',
          content: 'Tady vidíš hodiny, výplaty, zálohy a práci za vybraný měsíc.',
          placement: 'bottom',
        },
        {
          id: 'workers-month',
          target: '[data-tour="workers-month-filter"]',
          title: 'Měsíc výplat',
          content: 'Přepínáním měsíce změníš období pro hodiny, zálohy a výplaty.',
          placement: 'bottom',
        },
        {
          id: 'workers-list',
          target: '[data-tour="workers-list"]',
          title: 'Seznam pracovníků',
          content: 'Kliknutím na pracovníka otevřeš detail s výplatou, zakázkami, směnami a nepřítomností.',
          placement: 'top',
        },
        {
          id: 'workers-new',
          target: '[data-tour="workers-new-button"]',
          title: 'Přidat pracovníka',
          content: 'Tady založíš nového pracovníka nebo externistu.',
          placement: 'left',
          action: 'click',
          href: '/workers/new',
        },
        {
          id: 'worker-name',
          target: '[data-tour="worker-name"]',
          title: 'Jméno pracovníka',
          content: 'Zadej jméno, které se bude zobrazovat v zakázkách a výplatních přehledech.',
          placement: 'bottom',
        },
        {
          id: 'worker-type',
          target: '[data-tour="worker-type"]',
          title: 'Typ pracovníka',
          content: 'Zvol, jestli jde o běžného pracovníka nebo externistu.',
          placement: 'bottom',
        },
        {
          id: 'worker-rate',
          target: '[data-tour="worker-rate"]',
          title: 'Hodinová sazba',
          content: 'Sazba se použije pro orientační ekonomiku zakázek a výplaty.',
          placement: 'bottom',
        },
        {
          id: 'worker-detail-header',
          target: '[data-tour="worker-detail-header"]',
          title: 'Detail pracovníka',
          content: 'V detailu řešíš konkrétního člena týmu: výplatu, sazbu, pozvánku a výkazy.',
          placement: 'bottom',
        },
        {
          id: 'worker-detail-payroll',
          target: '[data-tour="worker-detail-payroll"]',
          title: 'Výplata',
          content: 'Tady vidíš vypočítaný provozní pohled na výplatu nebo externí práci.',
          placement: 'left',
        },
        {
          id: 'worker-detail-absences',
          target: '[data-tour="worker-detail-absences"]',
          title: 'Nepřítomnosti',
          content: 'Tady u pracovníka zkontroluješ žádosti a schválené nepřítomnosti.',
          placement: 'top',
        },
        {
          id: 'worker-detail-shifts',
          target: '[data-tour="worker-detail-shifts"]',
          title: 'Směny',
          content: 'Směny ukazují reálně odpracovaný čas a mohou být navázané na zakázku.',
          placement: 'top',
        },
      ],
    },
  },
  calendar: {
    pageKey: 'calendar',
    label: 'Kalendář',
    shortTitle: 'Plán práce v čase',
    shortDescription: 'Kalendář ukazuje zakázky a události podle dnů, týdnů nebo měsíců.',
    shortSteps: [
      'Přepínej mezi seznamem, týdnem a měsícem.',
      'Filtruj zakázky a události podle potřeby.',
      'Vytvoř událost, když potřebuješ zaznamenat práci mimo zakázku.',
    ],
    tutorial: {
      id: 'calendar-overview',
      pageKey: 'calendar',
      title: 'Kalendář krok za krokem',
      shortDescription: 'Ukáže přepínání pohledu, filtr a vytvoření události.',
      steps: [
        {
          id: 'calendar-view',
          target: '[data-tour="calendar-view-switcher"]',
          title: 'Pohled kalendáře',
          content: 'Tady přepínáš seznam, týden a měsíc podle toho, jak chceš práci plánovat.',
          placement: 'bottom',
        },
        {
          id: 'calendar-filters',
          target: '[data-tour="calendar-filters"]',
          title: 'Filtry a období',
          content: 'Tady zvolíš typ položek a období, které chceš vidět.',
          placement: 'bottom',
        },
        {
          id: 'calendar-items',
          target: '[data-tour="calendar-items"]',
          title: 'Položky kalendáře',
          content: 'Kliknutím na zakázku nebo událost otevřeš detail.',
          placement: 'top',
        },
        {
          id: 'calendar-new',
          target: '[data-tour="calendar-new-button"]',
          title: 'Nová událost',
          content: 'Tady vytvoříš událost mimo běžnou zakázku.',
          placement: 'left',
          action: 'click',
          href: '/calendar/new',
        },
        {
          id: 'calendar-event-title',
          target: '[data-tour="calendar-event-title"]',
          title: 'Název události',
          content: 'Zadej krátký název, aby bylo v kalendáři hned jasné, o co jde.',
          placement: 'bottom',
        },
        {
          id: 'calendar-event-time',
          target: '[data-tour="calendar-event-time"]',
          title: 'Čas události',
          content: 'Vyber začátek a konec události.',
          placement: 'bottom',
        },
        {
          id: 'calendar-event-relations',
          target: '[data-tour="calendar-event-relations"]',
          title: 'Vazba na zakázku a pracovníky',
          content: 'Událost můžeš propojit se zakázkou a vybrat pracovníky.',
          placement: 'top',
        },
        {
          id: 'calendar-event-save',
          target: '[data-tour="calendar-event-save"]',
          title: 'Uložení události',
          content: 'Po uložení se událost zobrazí v kalendáři.',
          placement: 'top',
        },
      ],
    },
  },
  absences: {
    pageKey: 'absences',
    label: 'Nepřítomnosti',
    shortTitle: 'Schvalování nepřítomností',
    shortDescription: 'Nepřítomnosti slouží pro dovolené, nemoc a další žádosti pracovníků.',
    shortSteps: [
      'Nahoře vidíš počet čekajících, schválených a zamítnutých žádostí.',
      'Filtry zúží žádosti podle roku, měsíce a stavu.',
      'U čekající žádosti můžeš schválit nebo zamítnout.',
    ],
    tutorial: {
      id: 'absences-overview',
      pageKey: 'absences',
      title: 'Nepřítomnosti krok za krokem',
      shortDescription: 'Ukáže přehled, filtry a schvalování žádostí.',
      steps: [
        {
          id: 'absences-summary',
          target: '[data-tour="absences-summary"]',
          title: 'Souhrn žádostí',
          content: 'Tady rychle vidíš čekající, schválené a zamítnuté žádosti.',
          placement: 'bottom',
        },
        {
          id: 'absences-filters',
          target: '[data-tour="absences-filters"]',
          title: 'Filtry',
          content: 'Filtruj podle roku, měsíce a stavu, aby ses dostal k potřebným žádostem.',
          placement: 'bottom',
        },
        {
          id: 'absences-list',
          target: '[data-tour="absences-list"]',
          title: 'Seznam žádostí',
          content: 'Každá karta ukazuje pracovníka, typ nepřítomnosti, termín, poznámku a stav.',
          placement: 'top',
        },
        {
          id: 'absence-actions',
          target: '[data-tour="absence-actions"]',
          title: 'Schválení nebo zamítnutí',
          content: 'U čekajících žádostí tady rozhodneš, jestli je schválíš nebo zamítneš.',
          placement: 'top',
        },
      ],
    },
  },
  advance_requests: {
    pageKey: 'advance_requests',
    label: 'Zálohy',
    shortTitle: 'Žádosti o zálohy',
    shortDescription: 'Zálohy pomáhají řešit žádosti pracovníků před výplatou.',
    shortSteps: [
      'Sleduj čekající, schválené, zamítnuté a vyplacené žádosti.',
      'Vyber výplatní měsíc a stav.',
      'U žádosti nastav částku a proveď schválení, zamítnutí nebo vyplacení.',
    ],
    tutorial: {
      id: 'advance-requests-overview',
      pageKey: 'advance_requests',
      title: 'Zálohy krok za krokem',
      shortDescription: 'Ukáže přehled a vyhodnocení žádosti o zálohu.',
      steps: [
        {
          id: 'advance-summary',
          target: '[data-tour="advance-summary"]',
          title: 'Souhrn záloh',
          content: 'Tady vidíš počet žádostí a celkovou částku ve vybraném pohledu.',
          placement: 'bottom',
        },
        {
          id: 'advance-filters',
          target: '[data-tour="advance-filters"]',
          title: 'Filtry',
          content: 'Tady přepínáš rok, výplatní měsíc a stav žádosti.',
          placement: 'bottom',
        },
        {
          id: 'advance-list',
          target: '[data-tour="advance-list"]',
          title: 'Seznam žádostí',
          content: 'V seznamu zkontroluješ pracovníka, důvod a požadovanou částku.',
          placement: 'top',
        },
        {
          id: 'advance-actions',
          target: '[data-tour="advance-actions"]',
          title: 'Akce nad žádostí',
          content: 'U žádosti můžeš upravit částku a potom ji schválit, zamítnout nebo označit jako vyplacenou.',
          placement: 'top',
        },
      ],
    },
  },
  finance: {
    pageKey: 'finance',
    label: 'Finance',
    shortTitle: 'Jak číst finance',
    shortDescription: 'Finance ukazují orientační provozní přehled tržeb, zisku a fakturace.',
    shortSteps: [
      'Sleduj tržby a čekající fakturaci.',
      'Kontroluj orientační zisk zakázek.',
      'Pro náklady používej samostatnou sekci Náklady.',
    ],
    tutorial: {
      id: 'finance-overview',
      pageKey: 'finance',
      title: 'Finance',
      shortDescription: 'Základní orientace ve financích.',
      steps: [
        {
          id: 'invoices-nav',
          target: '[data-tour="nav-invoices"]',
          title: 'Fakturace',
          content: 'Fakturace pomáhá řešit odeslané a čekající doklady.',
          placement: 'right',
        },
      ],
    },
  },
  invoices: {
    pageKey: 'invoices',
    label: 'Fakturace',
    shortTitle: 'Faktury a stav plateb',
    shortDescription: 'Fakturace ukazuje doklady, stav zaplacení, splatnost a export do účetnictví.',
    shortSteps: [
      'Nahoře vytvoříš novou fakturu.',
      'Filtry zvolí měsíc, stav a export.',
      'V tabulce otevřeš konkrétní fakturu a zkontroluješ číslo, zákazníka, splatnost a částku.',
    ],
    tutorial: {
      id: 'invoices-overview',
      pageKey: 'invoices',
      title: 'Fakturace krok za krokem',
      shortDescription: 'Ukáže vytvoření faktury, filtry a seznam dokladů.',
      steps: [
        {
          id: 'invoices-header',
          target: '[data-tour="invoices-header"]',
          title: 'Fakturace',
          content: 'Tady řešíš interní faktury, jejich stav a export.',
          placement: 'bottom',
        },
        {
          id: 'new-invoice',
          target: '[data-tour="new-invoice-button"]',
          title: 'Nová faktura',
          content: 'Tady vytvoříš nový doklad. Vybereš zákazníka, položky a splatnost.',
          placement: 'left',
        },
        {
          id: 'invoice-filters',
          target: '[data-tour="invoices-filters"]',
          title: 'Filtry',
          content: 'Tady zúžíš faktury podle měsíce, stavu a exportu.',
          placement: 'bottom',
        },
        {
          id: 'invoice-list',
          target: '[data-tour="invoices-list"]',
          title: 'Seznam faktur',
          content: 'Kliknutím na číslo faktury otevřeš detail dokladu.',
          placement: 'top',
        },
      ],
    },
  },
  calculations: {
    pageKey: 'calculations',
    label: 'Kalkulace',
    shortTitle: 'Interní výpočet ceny',
    shortDescription: 'Kalkulace slouží k přípravě ceny, nákladů a marže před vytvořením nabídky.',
    shortSteps: [
      'V přehledu vyber měsíc, zákazníka a řazení.',
      'Klikni na Novou kalkulaci.',
      'Vyber zákazníka nebo začni bez zákazníka.',
      'Doplň položky pro zákazníka a interní náklady.',
      'Ulož kalkulaci a pokračuj na nabídku.',
    ],
    tutorial: {
      id: 'calculations-flow',
      pageKey: 'calculations',
      title: 'Kalkulace krok za krokem',
      shortDescription: 'Provede tě přehledem, výběrem zákazníka a formulářovou kalkulací.',
      steps: [
        {
          id: 'calculations-header',
          target: '[data-tour="calculations-header"]',
          title: 'Přehled kalkulací',
          content: 'Tady vidíš interní kalkulace za vybraný měsíc napříč zákazníky.',
          placement: 'bottom',
        },
        {
          id: 'calculations-filters',
          target: '[data-tour="calculations-filters"]',
          title: 'Filtry',
          content: 'Filtrováním si najdeš kalkulace podle zákazníka, měsíce a řazení.',
          placement: 'bottom',
        },
        {
          id: 'calculations-list',
          target: '[data-tour="calculations-list"]',
          title: 'Seznam kalkulací',
          content: 'Každá karta vede na detail kalkulace, kde můžeš kontrolovat cenu, náklady a zisk.',
          placement: 'top',
        },
        {
          id: 'new-calculation',
          target: '[data-tour="new-calculation-button"]',
          title: 'Nová kalkulace',
          content: 'Tady začneš novou kalkulaci. Průvodce tě přesune na výběr zákazníka.',
          placement: 'left',
          action: 'click',
          href: '/kalkulace/nova',
        },
        {
          id: 'calculation-customer-choice',
          target: '[data-tour="calculation-customer-choice"]',
          title: 'Výběr zákazníka',
          content: 'Kalkulaci můžeš navázat na existujícího zákazníka, vytvořit nového nebo pokračovat bez zákazníka.',
          placement: 'bottom',
        },
        {
          id: 'calculation-without-customer',
          target: '[data-tour="calculation-without-customer"]',
          title: 'Bez zákazníka',
          content: 'Když ještě nevíš, komu bude nabídka patřit, začni bez zákazníka a doplníš ho později.',
          placement: 'left',
          action: 'click',
          href: '/kalkulace/nova/bez-zakaznika',
        },
        {
          id: 'calculation-basic',
          target: '[data-tour="calculation-basic"]',
          title: 'Základ kalkulace',
          content: 'Zadej název, datum, stav a krátký popis.',
          placement: 'bottom',
        },
        {
          id: 'calculation-customer-items',
          target: '[data-tour="calculation-customer-items"]',
          title: 'Položky pro zákazníka',
          content: 'Sem zadáš, co bude zákazníkovi naceněno a za jakou prodejní cenu.',
          placement: 'top',
        },
        {
          id: 'calculation-cost-items',
          target: '[data-tour="calculation-cost-items"]',
          title: 'Interní náklady',
          content: 'Tady zadáš práci, materiál, dopravu nebo další náklady. Z toho se počítá orientační marže.',
          placement: 'top',
        },
        {
          id: 'calculation-summary',
          target: '[data-tour="calculation-summary"]',
          title: 'Souhrn',
          content: 'Souhrn ti ukáže cenu pro zákazníka, náklady a očekávaný výsledek.',
          placement: 'top',
        },
        {
          id: 'calculation-save',
          target: '[data-tour="calculation-save"]',
          title: 'Uložení',
          content: 'Po uložení se kalkulace zobrazí v přehledu a můžeš z ní připravit nabídku.',
          placement: 'top',
        },
      ],
    },
  },
  quotes: {
    pageKey: 'quotes',
    label: 'Cenové nabídky',
    shortTitle: 'Nabídky pro zákazníky',
    shortDescription: 'Cenové nabídky vycházejí z kalkulací a slouží k odeslání ceny zákazníkovi.',
    shortSteps: [
      'Nabídku připrav z kalkulace.',
      'Ve filtrech najdi nabídky podle měsíce, zákazníka a stavu.',
      'V přehledu sleduj, jestli je nabídka koncept, odeslaná, přijatá nebo propadlá.',
    ],
    tutorial: {
      id: 'quotes-overview',
      pageKey: 'quotes',
      title: 'Cenové nabídky krok za krokem',
      shortDescription: 'Ukáže přehled nabídek a navázání na kalkulace.',
      steps: [
        {
          id: 'quotes-header',
          target: '[data-tour="quotes-header"]',
          title: 'Přehled nabídek',
          content: 'Tady sleduješ nabídky, jejich stav a cenu.',
          placement: 'bottom',
        },
        {
          id: 'quotes-from-calculation',
          target: '[data-tour="quote-from-calculation-button"]',
          title: 'Vytvořit z kalkulace',
          content: 'Nabídka typicky začíná kalkulací. Kliknutím přejdeš na kalkulace.',
          placement: 'left',
        },
        {
          id: 'quotes-filters',
          target: '[data-tour="quotes-filters"]',
          title: 'Filtry nabídek',
          content: 'Tady zvolíš měsíc, zákazníka a stav nabídky.',
          placement: 'bottom',
        },
        {
          id: 'quotes-list',
          target: '[data-tour="quotes-list"]',
          title: 'Seznam nabídek',
          content: 'Kliknutím otevřeš detail nabídky, kde ji můžeš kontrolovat a poslat zákazníkovi.',
          placement: 'top',
        },
      ],
    },
  },
  leads: {
    pageKey: 'leads',
    label: 'Poptávky',
    shortTitle: 'Webové poptávky',
    shortDescription: 'Poptávky jsou vstup z webového add-onu a mohou navazovat na kalkulaci nebo zákazníka.',
    shortSteps: [
      'Poptávky jsou dostupné po zapnutí webového balíčku.',
      'Po zapnutí se nové dotazy z webu uloží do Diriqa.',
      'Z poptávky potom vytvoříš zákazníka, kalkulaci nebo zakázku.',
    ],
    tutorial: {
      id: 'leads-overview',
      pageKey: 'leads',
      title: 'Poptávky',
      shortDescription: 'Základní vysvětlení webových poptávek.',
      steps: [
        {
          id: 'leads-page',
          target: '[data-tour="leads-addon-panel"]',
          title: 'Webový add-on',
          content: 'Tady uvidíš stav webových poptávek. Pokud add-on není aktivní, stránka vysvětlí, co chybí.',
          placement: 'bottom',
        },
        {
          id: 'subscription',
          target: '[data-tour="nav-companySettings"]',
          title: 'Objednání webového balíčku',
          content: 'Webový balíček najdeš ve Společnost > Předplatné.',
          placement: 'right',
        },
      ],
    },
  },
  costs: {
    pageKey: 'costs',
    label: 'Náklady',
    shortTitle: 'Jak zadávat náklady',
    shortDescription: 'Náklady dávají jednoduchý provozní pohled na to, co firma platí.',
    shortSteps: [
      'Vyber měsíc, který chceš kontrolovat.',
      'Přidej fixní náklad, třeba nájem nebo software.',
      'Přidej ruční náklad k zakázce nebo jednorázový výdaj.',
    ],
    tutorial: {
      id: 'costs-overview',
      pageKey: 'costs',
      title: 'Náklady',
      shortDescription: 'Jak pracovat s fixními a ručními náklady.',
      steps: [
        {
          id: 'month-filter',
          target: '[data-tour="costs-month-filter"]',
          title: 'Měsíc',
          content: 'Tady zvolíš měsíc, pro který chceš vidět náklady.',
          placement: 'bottom',
        },
        {
          id: 'expense-button',
          target: '[data-tour="add-expense-button"]',
          title: 'Přidat náklad',
          content: 'Sem zadáš jednorázový nebo zakázkový náklad.',
          placement: 'left',
        },
        {
          id: 'fixed-button',
          target: '[data-tour="add-fixed-cost-button"]',
          title: 'Přidat fixní náklad',
          content: 'Sem patří opakované náklady jako nájem, energie nebo software.',
          placement: 'left',
        },
      ],
    },
  },
  offers: {
    pageKey: 'offers',
    label: 'Nabídky',
    shortTitle: 'Jak používat nabídky',
    shortDescription: 'Nabídky pomáhají připravit cenu a poslat ji zákazníkovi.',
    shortSteps: [
      'Vytvoř kalkulaci nebo nabídku.',
      'Doplň položky a cenu.',
      'Odešli zákazníkovi a sleduj reakci.',
    ],
    tutorial: {
      id: 'offers-overview',
      pageKey: 'offers',
      title: 'Nabídky',
      shortDescription: 'Základní práce s nabídkami.',
      steps: [
        {
          id: 'quotes-nav',
          target: '[data-tour="nav-quotes"]',
          title: 'Nabídky',
          content: 'Tady najdeš cenové nabídky a jejich stav.',
          placement: 'right',
        },
      ],
    },
  },
  settings: {
    pageKey: 'settings',
    label: 'Nastavení',
    shortTitle: 'Jak spravovat nastavení',
    shortDescription: 'V nastavení upravíš firmu, jazyk, menu a členy týmu.',
    shortSteps: [
      'Zkontroluj firemní údaje.',
      'Uprav jazyk a menu.',
      'Spravuj členy týmu podle potřeby.',
    ],
    tutorial: {
      id: 'settings-overview',
      pageKey: 'settings',
      title: 'Nastavení',
      shortDescription: 'Kde upravit firmu a tým.',
      steps: [
        {
          id: 'settings-nav',
          target: '[data-tour="nav-companySettings"]',
          title: 'Nastavení firmy',
          content: 'Tady upravíš základní firemní údaje.',
          placement: 'right',
        },
      ],
    },
  },
}

const englishIntroHelpStep: TutorialStep = {
  id: 'floating-help',
  target: '[data-tour="floating-help-button"]',
  title: 'This is where help lives',
  content:
    'When you are not sure what to do next, click here. Help always adapts to the page you are currently viewing.',
  placement: 'left',
  action: 'read',
}

const englishCurrentPageHelpStep: TutorialStep = {
  id: 'current-page-help',
  target: '[data-tour="floating-help-panel"]',
  title: 'Help for the current page',
  content:
    'This panel gives you a short guide, a step-by-step walkthrough, and a link to the full help center. You can close it anytime.',
  placement: 'left',
  action: 'read',
}

const englishOnboardingIntroTutorials: Record<'quick' | 'detailed', TutorialDefinition> = {
  quick: {
    id: 'intro-help-quick',
    pageKey: 'first_steps',
    title: 'Quick orientation',
    shortDescription: 'Shows where contextual help is and how to use it.',
    steps: [
      englishIntroHelpStep,
      englishCurrentPageHelpStep,
      {
        id: 'dashboard-overview',
        target: '[data-tour="nav-dashboard"]',
        title: 'Overview',
        content: 'The overview is a fast summary of today’s work, alerts, and basic operational economics.',
        placement: 'right',
        action: 'read',
      },
      {
        id: 'jobs-overview',
        target: '[data-tour="nav-jobs"]',
        title: 'Jobs',
        content: 'Jobs connect the customer, date, workers, calendar, and work completion.',
        placement: 'right',
        action: 'read',
      },
    ],
  },
  detailed: {
    id: 'intro-help-detailed',
    pageKey: 'first_steps',
    title: 'Detailed tutorial',
    shortDescription: 'Starts with help and then shows the main parts of the app.',
    steps: [
      englishIntroHelpStep,
      englishCurrentPageHelpStep,
      {
        id: 'settings',
        target: '[data-tour="nav-companySettings"]',
        title: 'Company settings',
        content: 'Edit company details, language, menu, and team members here.',
        placement: 'right',
        action: 'read',
      },
      {
        id: 'workers',
        target: '[data-tour="nav-workers"]',
        title: 'Workers',
        content: 'Workers are assigned to jobs and help you plan capacity.',
        placement: 'right',
        action: 'read',
      },
      {
        id: 'calendar',
        target: '[data-tour="nav-calendar"]',
        title: 'Calendar',
        content: 'The calendar shows jobs and events by day, week, or month.',
        placement: 'right',
        action: 'read',
      },
      {
        id: 'absences',
        target: '[data-tour="nav-absences"]',
        title: 'Absences',
        content: 'Approve vacations, sickness, and other worker absences here.',
        placement: 'right',
        action: 'read',
      },
      {
        id: 'jobs',
        target: '[data-tour="nav-jobs"]',
        title: 'Jobs',
        content: 'A job is the main work unit in Diriqo. It is planned, completed, and invoiced from here.',
        placement: 'right',
        action: 'read',
      },
      {
        id: 'costs',
        target: '[data-tour="nav-costs"]',
        title: 'Costs',
        content: 'Costs give you an operational view of fixed, job-related, and one-off expenses.',
        placement: 'right',
        action: 'read',
      },
    ],
  },
}

const englishPageHelpDefinitions: Record<HelpPageKey, PageHelpDefinition> = {
  first_steps: {
    pageKey: 'first_steps',
    label: 'First steps',
    shortTitle: 'Start without waiting',
    shortDescription: 'Choose a mode, try the help, and return to work whenever you need.',
    shortSteps: [
      'Choose whether you want to start immediately, get a quick orientation, or follow a detailed tutorial.',
      'When you are not sure what to do next, click the help button in the bottom-right corner.',
      'You can close the tutorial or start it again anytime.',
    ],
    tutorial: englishOnboardingIntroTutorials.quick,
  },
  dashboard: {
    pageKey: 'dashboard',
    label: 'Overview',
    shortTitle: 'How to read the overview',
    shortDescription: 'The overview shows today’s work, items that need attention, and the company’s operational result.',
    shortSteps: [
      'At the top you see the selected month, quick actions, and notes.',
      'KPI cards show today’s jobs, active shifts, completed jobs, waiting invoicing, and the operational result.',
      'The “Needs attention” block points you to items worth checking.',
      'Today’s work and weekly summaries show what is planned, completed, and waiting for invoicing.',
      'Economics is an operational view for decisions, not accounting.',
    ],
    tutorial: {
      id: 'dashboard-overview',
      pageKey: 'dashboard',
      title: 'Overview step by step',
      shortDescription: 'Explains the main cards, alerts, and operational economics.',
      steps: [
        {
          id: 'dashboard-hero',
          target: '[data-tour="dashboard-hero"]',
          title: 'Top overview',
          content: 'Here you see the selected day and month, ordered work value, and quick links to a new job, jobs, and customers.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-quick-notes',
          target: '[data-tour="dashboard-quick-notes"]',
          title: 'Quick notes',
          content: 'Use this for short internal team notes that do not need to become a job yet.',
          placement: 'left',
        },
        {
          id: 'dashboard-kpi-section',
          target: '[data-tour="dashboard-kpi-section"]',
          title: 'Main monthly numbers',
          content: 'These cards quickly show what is happening today and how the month is doing operationally.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-kpi-today-jobs',
          target: '[data-tour="dashboard-kpi-today-jobs"]',
          title: 'Today’s jobs',
          content: 'Shows how many jobs are scheduled for today. If the number looks wrong, check Jobs or Calendar.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-kpi-active-workers',
          target: '[data-tour="dashboard-kpi-active-workers"]',
          title: 'Active shifts',
          content: 'Shows how many workers currently have a started shift, so you know who is working right now.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-kpi-completed-jobs',
          target: '[data-tour="dashboard-kpi-completed-jobs"]',
          title: 'Completed jobs',
          content: 'Shows how many jobs are done in the selected month. The next logical step is usually billing review.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-kpi-waiting-invoice',
          target: '[data-tour="dashboard-kpi-waiting-invoice"]',
          title: 'Waiting for invoice',
          content: 'This card shows work ready to be invoiced. When there is an amount here, open invoicing or the job detail.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-kpi-profit',
          target: '[data-tour="dashboard-kpi-profit"]',
          title: 'Operational result',
          content: 'Shows the month’s operational result from available revenue and costs. It is not an accounting or tax result.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-attention',
          target: '[data-tour="dashboard-attention"]',
          title: 'Needs attention',
          content: 'Here you find quick checks such as jobs waiting for invoicing, quotes, or absences. Click an item to open its list.',
          placement: 'bottom',
        },
        {
          id: 'dashboard-today',
          target: '[data-tour="dashboard-today"]',
          title: 'Today’s operations',
          content: 'This area shows active shifts, today’s jobs, and worked time. It is a quick check of what is happening now.',
          placement: 'top',
        },
        {
          id: 'dashboard-day-jobs',
          target: '[data-tour="dashboard-day-jobs"]',
          title: 'Today and tomorrow',
          content: 'Use the toggle to check today or tomorrow. Clicking a job card opens the job detail.',
          placement: 'top',
        },
        {
          id: 'dashboard-month-summary',
          target: '[data-tour="dashboard-month-summary"]',
          title: 'Monthly job summary',
          content: 'Track the selected week in the month: job count, completed work, and items waiting for invoicing.',
          placement: 'top',
        },
        {
          id: 'dashboard-month-economy',
          target: '[data-tour="dashboard-month-economy"]',
          title: 'Monthly economics',
          content: 'The chart and table show ordered, invoiced, labor, costs, and operational result. This helps manage the company, but it is not accounting.',
          placement: 'top',
        },
        {
          id: 'dashboard-job-decisions',
          target: '[data-tour="dashboard-job-decisions"]',
          title: 'Jobs by result',
          content: 'At the bottom you see jobs with good results and jobs worth checking. It helps you spot profit and risk quickly.',
          placement: 'top',
        },
      ],
    },
  },
  jobs: {
    pageKey: 'jobs',
    label: 'Jobs',
    shortTitle: 'Overview, detail, and new job',
    shortDescription: 'Jobs have an overview, a detail page for managing work, and a form for creating or editing.',
    shortSteps: [
      'In the overview you see job counts, today’s work, and billing status.',
      'Click a card to open the job detail.',
      'In the detail you manage status, workers, economics, and communication.',
      'Use New job or Edit job to open the form.',
    ],
    tutorial: {
      id: 'create-job',
      pageKey: 'jobs',
      title: 'Job step by step',
      shortDescription: 'Shows the overview, detail, and create/edit flow across pages.',
      steps: [
        {
          id: 'jobs-overview',
          target: '[data-tour="jobs-overview-summary"]',
          title: 'Jobs overview',
          content: 'Here you see a quick summary of jobs, today’s work, and work waiting for invoicing.',
          placement: 'left',
        },
        {
          id: 'jobs-filters',
          target: '[data-tour="jobs-filters"]',
          title: 'Filters',
          content: 'Filter the overview by text, customer, month, sorting, or job status.',
          placement: 'bottom',
        },
        {
          id: 'jobs-list',
          target: '[data-tour="jobs-list"]',
          title: 'Job list',
          content: 'Each job card opens the detail where you manage status, workers, communication, and completion.',
          placement: 'top',
        },
        {
          id: 'job-detail-header',
          target: '[data-tour="job-detail-header"]',
          title: 'Job detail',
          content: 'The detail shows customer, date, main status, and quick actions for editing or completion.',
          placement: 'bottom',
        },
        {
          id: 'job-detail-status',
          target: '[data-tour="job-detail-status"]',
          title: 'Job status',
          content: 'This quickly shows the current work and billing status.',
          placement: 'top',
        },
        {
          id: 'job-detail-workers',
          target: '[data-tour="job-detail-workers"]',
          title: 'Workers on the job',
          content: 'Add workers, set hours, and see the cost of work here.',
          placement: 'top',
        },
        {
          id: 'job-detail-economics',
          target: '[data-tour="job-detail-economics"]',
          title: 'Job economics',
          content: 'This area keeps price, labor, costs, and the operational job result together.',
          placement: 'top',
        },
        {
          id: 'job-detail-communication',
          target: '[data-tour="job-detail-communication"]',
          title: 'Communication',
          content: 'Messages connected to the job stay here instead of disappearing in personal inboxes.',
          placement: 'top',
        },
        {
          id: 'new-job',
          target: '[data-tour="new-job-button"]',
          title: 'New job',
          content: 'Click here. The guide will move to the new job page and continue through the form.',
          placement: 'left',
          action: 'click',
          href: '/jobs/new',
        },
        {
          id: 'job-customer',
          target: '[data-tour="job-customer"]',
          title: 'Customer',
          content: 'Choose the customer for this job.',
          placement: 'bottom',
        },
        {
          id: 'job-title',
          target: '[data-tour="job-title"]',
          title: 'Job title',
          content: 'Use a short clear title so the job is easy to find later.',
          placement: 'bottom',
        },
        {
          id: 'job-date',
          target: '[data-tour="job-date"]',
          title: 'Date',
          content: 'Set the date and time of the job.',
          placement: 'bottom',
        },
        {
          id: 'job-workers',
          target: '[data-tour="job-workers"]',
          title: 'Workers',
          content: 'Add workers who will work on the job.',
          placement: 'top',
        },
        {
          id: 'job-edit-settings',
          target: '[data-tour="job-edit-settings"]',
          title: 'Job settings',
          content: 'When editing a job, this is where you change customer, contact, and title.',
          placement: 'bottom',
        },
        {
          id: 'job-edit-schedule',
          target: '[data-tour="job-edit-schedule"]',
          title: 'Date and place',
          content: 'Edit the job time, date, and address here.',
          placement: 'bottom',
        },
        {
          id: 'job-save',
          target: '[data-tour="job-save"]',
          title: 'Save',
          content: 'Save the job. It will then appear in the overview and calendar.',
          placement: 'top',
        },
      ],
    },
  },
  customers: {
    pageKey: 'customers',
    label: 'Customers',
    shortTitle: 'How to work with customers',
    shortDescription: 'A customer keeps contact details, job history, and related work in one place.',
    shortSteps: [
      'Create a new customer.',
      'Add email, phone, and address when you know them.',
      'Use the customer detail to follow job history and communication.',
    ],
    tutorial: {
      id: 'customers-overview',
      pageKey: 'customers',
      title: 'Customers in Diriqo',
      shortDescription: 'Where to find customers and how to use them.',
      steps: [
        {
          id: 'customers-header',
          target: '[data-tour="customers-header"]',
          title: 'Customer overview',
          content: 'This is the customer database with contact details and work history.',
          placement: 'bottom',
        },
        {
          id: 'customers-search',
          target: '[data-tour="customers-search"]',
          title: 'Search',
          content: 'Search by customer name, email, phone, or contact person.',
          placement: 'bottom',
        },
        {
          id: 'customers-list',
          target: '[data-tour="customers-list"]',
          title: 'Customer list',
          content: 'Click a card to open the customer detail with jobs, quotes, and contacts.',
          placement: 'top',
        },
        {
          id: 'new-customer',
          target: '[data-tour="new-customer-button"]',
          title: 'New customer',
          content: 'Create a new customer here.',
          placement: 'left',
        },
      ],
    },
  },
  workers: {
    pageKey: 'workers',
    label: 'Workers',
    shortTitle: 'Team, shifts, and payouts',
    shortDescription: 'Workers are assigned to jobs and have rates, shifts, advances, and absences.',
    shortSteps: [
      'In the overview, follow the month, worked hours, and payouts.',
      'Add a worker to create a team member or external contractor.',
      'In the worker detail, view payout, shifts, jobs, advances, and absences.',
    ],
    tutorial: {
      id: 'workers-overview',
      pageKey: 'workers',
      title: 'Workers step by step',
      shortDescription: 'Shows the team overview, worker creation, and worker detail.',
      steps: [
        {
          id: 'workers-summary',
          target: '[data-tour="workers-summary"]',
          title: 'Team summary',
          content: 'Here you see hours, payouts, advances, and work for the selected month.',
          placement: 'bottom',
        },
        {
          id: 'workers-month',
          target: '[data-tour="workers-month-filter"]',
          title: 'Payroll month',
          content: 'Switch the month to change the period for hours, advances, and payouts.',
          placement: 'bottom',
        },
        {
          id: 'workers-list',
          target: '[data-tour="workers-list"]',
          title: 'Worker list',
          content: 'Click a worker to open the detail with payout, jobs, shifts, and absences.',
          placement: 'top',
        },
        {
          id: 'workers-new',
          target: '[data-tour="workers-new-button"]',
          title: 'Add worker',
          content: 'Create a new worker or contractor here.',
          placement: 'left',
          action: 'click',
          href: '/workers/new',
        },
        {
          id: 'worker-name',
          target: '[data-tour="worker-name"]',
          title: 'Worker name',
          content: 'Enter the name shown in jobs and payout summaries.',
          placement: 'bottom',
        },
        {
          id: 'worker-type',
          target: '[data-tour="worker-type"]',
          title: 'Worker type',
          content: 'Choose whether this is a regular worker or an external contractor.',
          placement: 'bottom',
        },
        {
          id: 'worker-rate',
          target: '[data-tour="worker-rate"]',
          title: 'Hourly rate',
          content: 'The rate is used for operational job economics and payouts.',
          placement: 'bottom',
        },
        {
          id: 'worker-detail-header',
          target: '[data-tour="worker-detail-header"]',
          title: 'Worker detail',
          content: 'The detail handles one team member: payout, rate, invitation, and reports.',
          placement: 'bottom',
        },
        {
          id: 'worker-detail-payroll',
          target: '[data-tour="worker-detail-payroll"]',
          title: 'Payout',
          content: 'Here you see the calculated operational view of payroll or contractor work.',
          placement: 'left',
        },
        {
          id: 'worker-detail-absences',
          target: '[data-tour="worker-detail-absences"]',
          title: 'Absences',
          content: 'Check the worker’s requests and approved absences here.',
          placement: 'top',
        },
        {
          id: 'worker-detail-shifts',
          target: '[data-tour="worker-detail-shifts"]',
          title: 'Shifts',
          content: 'Shifts show real worked time and can be connected to a job.',
          placement: 'top',
        },
      ],
    },
  },
  calendar: {
    pageKey: 'calendar',
    label: 'Calendar',
    shortTitle: 'Work plan over time',
    shortDescription: 'The calendar shows jobs and events by day, week, or month.',
    shortSteps: [
      'Switch between list, week, and month views.',
      'Filter jobs and events as needed.',
      'Create an event when you need to record work outside a normal job.',
    ],
    tutorial: {
      id: 'calendar-overview',
      pageKey: 'calendar',
      title: 'Calendar step by step',
      shortDescription: 'Shows view switching, filters, and creating an event.',
      steps: [
        {
          id: 'calendar-view',
          target: '[data-tour="calendar-view-switcher"]',
          title: 'Calendar view',
          content: 'Switch between list, week, and month depending on how you want to plan work.',
          placement: 'bottom',
        },
        {
          id: 'calendar-filters',
          target: '[data-tour="calendar-filters"]',
          title: 'Filters and period',
          content: 'Choose the item type and period you want to see.',
          placement: 'bottom',
        },
        {
          id: 'calendar-items',
          target: '[data-tour="calendar-items"]',
          title: 'Calendar items',
          content: 'Click a job or event to open its detail.',
          placement: 'top',
        },
        {
          id: 'calendar-new',
          target: '[data-tour="calendar-new-button"]',
          title: 'New event',
          content: 'Create an event outside a normal job here.',
          placement: 'left',
          action: 'click',
          href: '/calendar/new',
        },
        {
          id: 'calendar-event-title',
          target: '[data-tour="calendar-event-title"]',
          title: 'Event title',
          content: 'Enter a short title so the calendar is clear at a glance.',
          placement: 'bottom',
        },
        {
          id: 'calendar-event-time',
          target: '[data-tour="calendar-event-time"]',
          title: 'Event time',
          content: 'Choose the start and end time of the event.',
          placement: 'bottom',
        },
        {
          id: 'calendar-event-relations',
          target: '[data-tour="calendar-event-relations"]',
          title: 'Job and worker connection',
          content: 'You can connect the event to a job and select workers.',
          placement: 'top',
        },
        {
          id: 'calendar-event-save',
          target: '[data-tour="calendar-event-save"]',
          title: 'Save event',
          content: 'After saving, the event appears in the calendar.',
          placement: 'top',
        },
      ],
    },
  },
  absences: {
    pageKey: 'absences',
    label: 'Absences',
    shortTitle: 'Approving absences',
    shortDescription: 'Absences cover vacations, sickness, and other worker requests.',
    shortSteps: [
      'At the top you see pending, approved, and rejected requests.',
      'Use filters to narrow requests by year, month, and status.',
      'Approve or reject pending requests.',
    ],
    tutorial: {
      id: 'absences-overview',
      pageKey: 'absences',
      title: 'Absences step by step',
      shortDescription: 'Shows the overview, filters, and approving requests.',
      steps: [
        {
          id: 'absences-summary',
          target: '[data-tour="absences-summary"]',
          title: 'Request summary',
          content: 'Quickly see pending, approved, and rejected requests here.',
          placement: 'bottom',
        },
        {
          id: 'absences-filters',
          target: '[data-tour="absences-filters"]',
          title: 'Filters',
          content: 'Filter by year, month, and status to find the requests you need.',
          placement: 'bottom',
        },
        {
          id: 'absences-list',
          target: '[data-tour="absences-list"]',
          title: 'Request list',
          content: 'Each card shows worker, absence type, date, note, and status.',
          placement: 'top',
        },
        {
          id: 'absence-actions',
          target: '[data-tour="absence-actions"]',
          title: 'Approve or reject',
          content: 'For pending requests, decide here whether to approve or reject them.',
          placement: 'top',
        },
      ],
    },
  },
  advance_requests: {
    pageKey: 'advance_requests',
    label: 'Advances',
    shortTitle: 'Advance requests',
    shortDescription: 'Advances help handle worker requests before payroll.',
    shortSteps: [
      'Follow pending, approved, rejected, and paid requests.',
      'Choose the payroll month and status.',
      'Set the amount and approve, reject, or mark the request as paid.',
    ],
    tutorial: {
      id: 'advance-requests-overview',
      pageKey: 'advance_requests',
      title: 'Advances step by step',
      shortDescription: 'Shows the overview and evaluation of advance requests.',
      steps: [
        {
          id: 'advance-summary',
          target: '[data-tour="advance-summary"]',
          title: 'Advance summary',
          content: 'Here you see request counts and the total amount for the selected view.',
          placement: 'bottom',
        },
        {
          id: 'advance-filters',
          target: '[data-tour="advance-filters"]',
          title: 'Filters',
          content: 'Switch year, payroll month, and request status here.',
          placement: 'bottom',
        },
        {
          id: 'advance-list',
          target: '[data-tour="advance-list"]',
          title: 'Request list',
          content: 'Check the worker, reason, and requested amount in the list.',
          placement: 'top',
        },
        {
          id: 'advance-actions',
          target: '[data-tour="advance-actions"]',
          title: 'Request actions',
          content: 'Edit the amount and then approve, reject, or mark the request as paid.',
          placement: 'top',
        },
      ],
    },
  },
  finance: {
    pageKey: 'finance',
    label: 'Finance',
    shortTitle: 'How to read finance',
    shortDescription: 'Finance shows an operational overview of revenue, profit, and invoicing.',
    shortSteps: [
      'Watch revenue and waiting invoicing.',
      'Check the operational profit of jobs.',
      'Use the separate Costs section for expenses.',
    ],
    tutorial: {
      id: 'finance-overview',
      pageKey: 'finance',
      title: 'Finance',
      shortDescription: 'Basic orientation in finance.',
      steps: [
        {
          id: 'invoices-nav',
          target: '[data-tour="nav-invoices"]',
          title: 'Invoicing',
          content: 'Invoicing helps you handle sent and waiting documents.',
          placement: 'right',
        },
      ],
    },
  },
  invoices: {
    pageKey: 'invoices',
    label: 'Invoicing',
    shortTitle: 'Invoices and payment status',
    shortDescription: 'Invoicing shows documents, payment status, due dates, and exports.',
    shortSteps: [
      'Create a new invoice at the top.',
      'Use filters to choose month, status, and export.',
      'Open a specific invoice in the table and check number, customer, due date, and amount.',
    ],
    tutorial: {
      id: 'invoices-overview',
      pageKey: 'invoices',
      title: 'Invoicing step by step',
      shortDescription: 'Shows invoice creation, filters, and document list.',
      steps: [
        {
          id: 'invoices-header',
          target: '[data-tour="invoices-header"]',
          title: 'Invoicing',
          content: 'Manage internal invoices, their status, and exports here.',
          placement: 'bottom',
        },
        {
          id: 'new-invoice',
          target: '[data-tour="new-invoice-button"]',
          title: 'New invoice',
          content: 'Create a new document here. Choose customer, items, and due date.',
          placement: 'left',
        },
        {
          id: 'invoice-filters',
          target: '[data-tour="invoices-filters"]',
          title: 'Filters',
          content: 'Narrow invoices by month, status, and export.',
          placement: 'bottom',
        },
        {
          id: 'invoice-list',
          target: '[data-tour="invoices-list"]',
          title: 'Invoice list',
          content: 'Click the invoice number to open the document detail.',
          placement: 'top',
        },
      ],
    },
  },
  calculations: {
    pageKey: 'calculations',
    label: 'Calculations',
    shortTitle: 'Internal price calculation',
    shortDescription: 'Calculations prepare price, costs, and margin before creating a quote.',
    shortSteps: [
      'In the overview, choose month, customer, and sorting.',
      'Click New calculation.',
      'Choose a customer or continue without one.',
      'Add customer-facing items and internal costs.',
      'Save the calculation and continue to a quote.',
    ],
    tutorial: {
      id: 'calculations-flow',
      pageKey: 'calculations',
      title: 'Calculation step by step',
      shortDescription: 'Guides you through overview, customer choice, and the calculation form.',
      steps: [
        {
          id: 'calculations-header',
          target: '[data-tour="calculations-header"]',
          title: 'Calculation overview',
          content: 'Here you see internal calculations for the selected month across customers.',
          placement: 'bottom',
        },
        {
          id: 'calculations-filters',
          target: '[data-tour="calculations-filters"]',
          title: 'Filters',
          content: 'Find calculations by customer, month, and sorting.',
          placement: 'bottom',
        },
        {
          id: 'calculations-list',
          target: '[data-tour="calculations-list"]',
          title: 'Calculation list',
          content: 'Each card opens a calculation detail where you check price, costs, and profit.',
          placement: 'top',
        },
        {
          id: 'new-calculation',
          target: '[data-tour="new-calculation-button"]',
          title: 'New calculation',
          content: 'Start a new calculation here. The guide will move you to customer selection.',
          placement: 'left',
          action: 'click',
          href: '/kalkulace/nova',
        },
        {
          id: 'calculation-customer-choice',
          target: '[data-tour="calculation-customer-choice"]',
          title: 'Customer choice',
          content: 'Connect the calculation to an existing customer, create a new one, or continue without a customer.',
          placement: 'bottom',
        },
        {
          id: 'calculation-without-customer',
          target: '[data-tour="calculation-without-customer"]',
          title: 'Without customer',
          content: 'If you do not know who the quote belongs to yet, start without a customer and add it later.',
          placement: 'left',
          action: 'click',
          href: '/kalkulace/nova/bez-zakaznika',
        },
        {
          id: 'calculation-basic',
          target: '[data-tour="calculation-basic"]',
          title: 'Calculation basics',
          content: 'Enter title, date, status, and a short description.',
          placement: 'bottom',
        },
        {
          id: 'calculation-customer-items',
          target: '[data-tour="calculation-customer-items"]',
          title: 'Items for customer',
          content: 'Add what will be priced for the customer and at what selling price.',
          placement: 'top',
        },
        {
          id: 'calculation-cost-items',
          target: '[data-tour="calculation-cost-items"]',
          title: 'Internal costs',
          content: 'Add work, material, transport, or other costs. This drives the operational margin.',
          placement: 'top',
        },
        {
          id: 'calculation-summary',
          target: '[data-tour="calculation-summary"]',
          title: 'Summary',
          content: 'The summary shows customer price, costs, and expected result.',
          placement: 'top',
        },
        {
          id: 'calculation-save',
          target: '[data-tour="calculation-save"]',
          title: 'Save',
          content: 'After saving, the calculation appears in the overview and can be used to prepare a quote.',
          placement: 'top',
        },
      ],
    },
  },
  quotes: {
    pageKey: 'quotes',
    label: 'Quotes',
    shortTitle: 'Quotes for customers',
    shortDescription: 'Quotes come from calculations and are used to send prices to customers.',
    shortSteps: [
      'Prepare a quote from a calculation.',
      'Use filters to find quotes by month, customer, and status.',
      'In the overview, watch whether a quote is draft, sent, accepted, or expired.',
    ],
    tutorial: {
      id: 'quotes-overview',
      pageKey: 'quotes',
      title: 'Quotes step by step',
      shortDescription: 'Shows the quote overview and connection to calculations.',
      steps: [
        {
          id: 'quotes-header',
          target: '[data-tour="quotes-header"]',
          title: 'Quote overview',
          content: 'Track quotes, their status, and price here.',
          placement: 'bottom',
        },
        {
          id: 'quotes-from-calculation',
          target: '[data-tour="quote-from-calculation-button"]',
          title: 'Create from calculation',
          content: 'A quote usually starts as a calculation. Click to go to calculations.',
          placement: 'left',
        },
        {
          id: 'quotes-filters',
          target: '[data-tour="quotes-filters"]',
          title: 'Quote filters',
          content: 'Choose month, customer, and quote status here.',
          placement: 'bottom',
        },
        {
          id: 'quotes-list',
          target: '[data-tour="quotes-list"]',
          title: 'Quote list',
          content: 'Click to open the quote detail where you can review and send it to the customer.',
          placement: 'top',
        },
      ],
    },
  },
  leads: {
    pageKey: 'leads',
    label: 'Leads',
    shortTitle: 'Website leads',
    shortDescription: 'Leads come from the website add-on and can connect to calculations or customers.',
    shortSteps: [
      'Leads are available after enabling the website package.',
      'After activation, new website requests are saved in Diriqo.',
      'From a lead, you can create a customer, calculation, or job.',
    ],
    tutorial: {
      id: 'leads-overview',
      pageKey: 'leads',
      title: 'Leads',
      shortDescription: 'Basic explanation of website leads.',
      steps: [
        {
          id: 'leads-page',
          target: '[data-tour="leads-addon-panel"]',
          title: 'Website add-on',
          content: 'Here you see the status of website leads. If the add-on is inactive, the page explains what is missing.',
          placement: 'bottom',
        },
        {
          id: 'subscription',
          target: '[data-tour="nav-companySettings"]',
          title: 'Order website package',
          content: 'You can find the website package under Company > Subscription.',
          placement: 'right',
        },
      ],
    },
  },
  costs: {
    pageKey: 'costs',
    label: 'Costs',
    shortTitle: 'How to enter costs',
    shortDescription: 'Costs give a simple operational view of what the company pays.',
    shortSteps: [
      'Choose the month you want to review.',
      'Add a fixed cost such as rent or software.',
      'Add a manual job cost or one-off expense.',
    ],
    tutorial: {
      id: 'costs-overview',
      pageKey: 'costs',
      title: 'Costs',
      shortDescription: 'How to work with fixed and manual costs.',
      steps: [
        {
          id: 'month-filter',
          target: '[data-tour="costs-month-filter"]',
          title: 'Month',
          content: 'Choose the month for which you want to see costs.',
          placement: 'bottom',
        },
        {
          id: 'expense-button',
          target: '[data-tour="add-expense-button"]',
          title: 'Add cost',
          content: 'Enter a one-off or job-related cost here.',
          placement: 'left',
        },
        {
          id: 'fixed-button',
          target: '[data-tour="add-fixed-cost-button"]',
          title: 'Add fixed cost',
          content: 'Recurring costs like rent, energy, or software belong here.',
          placement: 'left',
        },
      ],
    },
  },
  offers: {
    pageKey: 'offers',
    label: 'Offers',
    shortTitle: 'How to use offers',
    shortDescription: 'Offers help prepare a price and send it to a customer.',
    shortSteps: [
      'Create a calculation or offer.',
      'Add items and price.',
      'Send it to the customer and watch the response.',
    ],
    tutorial: {
      id: 'offers-overview',
      pageKey: 'offers',
      title: 'Offers',
      shortDescription: 'Basic work with offers.',
      steps: [
        {
          id: 'quotes-nav',
          target: '[data-tour="nav-quotes"]',
          title: 'Offers',
          content: 'Find quotes and their status here.',
          placement: 'right',
        },
      ],
    },
  },
  settings: {
    pageKey: 'settings',
    label: 'Settings',
    shortTitle: 'How to manage settings',
    shortDescription: 'In settings you can edit company, language, menu, and team members.',
    shortSteps: [
      'Check company details.',
      'Edit language and menu.',
      'Manage team members as needed.',
    ],
    tutorial: {
      id: 'settings-overview',
      pageKey: 'settings',
      title: 'Settings',
      shortDescription: 'Where to edit company and team.',
      steps: [
        {
          id: 'settings-nav',
          target: '[data-tour="nav-companySettings"]',
          title: 'Company settings',
          content: 'Edit basic company details here.',
          placement: 'right',
        },
      ],
    },
  },
}

const helpUiTextByLocale: Record<'cs' | 'en', HelpUiText> = {
  cs: {
    help: 'Nápověda',
    openHelp: 'Otevřít nápovědu',
    openRunningHelp: 'Otevřít nápovědu k běžícímu průvodci',
    runningGuide: 'Průvodce běží',
    step: 'Krok',
    of: 'z',
    helpTitle: 'Nápověda',
    closeHelp: 'Zavřít nápovědu',
    shortGuide: 'Krátký návod',
    startGuide: 'Provést krok za krokem',
    openFullHelp: 'Otevřít plnou nápovědu',
    close: 'Zavřít',
    continue: 'Pokračovat',
    done: 'Dokončit',
    goToForm: 'Přejít na formulář',
    goToNextPage: 'Přejít na další stránku',
    goToPage: 'Přejít na stránku',
    endTutorial: 'Ukončit tutorial',
    back: 'Zpět',
    skipStep: 'Přeskočit krok',
    missingTarget: 'Tento prvek na aktuální obrazovce není vidět. Můžeš pokračovat dalším krokem.',
  },
  en: {
    help: 'Help',
    openHelp: 'Open help',
    openRunningHelp: 'Open help for the running guide',
    runningGuide: 'Guide running',
    step: 'Step',
    of: 'of',
    helpTitle: 'Help',
    closeHelp: 'Close help',
    shortGuide: 'Quick guide',
    startGuide: 'Guide me step by step',
    openFullHelp: 'Open full help',
    close: 'Close',
    continue: 'Continue',
    done: 'Done',
    goToForm: 'Go to form',
    goToNextPage: 'Go to next page',
    goToPage: 'Go to page',
    endTutorial: 'End tutorial',
    back: 'Back',
    skipStep: 'Skip step',
    missingTarget: 'This element is not visible on the current screen. You can continue to the next step.',
  },
}

function getHelpContentLocale(locale: Locale | null | undefined): 'cs' | 'en' {
  return locale === 'cs' ? 'cs' : 'en'
}

export const helpTopics = [
  'První kroky',
  'Zakázky',
  'Zákazníci',
  'Pracovníci',
  'Kalendář',
  'Nepřítomnosti',
  'Zálohy',
  'Náklady',
  'Kalkulace',
  'Finance',
  'Fakturace',
  'Cenové nabídky',
  'Poptávky',
  'Nastavení',
] as const

export const allTutorialDefinitions = [
  onboardingIntroTutorials.quick,
  onboardingIntroTutorials.detailed,
  ...Object.values(pageHelpDefinitions).map((definition) => definition.tutorial),
]

export function getHelpUiText(locale?: Locale | null) {
  return helpUiTextByLocale[getHelpContentLocale(locale)]
}

export function getOnboardingIntroTutorial(mode: 'quick' | 'detailed', locale?: Locale | null) {
  return getHelpContentLocale(locale) === 'cs'
    ? onboardingIntroTutorials[mode]
    : englishOnboardingIntroTutorials[mode]
}

export function getPageHelpDefinitions(locale?: Locale | null) {
  return getHelpContentLocale(locale) === 'cs' ? pageHelpDefinitions : englishPageHelpDefinitions
}

export function getPageHelpDefinition(pageKey: HelpPageKey, locale?: Locale | null) {
  const definitions = getPageHelpDefinitions(locale)
  return definitions[pageKey] ?? definitions.dashboard
}

export function getAllTutorialDefinitions(locale?: Locale | null) {
  const definitions = getPageHelpDefinitions(locale)
  const introTutorials = getHelpContentLocale(locale) === 'cs' ? onboardingIntroTutorials : englishOnboardingIntroTutorials

  return [
    introTutorials.quick,
    introTutorials.detailed,
    ...Object.values(definitions).map((definition) => definition.tutorial),
  ]
}

export function getTutorialById(tutorialId: string | null | undefined, locale?: Locale | null) {
  if (!tutorialId) return null
  return getAllTutorialDefinitions(locale).find((tutorial) => tutorial.id === tutorialId) ?? null
}
