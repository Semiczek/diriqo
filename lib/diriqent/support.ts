export type SupportRole = 'super_admin' | 'company_admin' | 'manager' | 'worker'

export type SupportAnswer = {
  kind: 'guide' | 'choose' | 'needs_data' | 'unavailable'
  title: string
  answer: string
  links: { label: string; href: string }[]
  chargedUnits: 0
  suggestions: string[]
}

const roles: readonly SupportRole[] = ['super_admin', 'company_admin', 'manager', 'worker']
const maxPromptLength = 4000

function isRole(value: unknown): value is SupportRole {
  return typeof value === 'string' && roles.includes(value as SupportRole)
}

function isOwner(role: SupportRole) {
  return role === 'super_admin' || role === 'company_admin'
}

/** The caller must resolve the role on the server from the active company membership. */
export function supportSuggestions(role: unknown): string[] {
  if (!isRole(role)) return []
  if (role === 'worker') return ['Kde najdu svoji práci?', 'Jak spustím směnu?', 'Jak ukončím směnu?', 'Co umí podpora?']
  if (role === 'manager') return ['Kde najdu přehled týmu?', 'Kde najdu termíny zakázek?', 'Jak otevřu dokument v Office?', 'Co umí podpora?']
  return ['Jak vytvořím zakázku?', 'Jak přidám zákazníka?', 'Jak vytvořit fakturu?', 'Jak otevřu dokument v Office?']
}

function result(role: SupportRole, kind: SupportAnswer['kind'], title: string, answer: string, links: SupportAnswer['links'] = []): SupportAnswer {
  return { kind, title, answer, links, chargedUnits: 0, suggestions: supportSuggestions(role) }
}

function unavailable(role: SupportRole): SupportAnswer {
  return result(role, 'unavailable', 'Tato oblast není pro vaši roli dostupná',
    'V této roli podpora nezpřístupňuje finanční údaje firmy, správu přístupů ani jiné oblasti vyhrazené správci firmy. Ověření přístupu vychází z členství v aktivní firmě; změna zadání ho nerozšíří. Nic se neúčtuje.')
}

function needsData(role: SupportRole): SupportAnswer {
  return result(role, 'needs_data', 'Tento požadavek přesahuje základní podporu',
    'Podpora nabízí pouze připravené návody. Nečte firemní záznamy, nepočítá výsledky z vašich dat a neprovádí změny. Tento požadavek může vyžadovat práci s daty nebo složitější úkol. Nic se neúčtuje a placená služba se automaticky nespustí. Pro návod zkuste otázku začínající „Jak“ nebo „Kde“; další práce musí zvlášť ověřit vaše oprávnění.')
}

function personalWork(role: SupportRole): SupportAnswer {
  return result(role, 'guide', 'Vlastní práce a docházka',
    'Otevřete Moje práce. U přiřazené zakázky můžete spustit směnu a po práci ji ukončit. Rozpracované směny najdete také v samostatném přehledu. Pokud vám přiřazení chybí, požádejte vedoucího o kontrolu. Tento návod nenačetl vaše směny ani jejich stav.',
    [{ label: 'Moje práce', href: '/mobile/my' }, { label: 'Rozpracované směny', href: '/mobile/my/finish' }])
}

function managerOverview(role: SupportRole): SupportAnswer {
  return result(role, 'guide', 'Provoz a termíny týmu',
    'V přehledu Diriqo Manager najdete dostupné zakázky, jejich termíny, členy týmu a běžící směny aktivní firmy. Slouží k provoznímu přehledu. V této verzi vytváření zakázek a kalendářních událostí zajišťuje správce firmy. Tento návod nenačetl žádné konkrétní údaje.',
    [{ label: 'Přehled provozu', href: '/mobile/manager' }])
}

