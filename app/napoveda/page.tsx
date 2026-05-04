import { readFile } from 'fs/promises'
import path from 'path'
import Link from 'next/link'
import type { ReactNode } from 'react'

import DashboardShell from '@/components/DashboardShell'
import { getRequestLocale } from '@/lib/i18n/server'

type HelpBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'subheading'; text: string }

type HelpSection = {
  id: string
  title: string
  blocks: HelpBlock[]
}

const quickStart = [
  {
    title: 'Zákazník',
    text: 'Založ zákazníka a doplň kontakt i fakturační údaje.',
    href: '/customers/new',
    action: 'Přidat zákazníka',
  },
  {
    title: 'Kalkulace',
    text: 'Spočítej cenu, náklady a marži před odesláním nabídky.',
    href: '/kalkulace/nova',
    action: 'Nová kalkulace',
  },
  {
    title: 'Zakázka',
    text: 'Po schválení vytvoř zakázku, termín a pracovníky.',
    href: '/jobs/new',
    action: 'Nová zakázka',
  },
  {
    title: 'Fakturace',
    text: 'Hotovou práci zkontroluj a připrav k fakturaci.',
    href: '/invoices',
    action: 'Otevřít faktury',
  },
]

const helpGroups = [
  {
    id: 'orientace',
    title: 'Orientace',
    match: ['menu', 'postup', 'prehled', 'přehled', 'scenare', 'scénáře', 'kratke rady', 'nejkratsi'],
  },
  {
    id: 'zakaznici',
    title: 'Zákazníci',
    match: ['zakaznika', 'zákazníka', 'zakaznik', 'zákazník', 'kontaktni', 'kontaktní'],
  },
  {
    id: 'obchod',
    title: 'Poptávky a nabídky',
    match: ['poptavky', 'poptávky', 'nabidky', 'nabídky', 'nabidku', 'nabídku'],
  },
  {
    id: 'kalkulace',
    title: 'Kalkulace',
    match: ['kalkulace', 'kalkulaci'],
  },
  {
    id: 'zakazky',
    title: 'Zakázky',
    match: ['zakazky', 'zakázky', 'zakazky', 'smeny', 'směny', 'ekonomika', 'fotodokumentace', 'komunikace'],
  },
  {
    id: 'tym',
    title: 'Tým',
    match: ['pracovnici', 'pracovníci', 'pracovnika', 'nepritomnosti', 'nepřitomnosti', 'zalohy', 'zálohy', 'kalendar', 'kalendář'],
  },
  {
    id: 'finance',
    title: 'Fakturace',
    match: ['fakturace', 'faktury', 'pohody', 'pohoda', 'ucet', 'účet', 'fakturacni', 'fakturační'],
  },
  {
    id: 'portal',
    title: 'Portál a jazyky',
    match: ['portal', 'portál', 'jazyky'],
  },
]

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function cleanTitle(title: string) {
  return title.replace(/^\d+\.\s*/, '').trim()
}

function shortTitle(title: string) {
  const cleaned = cleanTitle(title)
  const replacements: Record<string, string> = {
    'Verze kalkulaci a prevod na nabidku': 'Kalkulace a nabídky',
    'Portalove nabidky, poptavky a faktury': 'Nabídky a faktury',
    'Pracovni dny, smeny a pracovnici u zakazky': 'Směny u zakázky',
    'Muj ucet a fakturacni udaje firmy': 'Můj účet',
    'Prehled a kontrola provozu': 'Přehled provozu',
    'Doporučeny bezny postup': 'Běžný postup',
    'Nejčastejsi scenare': 'Časté scénáře',
    'Nejkratši verze v jedne vete': 'Shrnutí',
  }

  return replacements[cleaned] ?? cleaned
}

function pushParagraph(lines: string[], blocks: HelpBlock[]) {
  if (lines.length === 0) return
  blocks.push({ type: 'paragraph', text: lines.join(' ') })
  lines.length = 0
}

function pushList(listType: HelpBlock['type'] | null, items: string[], blocks: HelpBlock[]) {
  if (!listType || items.length === 0) return
  blocks.push({ type: listType as 'ordered-list' | 'unordered-list', items: [...items] })
  items.length = 0
}