function normalize(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/\p{Cf}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * A deterministic guide catalogue, not an intent classifier or an authorization boundary.
 * No prompts are sent to a model; no company data is read or written. All links are fixed.
 * Unknown questions get a choice instead of an invented answer or paid fallback.
 */
export function answerSupport(prompt: unknown, role: unknown): SupportAnswer {
  if (!isRole(role)) {
    return { kind: 'unavailable', title: 'Oprávnění se nepodařilo ověřit', answer: 'Podporu lze otevřít až po ověření členství v aktivní firmě. Nic se neúčtuje.', links: [], chargedUnits: 0, suggestions: [] }
  }
  if (typeof prompt !== 'string' || prompt.length > maxPromptLength || !prompt.trim()) {
    return result(role, 'choose', 'Napište krátkou otázku', 'Vyberte některý z návodů nebo napište otázku do 4 000 znaků. Podpora nic neúčtuje.')
  }

  const text = normalize(prompt)
  // Public explanation of this mode has no account balance or changing price list.
  const supportTopic = /\b(podpor\w*|napoved\w*|diriqent\w*)\b/.test(text)
  const supportQuestion = /^(?:(?:prosim|ahoj)[, ]+)?(?:co umi|kdo je|jak funguje|kolik stoji|je zdarma|je placena|cena|cenik)\b/.test(text)
  const aboutAssistant = /^(?:(?:prosim|ahoj)[, ]+)?(?:kdo jsi|co umis|co dokazes|s cim (?:mi )?(?:pomuzes|muzes pomoci)|jake mas funkce)[.!? ]*$/.test(text)
  const finance = /\b(financ\w*|faktur\w*|trzb\w*|zisk\w*|marz\w*|naklad\w*|mzd\w*|vyplat\w*|platy|platu|zustatk\w*|zustatek|bankovn\w*|predplat\w*|kredit\w*|tarif\w*|billing|invoice\w*|payroll|profit\w*|margin\w*|revenue|salary|wages|balance|costs?)\b/.test(text)
  const settings = /\b(nastaven\w*|opravnen\w*|uzivatel\w*|pristup\w*|role|roli|settings|permission\w*)\b/.test(text)
    || /\b(prid\w*|pozv\w*|zaloz\w*|smaz\w*|odebr\w*)\b.*\b(pracovnik\w*|zamestnan\w*|clen\w*)\b/.test(text)
  const customers = /\b(zakaznik\w*|zakaznici|kontakt\w*|customer\w*)\b/.test(text)
  const office = /\b(office|dokument\w*|tabulk\w*|editor\w*|soubor\w*)\b/.test(text)
  const calendar = /\b(kalendar\w*|termin\w*|planovan\w*|naplan\w*|udalost\w*)\b/.test(text)
  const work = /\b(smen\w*|dochaz\w*|moje prace|svoji praci|vlastni praci|odpracovan\w*)\b/.test(text)
  const jobs = /\b(zakazk\w*|zakazce|job\w*)\b/.test(text)
  const team = /\b(tym\w*|pracovnik\w*|zamestnan\w*)\b/.test(text)

  if (!isOwner(role) && (finance || settings || customers || (role === 'worker' && (office || team)))) return unavailable(role)

  // Recognize only a closed vocabulary of plain arithmetic, never calculate with eval
  // or reinterpret amounts from records. Unsupported arithmetic remains free support.
  const arithmetic = text
    .replace(/^(?:prosim[, ]+)?(?:(?:spocitej|vypocitej)(?: mi)?|kolik (?:je|dela))\s+/, '')
    .replace(/\b(plus|minus|krat|deleno|procent|procenta|procento|z|ze)\b/g, '+')
    .replace(/[?!.]+$/, '')
    .trim()
  if (/\d/.test(arithmetic) && /^[\d\s.,()+\-*/×÷%^]+$/.test(arithmetic)) {
    return result(role, 'choose', 'Jednoduchý výpočet bez kreditu',
      'Tento režim zatím matematické výpočty neprovádí. Výsledek jsem nevypočítal. Nic se neúčtuje a placená služba se automaticky nespustí. Pro samotný výpočet použijte kalkulačku.')
  }

  // Commands still need explicit data tooling, even when attached to a how-to question.
  const commandText = text.replace(/\b(ukaz|najdi) (mi )?(navod|napovedu|postup)\b/g, '')
  const command = /\b(vytvor|priprav|uprav|najdi|ukaz|porovnej|analyzuj|spocitej|vypocitej|smaz|zmen|odesli|posli|nastav|naplanuj|zaloz|zjisti|zkontroluj|uloz|vystav|proved|exportuj|importuj)\b/.test(commandText)
    || /\b(chci|potrebuji|potrebuju)\b.*\b(vytvorit|pripravit|upravit|spocitat|poslat|zmenit|ulozit|smazat)\b/.test(text)
  const specificDataQuestion = /\b(analyz\w*|statistik\w*|souhrn\w*|porovnan\w*|po splatnosti|tento mesic|minuly mesic|za mesic|dnes|zitra|mame|nasich|naseho|nasi firmy)\b/.test(text)
  const dataTopic = finance || settings || customers || office || calendar || work || jobs || team || /\b(lidi|hodin\w*)\b/.test(text)
  const dataQuestion = (/\b(kolik|ktere|kteri|jake|jaky|jaka|kdo)\b/.test(text) && dataTopic) || specificDataQuestion
  if (command) return needsData(role)
  if ((aboutAssistant || (supportTopic && supportQuestion)) && !finance && !settings && !customers && !office && !jobs && !specificDataQuestion) {
    return result(role, 'guide', 'Podpora bez poplatku',
      'Základní podpora vysvětluje ovládání Diriqa a nabízí odkazy podle vaší role. Používá připravené návody, nic neúčtuje a nemá přístup k firemním záznamům. Analytika a složitější úkoly jsou oddělené. Podpora je sama nespustí ani nezmění oprávnění zaměstnance.')
  }
  const generalFeatureQuestion = /\b(jake|jaky|jaka|ktere|ktery|ktera)\b/.test(text)
    && /\b(funkce|format\w*|moznost\w*|typ\w* soubor\w*)\b/.test(text)
    && /\b(podpor\w*|umi|umis|ma|mas|nabizi|existuj\w*|dostupn\w*)\b/.test(text)
  if (generalFeatureQuestion && !specificDataQuestion && !finance && !settings && !customers && !jobs) {
    return result(role, 'choose', 'Otázka k funkcím aplikace',
      'Tohle je otázka k ovládání nebo možnostem aplikace a patří do podpory bez kreditu. Pro tuto konkrétní funkci nebo formát zatím nemám ověřený návod. Vyberte některou z nabízených otázek nebo otevřete příslušnou část Diriqa. Nic se neúčtuje a placená služba se automaticky nespustí.')
  }
  if (dataQuestion) return needsData(role)

  const guideQuestion = /\b(jak|kde|navod\w*|postup\w*|napoved\w*|pomoc)\b/.test(text)
  // A bare topic is also a useful catalogue query; prose without a how-to stays ambiguous.
  const shortTopic = text.split(' ').length <= 3
  if (!guideQuestion && !shortTopic) {
    return result(role, 'choose', 'Vyberte oblast podpory', 'Pro tuto otázku nemám jednoznačný připravený návod. Upřesněte, jakou část Diriqa potřebujete vysvětlit. Nic se neúčtuje.')
  }

  if (settings) {
    return result(role, 'guide', 'Nastavení firmy a přístupů',
      'Otevřete Nastavení firmy a zkontrolujte aktivní firmu. Změny firemních údajů a přístupů provádí správce. Nového pracovníka založíte v části Pracovníci; před pozváním ověřte jeho údaje a požadovanou roli. Tento návod žádné nastavení nemění.',
      [{ label: 'Nastavení firmy', href: '/settings/company' }, { label: 'Nový pracovník', href: '/workers/new' }])
  }
  if (/\b(faktur\w*|invoice\w*)\b/.test(text)) {
    return result(role, 'guide', 'Faktury a jejich vazby',
      'V části Faktury otevřete existující doklad nebo formulář nové faktury. U nové faktury vyberte správného zákazníka a případné související zakázky. Před uložením zkontrolujte položky, částky a splatnost. Dostupnost vystavení závisí také na aktivním modulu. Tento návod nic nevystavuje ani neodesílá.',
      [{ label: 'Faktury', href: '/invoices' }, { label: 'Nová faktura', href: '/invoices/new' }])
  }
  if (finance) {
    return result(role, 'choose', 'Upřesněte finanční návod',
      'Pro tuto finanční oblast zatím nemám připravený konkrétní návod. Mohu vysvětlit vytvoření faktury. Výpočet firemních výsledků vyžaduje samostatnou práci s oprávněnými daty. Nic se neúčtuje.',
      [{ label: 'Faktury', href: '/invoices' }])
  }
  if (office) {
    return result(role, 'guide', 'Dokumenty a tabulky v Office',
      'Otevřete Diriqo Office a ověřte aktivní firmu. Vyberte dostupný dokument nebo tabulku, případně vytvořte nový soubor. Před opuštěním editoru zkontrolujte uložení. Přístup závisí na vaší roli a na tom, zda má firma Office zapnutý. Tento návod nečte ani neupravuje obsah dokumentů.',
      [{ label: 'Diriqo Office', href: '/office' }])
  }
  if (customers) {
    return result(role, 'guide', 'Zákazníci a kontakty',
      'V přehledu Zákazníci nejprve ověřte, zda už zákazník existuje. Nového založte přes formulář Nový zákazník. V jeho detailu pak najdete související kontakty a dostupné doklady. Při další práci vybírejte existujícího zákazníka, aby vazby zůstaly zachované.',
      [{ label: 'Zákazníci', href: '/customers' }, { label: 'Nový zákazník', href: '/customers/new' }])
  }
  if (role === 'worker' && (work || jobs || calendar)) return personalWork(role)
  if (role === 'manager' && (jobs || calendar || team)) return managerOverview(role)
  if (work) return personalWork(role)
  if (calendar) {
    return result(role, 'guide', 'Kalendář a plánování',
      'V kalendáři vyberte období a přehled zakázek nebo událostí. Novou událost založte přes formulář, zadejte název, začátek a konec; podle potřeby propojte zakázku a pracovníky. Před uložením zkontrolujte termíny. Tento návod neověřil obsazenost týmu.',
      [{ label: 'Kalendář', href: '/calendar' }, { label: 'Nová událost', href: '/calendar/new' }])
  }
  if (jobs) {
    return result(role, 'guide', 'Zakázky',
      'V přehledu Zakázky vyberte existující záznam nebo otevřete Novou zakázku. Vyplňte název, vyberte správného zákazníka a zkontrolujte adresu i termíny. Před uložením ověřte přiřazení pracovníků a návaznosti. Tento návod žádnou zakázku nezakládá.',
      [{ label: 'Zakázky', href: '/jobs' }, { label: 'Nová zakázka', href: '/jobs/new' }])
  }
  if (team) {
    return result(role, 'guide', 'Pracovníci',
      'V přehledu Pracovníci otevřete existujícího pracovníka nebo založte nového. Ověřte jeho údaje před pozváním do firmy. Správa pracovníků může obsahovat odměny a je vyhrazená správci firmy.',
      [{ label: 'Pracovníci', href: '/workers' }, { label: 'Nový pracovník', href: '/workers/new' }])
  }

  return result(role, 'choose', 'S čím potřebujete poradit?', 'Vyberte připravený návod nebo napište, jakou část Diriqa potřebujete vysvětlit. Podpora nečte firemní data a nic neúčtuje.')
}