function parseManual(content: string) {
  const lines = content.split(/\r?\n/)
  const sections: HelpSection[] = []
  let currentSection: HelpSection | null = null
  let paragraphLines: string[] = []
  let listType: 'ordered-list' | 'unordered-list' | null = null
  let listItems: string[] = []

  function flushSectionState() {
    if (!currentSection) return
    pushParagraph(paragraphLines, currentSection.blocks)
    pushList(listType, listItems, currentSection.blocks)
    listType = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (!trimmed) {
      if (currentSection) {
        pushParagraph(paragraphLines, currentSection.blocks)
        pushList(listType, listItems, currentSection.blocks)
        listType = null
      }
      continue
    }

    if (trimmed.startsWith('# ')) continue

    const sectionMatch = trimmed.match(/^##\s+(.*)$/)
    if (sectionMatch) {
      flushSectionState()
      currentSection = {
        id: slugify(cleanTitle(sectionMatch[1])),
        title: sectionMatch[1],
        blocks: [],
      }
      sections.push(currentSection)
      continue
    }

    const subheadingMatch = trimmed.match(/^###\s+(.*)$/)
    if (subheadingMatch && currentSection) {
      pushParagraph(paragraphLines, currentSection.blocks)
      pushList(listType, listItems, currentSection.blocks)
      listType = null
      currentSection.blocks.push({ type: 'subheading', text: subheadingMatch[1] })
      continue
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/)
    if (orderedMatch && currentSection) {
      pushParagraph(paragraphLines, currentSection.blocks)
      if (listType !== 'ordered-list') {
        pushList(listType, listItems, currentSection.blocks)
        listType = 'ordered-list'
      }
      listItems.push(orderedMatch[1].trim())
      continue
    }

    const unorderedMatch = line.match(/^\s*-\s+(.*)$/)
    if (unorderedMatch && currentSection) {
      pushParagraph(paragraphLines, currentSection.blocks)
      if (listType !== 'unordered-list') {
        pushList(listType, listItems, currentSection.blocks)
        listType = 'unordered-list'
      }
      listItems.push(unorderedMatch[1].trim())
      continue
    }

    if (/^\s{2,}\S/.test(line) && currentSection && listItems.length > 0) {
      listItems[listItems.length - 1] += ` ${trimmed}`
      continue
    }

    if (currentSection) {
      pushList(listType, listItems, currentSection.blocks)
      listType = null
      paragraphLines.push(trimmed)
    }
  }

  flushSectionState()
  return sections
}

async function readManualForLocale(locale: 'cs' | 'en' | 'de') {
  if (locale === 'en') return readFile(path.join(process.cwd(), 'NAVOD-JEDNATELKA.en.md'), 'utf8')
  if (locale === 'de') return readFile(path.join(process.cwd(), 'NAVOD-JEDNATELKA.de.md'), 'utf8')
  return readFile(path.join(process.cwd(), 'NAVOD-JEDNATELKA.md'), 'utf8')
}

function stripInlineCode(value: string) {
  return value.replace(/`([^`]+)`/g, '$1')
}

function splitSentences(value: string) {
  return stripInlineCode(value)
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function getLead(section: HelpSection) {
  const paragraph = section.blocks.find((block) => block.type === 'paragraph')
  if (paragraph?.type === 'paragraph') return splitSentences(paragraph.text)[0] ?? paragraph.text
  const list = section.blocks.find((block) => block.type === 'ordered-list' || block.type === 'unordered-list')
  if (list && 'items' in list) return stripInlineCode(list.items[0] ?? '')
  return 'Krátký praktický postup pro tuto část systému.'
}

function getSectionSteps(section: HelpSection) {
  const steps: Array<{ label?: string; items: string[] }> = []
  let currentLabel: string | undefined

  for (const block of section.blocks) {
    if (block.type === 'subheading') {
      currentLabel = block.text
      continue
    }

    if (block.type === 'ordered-list' || block.type === 'unordered-list') {
      for (let i = 0; i < block.items.length; i += 5) {
        steps.push({
          label: currentLabel,
          items: block.items.slice(i, i + 5).map(stripInlineCode),
        })
      }
    }
  }

  if (steps.length > 0) return steps

  const bullets = section.blocks
    .filter((block): block is Extract<HelpBlock, { type: 'paragraph' }> => block.type === 'paragraph')
    .flatMap((block) => splitSentences(block.text))
    .slice(0, 5)

  return [{ items: bullets }]
}

function getTip(section: HelpSection) {
  const text = section.blocks
    .flatMap((block) => {
      if (block.type === 'paragraph' || block.type === 'subheading') return [block.text]
      return block.items
    })
    .find((item) => /pozor|tip|doporu|pravideln|nejlepsi|prakticky/i.test(item))

  return text ? stripInlineCode(text).replace(/^Pozor:\s*/i, '') : null
}

function getProblem(section: HelpSection) {
  const text = section.blocks
    .flatMap((block) => {
      if (block.type === 'paragraph' || block.type === 'subheading') return [block.text]
      return block.items
    })
    .find((item) => /nejde|bez |chyb|nevid|zkontroluj|splatnosti/i.test(item))

  return text ? stripInlineCode(text).replace(/^Pozor:\s*/i, '') : null
}

function getSectionGroup(section: HelpSection) {
  const normalized = cleanTitle(section.title)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  return (
    helpGroups.find((group) => group.match.some((keyword) => normalized.includes(keyword))) ??
    helpGroups[0]
  )
}

function groupSections(sections: HelpSection[]) {
  return helpGroups
    .map((group) => ({
      ...group,
      sections: sections.filter((section) => getSectionGroup(section).id === group.id),
    }))
    .filter((group) => group.sections.length > 0)
}

function Card({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <section
      style={{
        borderRadius: '28px',
        border: '1px solid rgba(148, 163, 184, 0.22)',
        background: 'rgba(255,255,255,0.9)',
        padding: '26px',
        boxShadow: '0 18px 44px rgba(15, 23, 42, 0.06)',
        ...style,
      }}
    >
      {children}
    </section>
  )
}

function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '999px',
        background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
        color: '#ffffff',
        padding: '12px 16px',
        textDecoration: 'none',
        fontWeight: 850,
        boxShadow: '0 16px 30px rgba(37, 99, 235, 0.22)',
      }}
    >
      {children}
    </Link>
  )
}

function SecondaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '999px',
        border: '1px solid rgba(148, 163, 184, 0.28)',
        background: 'rgba(255,255,255,0.78)',
        color: '#0f172a',
        padding: '11px 15px',
        textDecoration: 'none',
        fontWeight: 820,
      }}
    >
      {children}
    </Link>
  )
}

function ManualSectionCard({ section }: { section: HelpSection }) {
  const steps = getSectionSteps(section)
  const tip = getTip(section)
  const problem = getProblem(section)

  return (
    <article
      id={section.id}
      style={{
        scrollMarginTop: '110px',
        borderRadius: '24px',
        border: '1px solid rgba(148, 163, 184, 0.22)',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.9))',
        padding: '22px',
        display: 'grid',
        gap: '14px',
      }}
    >
      <div>
        <h3 style={{ margin: '0 0 8px', color: '#0f172a', fontSize: '24px', lineHeight: 1.2 }}>
          {shortTitle(section.title)}
        </h3>
        <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>{getLead(section)}</p>
      </div>

      <div style={{ display: 'grid', gap: '12px' }}>
        {steps.map((chunk, index) => (
          <div
            key={`${section.id}-${index}`}
            style={{
              borderRadius: '18px',
              border: '1px solid rgba(203, 213, 225, 0.72)',
              background: 'rgba(248,250,252,0.72)',
              padding: '14px 16px',
            }}
          >
            {chunk.label ? (
              <div style={{ marginBottom: '8px', color: '#2563eb', fontSize: '13px', fontWeight: 900 }}>
                {chunk.label}
              </div>
            ) : null}
            <ul style={{ margin: 0, padding: 0, display: 'grid', gap: '8px', listStyle: 'none' }}>
              {chunk.items.map((item) => (
                <li
                  key={item}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '18px minmax(0, 1fr)',
                    gap: '9px',
                    color: '#334155',
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ color: '#16a34a', fontWeight: 900 }}>✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {tip ? (
        <div
          style={{
            borderRadius: '16px',
            background: 'rgba(37, 99, 235, 0.08)',
            border: '1px solid rgba(37, 99, 235, 0.16)',
            color: '#1e3a8a',
            padding: '12px 14px',
            lineHeight: 1.5,
          }}
        >
          <strong>Tip:</strong> {tip}
        </div>
      ) : null}

      {problem && problem !== tip ? (
        <div
          style={{
            borderRadius: '16px',
            background: 'rgba(249, 115, 22, 0.08)',
            border: '1px solid rgba(249, 115, 22, 0.18)',
            color: '#9a3412',
            padding: '12px 14px',
            lineHeight: 1.5,
          }}
        >
          <strong>Častý problém:</strong> {problem}
        </div>
      ) : null}
    </article>
  )
}

export default async function HelpPage() {
  const locale = await getRequestLocale()
  const manualContent = await readManualForLocale(locale)
  const sections = parseManual(manualContent)
  const groups = groupSections(sections)

  return (
    <DashboardShell activeItem="help">
      <main style={{ display: 'grid', gap: '22px', color: '#0f172a' }}>
        <section
          style={{
            borderRadius: '30px',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            background:
              'radial-gradient(circle at 8% 8%, rgba(124, 58, 237, 0.16), transparent 30%), radial-gradient(circle at 100% 0%, rgba(6, 182, 212, 0.16), transparent 28%), linear-gradient(135deg, rgba(255,255,255,0.96), rgba(239,246,255,0.9) 55%, rgba(240,253,250,0.88))',
            padding: '34px',
            boxShadow: '0 24px 60px rgba(15, 23, 42, 0.1)',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              borderRadius: '999px',
              padding: '7px 11px',
              marginBottom: '14px',
              background: 'rgba(37, 99, 235, 0.1)',
              border: '1px solid rgba(37, 99, 235, 0.18)',
              color: '#1d4ed8',
              fontSize: '12px',
              fontWeight: 850,
            }}
          >
            Praktický manuál
          </div>
          <h1 style={{ margin: '0 0 10px', fontSize: '46px', lineHeight: 1.05 }}>Nápověda</h1>
          <p style={{ margin: 0, maxWidth: '620px', color: '#475569', fontSize: '18px', lineHeight: 1.55 }}>
            Celý manuál Diriqo, zkrácený do jasných kroků a rychlých checklistů.
          </p>
        </section>

        <Card>
          <h2 style={{ margin: '0 0 16px', fontSize: '28px' }}>Začněte ve 4 krocích</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px' }}>
            {quickStart.map((item, index) => (
              <article
                key={item.title}
                style={{
                  display: 'grid',
                  gap: '12px',
                  alignContent: 'space-between',
                  minHeight: '184px',
                  borderRadius: '22px',
                  border: '1px solid rgba(148, 163, 184, 0.22)',
                  background: 'linear-gradient(135deg, rgba(248,250,252,0.98), rgba(239,246,255,0.76))',
                  padding: '18px',
                }}
              >
                <div>
                  <div style={{ color: '#2563eb', fontSize: '13px', fontWeight: 900 }}>Krok {index + 1}</div>
                  <h3 style={{ margin: '8px 0 8px', fontSize: '22px' }}>{item.title}</h3>
                  <p style={{ margin: 0, color: '#64748b', lineHeight: 1.55 }}>{item.text}</p>
                </div>
                <SecondaryButton href={item.href}>{item.action}</SecondaryButton>
              </article>
            ))}
          </div>
        </Card>

        <Card>
          <h2 style={{ margin: '0 0 14px', fontSize: '26px' }}>Obsah nápovědy</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
            {groups.map((group) => (
              <a
                key={group.id}
                href={`#${group.id}`}
                style={{
                  borderRadius: '18px',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  background: 'rgba(248,250,252,0.76)',
                  padding: '15px',
                  color: 'inherit',
                  textDecoration: 'none',
                }}
              >
                <strong style={{ display: 'block', fontSize: '17px', marginBottom: '5px' }}>{group.title}</strong>
                <span style={{ color: '#64748b' }}>{group.sections.length} krátkých bloků</span>
              </a>
            ))}
          </div>
        </Card>

        {groups.map((group) => (
          <Card key={group.id} style={{ display: 'grid', gap: '14px' }}>
            <div id={group.id} style={{ scrollMarginTop: '110px' }}>
              <h2 style={{ margin: 0, fontSize: '30px' }}>{group.title}</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
              {group.sections.map((section) => (
                <ManualSectionCard key={section.id} section={section} />
              ))}
            </div>
          </Card>
        ))}

        <section
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '18px',
            flexWrap: 'wrap',
            alignItems: 'center',
            borderRadius: '28px',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            background:
              'linear-gradient(135deg, rgba(15,23,42,0.96), rgba(30,41,59,0.94) 48%, rgba(14,116,144,0.9))',
            padding: '26px',
            boxShadow: '0 22px 54px rgba(15, 23, 42, 0.14)',
            color: '#ffffff',
          }}
        >
          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: '26px' }}>Když si nevíš rady</h2>
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.78)', fontSize: '17px', lineHeight: 1.55 }}>
              Začni na Přehledu. Ten ti ukáže, co je dnes důležité.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <PrimaryButton href="/">Přehled</PrimaryButton>
            <SecondaryButton href="/jobs">Zakázky</SecondaryButton>
          </div>
        </section>
      </main>
    </DashboardShell>
  )
}
