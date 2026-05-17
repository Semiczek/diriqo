'use client'

import { useMemo, useState } from 'react'

import type { Locale } from '@/lib/i18n/config'
import type { TranslationDictionary } from '@/lib/i18n/dictionaries/types'

export type HelpBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'subheading'; text: string }

export type HelpSection = {
  id: string
  title: string
  blocks: HelpBlock[]
}

type HelpCenterClientProps = {
  locale: Locale
  dictionary: TranslationDictionary
  intro: string[]
  sections: HelpSection[]
  supportEmail: string
}

const uiText: Record<
  Locale,
  {
    searchPlaceholder: string
    noResults: string
    expandAll: string
    collapseAll: string
    contents: string
    sections: string
    results: string
    categories: Array<{ key: string; label: string; from: number; to: number }>
  }
> = {
  cs: {
    searchPlaceholder: 'Hledat v nápovědě...',
    noResults: 'Nic jsem nenašel. Zkus jiné slovo nebo kratší dotaz.',
    expandAll: 'Rozbalit vše',
    collapseAll: 'Sbalit vše',
    contents: 'Obsah',
    sections: 'kapitol',
    results: 'výsledků',
    categories: [
      { key: 'all', label: 'Vše', from: 1, to: 99 },
      { key: 'sales', label: 'Obchod', from: 4, to: 11 },
      { key: 'operations', label: 'Provoz', from: 12, to: 21 },
      { key: 'billing', label: 'Fakturace', from: 22, to: 25 },
      { key: 'portal', label: 'Portál', from: 26, to: 28 },
    ],
  },
  en: {
    searchPlaceholder: 'Search the help...',
    noResults: 'No match found. Try a different or shorter search.',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    contents: 'Contents',
    sections: 'chapters',
    results: 'results',
    categories: [
      { key: 'all', label: 'All', from: 1, to: 99 },
      { key: 'sales', label: 'Sales', from: 4, to: 11 },
      { key: 'operations', label: 'Operations', from: 12, to: 21 },
      { key: 'billing', label: 'Billing', from: 22, to: 25 },
      { key: 'portal', label: 'Portal', from: 26, to: 28 },
    ],
  },
  de: {
    searchPlaceholder: 'In der Hilfe suchen...',
    noResults: 'Kein Treffer. Versuche ein anderes oder kürzeres Suchwort.',
    expandAll: 'Alle öffnen',
    collapseAll: 'Alle schließen',
    contents: 'Inhalt',
    sections: 'Kapitel',
    results: 'Treffer',
    categories: [
      { key: 'all', label: 'Alle', from: 1, to: 99 },
      { key: 'sales', label: 'Vertrieb', from: 4, to: 11 },
      { key: 'operations', label: 'Betrieb', from: 12, to: 21 },
      { key: 'billing', label: 'Rechnung', from: 22, to: 25 },
      { key: 'portal', label: 'Portal', from: 26, to: 28 },
    ],
  },
}

function getSectionNumber(section: HelpSection) {
  const raw = Number(section.title.split('.')[0])
  return Number.isFinite(raw) ? raw : 0
}

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function sectionText(section: HelpSection) {
  return [
    section.title,
    ...section.blocks.flatMap((block) => {
      if (block.type === 'paragraph' || block.type === 'subheading') return [block.text]
      return block.items
    }),
  ].join(' ')
}

function pickQuickSteps(sections: HelpSection[]) {
  const workflowSection =
    sections.find((section) => section.title.startsWith('2.')) ??
    sections.find((section) => normalizeSearch(section.title).includes('postup')) ??
    sections[0]

  const listBlock = workflowSection?.blocks.find(
    (block) => block.type === 'ordered-list' || block.type === 'unordered-list'
  ) as Extract<HelpBlock, { type: 'ordered-list' | 'unordered-list' }> | undefined

  return listBlock?.items.slice(0, 6) ?? []
}

function pickSectionSummary(section: HelpSection) {
  const paragraphBlock = section.blocks.find(
    (block) => block.type === 'paragraph'
  ) as Extract<HelpBlock, { type: 'paragraph' }> | undefined

  const text = paragraphBlock?.text ?? section.title
  return text.length > 180 ? `${text.slice(0, 177).trim()}...` : text
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`)/g).filter(Boolean)

  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={`${part}-${index}`}
          style={{
            fontFamily: 'Consolas, "Courier New", monospace',
            backgroundColor: '#eff4fb',
            color: '#284566',
            border: '1px solid #c9d8ea',
            borderRadius: '8px',
            padding: '2px 7px',
            fontSize: '0.92em',
          }}
        >
          {part.slice(1, -1)}
        </code>
      )
    }

    return <span key={`${part}-${index}`}>{part}</span>
  })
}

function renderBlock(block: HelpBlock, sectionIndex: number, blockIndex: number) {
  if (block.type === 'paragraph') {
    const isCallout = block.text.endsWith(':')

    return (
      <p
        key={`${sectionIndex}-${blockIndex}`}
        style={{
          margin: 0,
          color: isCallout ? '#20314f' : '#334155',
          fontSize: '15px',
          lineHeight: 1.75,
          fontWeight: isCallout ? 700 : 400,
        }}
      >
        {renderInline(block.text)}
      </p>
    )
  }

  if (block.type === 'subheading') {
    return (
      <h3
        key={`${sectionIndex}-${blockIndex}`}
        style={{
          margin: '8px 0 0',
          fontSize: '19px',
          lineHeight: 1.3,
          color: '#173153',
        }}
      >
        {block.text}
      </h3>
    )
  }

  const ListTag = block.type === 'ordered-list' ? 'ol' : 'ul'

  return (
    <ListTag
      key={`${sectionIndex}-${blockIndex}`}
      style={{
        margin: 0,
        paddingLeft: block.type === 'ordered-list' ? '22px' : '20px',
        display: 'grid',
        gap: '9px',
        color: '#334155',
      }}
    >
      {block.items.map((item, itemIndex) => (
        <li
          key={`${sectionIndex}-${blockIndex}-${itemIndex}`}
          style={{
            paddingLeft: '4px',
            lineHeight: 1.7,
            fontSize: '15px',
          }}
        >
          {renderInline(item)}
        </li>
      ))}
    </ListTag>
  )
}

export default function HelpCenterClient({
  locale,
  dictionary,
  intro,
  sections,
  supportEmail,
}: HelpCenterClientProps) {
  const t = uiText[locale]
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(sections.slice(0, 4).map((section) => section.id))
  )

  const quickSteps = useMemo(() => pickQuickSteps(sections), [sections])
  const hasQuery = query.trim().length > 0

  const filteredSections = useMemo(() => {
    const normalizedQuery = normalizeSearch(query.trim())
    const selectedCategory = t.categories.find((item) => item.key === category) ?? t.categories[0]

    return sections.filter((section) => {
      const sectionNumber = getSectionNumber(section)
      const inCategory =
        selectedCategory.key === 'all' ||
        (sectionNumber >= selectedCategory.from && sectionNumber <= selectedCategory.to)

      if (!inCategory) return false
      if (!normalizedQuery) return true

      return normalizeSearch(sectionText(section)).includes(normalizedQuery)
    })
  }, [category, query, sections, t.categories])

  const allFilteredExpanded = filteredSections.every((section) => expandedIds.has(section.id))

  function toggleSection(sectionId: string) {
    setExpandedIds((current) => {
      const next = new Set(current)

      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }

      return next
    })
  }

  function toggleAllFiltered() {
    setExpandedIds((current) => {
      const next = new Set(current)

      if (allFilteredExpanded) {
        filteredSections.forEach((section) => next.delete(section.id))
      } else {
        filteredSections.forEach((section) => next.add(section.id))
      }

      return next
    })
  }

  return (
    <main
      className="help-page"
      style={{
        maxWidth: '1180px',
        color: '#111827',
      }}
    >
      <section
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '20px',
          padding: '18px 20px',
          marginBottom: '12px',
          background: 'linear-gradient(135deg, #070B1F 0%, #0B1733 48%, #083344 100%)',
          color: '#ffffff',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.14)',
          border: '1px solid rgba(6, 182, 212, 0.2)',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: '-90px',
            top: '-100px',
            width: '340px',
            height: '340px',
            borderRadius: '999px',
            background: 'radial-gradient(circle, rgba(6, 182, 212, 0.28), transparent 64%)',
            filter: 'blur(10px)',
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '24%',
            bottom: '-160px',
            width: '420px',
            height: '280px',
            borderRadius: '999px',
            background: 'radial-gradient(circle, rgba(124, 58, 237, 0.28), transparent 66%)',
            filter: 'blur(14px)',
          }}
        />
        <div style={{ position: 'relative', display: 'grid', gap: '8px' }}>
          <div
            style={{
              display: 'inline-flex',
              width: 'fit-content',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 9px',
              borderRadius: '999px',
              backgroundColor: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.18)',
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '999px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(255,255,255,0.35)',
              }}
            >
              ?
            </span>
            {dictionary.help.badge}
          </div>

          <div>
            <h1 style={{ margin: 0, fontSize: '32px', lineHeight: 1.08, maxWidth: '820px' }}>
              {dictionary.help.title}
            </h1>
            <p
              style={{
                margin: '7px 0 0',
                maxWidth: '840px',
                color: 'rgba(255,255,255,0.88)',
                fontSize: '14px',
                lineHeight: 1.45,
              }}
            >
              {intro.length > 0 ? intro.join(' ') : dictionary.help.subtitle}
            </p>
            <a
              href={`mailto:${supportEmail}`}
              style={{
                display: 'inline-flex',
                marginTop: '16px',
                color: '#ffffff',
                backgroundColor: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.24)',
                borderRadius: '999px',
                padding: '9px 14px',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 850,
              }}
            >
              Support: {supportEmail}
            </a>
          </div>
        </div>
      </section>

      <section
        className="help-search-bar"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: '12px',
          alignItems: 'center',
          borderRadius: '16px',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          backgroundColor: 'rgba(255,255,255,0.78)',
          padding: '14px',
          marginBottom: '18px',
          position: 'sticky',
          top: '12px',
          zIndex: 10,
          boxShadow: '0 14px 26px rgba(15, 23, 42, 0.08)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.searchPlaceholder}
          style={{
            width: '100%',
            height: '46px',
            borderRadius: '14px',
            border: '1px solid #cbd5e1',
            padding: '0 14px',
            fontSize: '15px',
            boxSizing: 'border-box',
          }}
        />

        <button
          type="button"
          onClick={toggleAllFiltered}
          style={{
            height: '46px',
            borderRadius: '999px',
            border: '1px solid rgba(255,255,255,0.4)',
            background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
            color: '#ffffff',
            padding: '0 16px',
            fontWeight: 800,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {allFilteredExpanded ? t.collapseAll : t.expandAll}
        </button>
      </section>

      <section style={{ display: 'grid', gap: '14px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {t.categories.map((item) => {
            const active = item.key === category

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setCategory(item.key)}
                style={{
                  minHeight: '44px',
                  borderRadius: '999px',
                  border: active ? '1px solid #2563eb' : '1px solid #cbd5e1',
                  background: active
                    ? 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)'
                    : '#ffffff',
                  color: active ? '#ffffff' : '#334155',
                  padding: '10px 14px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {item.label}
              </button>
            )
          })}

          <div style={{ color: '#64748b', fontWeight: 700 }}>
            {filteredSections.length} {hasQuery ? t.results : t.sections}
          </div>
        </div>
      </section>

      {quickSteps.length > 0 ? (
        <section
          style={{
            borderRadius: '24px',
            border: '1px solid rgba(226, 232, 240, 0.9)',
            background: 'linear-gradient(135deg, #ffffff 0%, #f8fbff 55%, #ecfeff 100%)',
            padding: '22px',
            marginBottom: '20px',
            boxShadow: '0 16px 36px rgba(15, 23, 42, 0.06)',
          }}
        >
          <h2 style={{ margin: '0 0 6px', fontSize: '24px', color: '#0f172a' }}>
            {dictionary.help.recommendedTitle}
          </h2>
          <p style={{ margin: '0 0 14px', color: '#64748b', fontSize: '14px' }}>
            {dictionary.help.recommendedSubtitle}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
            {quickSteps.map((step, index) => (
              <div
                key={`${step}-${index}`}
                style={{
                  borderRadius: '18px',
                  padding: '15px',
                  background: 'linear-gradient(145deg, #eef5ff 0%, #ffffff 100%)',
                  border: '1px solid #d2deec',
                  minHeight: '92px',
                }}
              >
                <div style={{ color: '#58708d', fontSize: '12px', fontWeight: 900, marginBottom: '8px' }}>
                  {dictionary.help.step} {index + 1}
                </div>
                <div style={{ color: '#183153', fontWeight: 900, lineHeight: 1.28 }}>
                  {renderInline(step)}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="help-content-layout">
        <aside className="help-table-of-contents">
          <div style={{ fontSize: '14px', fontWeight: 900, color: '#0f172a', marginBottom: '4px' }}>
            {t.contents}
          </div>
          {filteredSections.map((section) => {
            const isOpen = hasQuery || expandedIds.has(section.id)

            return (
              <a
                key={section.id}
                href={`#${section.id}`}
                style={{
                  textDecoration: 'none',
                  color: '#334155',
                  fontSize: '14px',
                  lineHeight: 1.35,
                  borderRadius: '10px',
                  padding: '9px 10px',
                  backgroundColor: isOpen ? '#eef5ff' : 'transparent',
                  border: isOpen ? '1px solid #cfe0f7' : '1px solid transparent',
                }}
              >
                {section.title.replace(/^\d+\.\s*/, '')}
              </a>
            )
          })}
        </aside>

        <div style={{ display: 'grid', gap: '12px', paddingBottom: '40px' }}>
          {filteredSections.length === 0 ? (
            <div
              style={{
                borderRadius: '16px',
                border: '1px solid #e5e7eb',
                backgroundColor: '#ffffff',
                padding: '22px',
                color: '#64748b',
                fontWeight: 700,
              }}
            >
              {t.noResults}
            </div>
          ) : (
            filteredSections.map((section, sectionIndex) => {
              const isExpanded = hasQuery || expandedIds.has(section.id)

              return (
                <article
                  key={section.id}
                  id={section.id}
                  style={{
                    scrollMarginTop: '110px',
                    borderRadius: '22px',
                    border: '1px solid rgba(223, 231, 242, 0.95)',
                    backgroundColor: '#ffffff',
                    overflow: 'hidden',
                    boxShadow: isExpanded
                      ? '0 18px 40px rgba(15, 23, 42, 0.08)'
                      : '0 10px 24px rgba(15, 23, 42, 0.035)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    style={{
                      width: '100%',
                      border: 0,
                      background: isExpanded
                        ? 'linear-gradient(135deg, #f8fbff 0%, #ecfeff 100%)'
                        : '#ffffff',
                      padding: '18px 20px',
                      display: 'grid',
                      gridTemplateColumns: '44px minmax(0, 1fr) auto',
                      gap: '14px',
                      alignItems: 'center',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '12px',
                        background: 'linear-gradient(135deg, rgba(124,58,237,0.14), rgba(6,182,212,0.16))',
                        color: '#2563eb',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 900,
                      }}
                    >
                      {section.title.split('.')[0]}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: '22px',
                          lineHeight: 1.2,
                          fontWeight: 900,
                          color: '#10233f',
                        }}
                      >
                        {section.title.replace(/^\d+\.\s*/, '')}
                      </span>
                      {!isExpanded ? (
                        <span
                          style={{
                            display: 'block',
                            marginTop: '6px',
                            color: '#64748b',
                            fontSize: '14px',
                            lineHeight: 1.45,
                          }}
                        >
                          {pickSectionSummary(section)}
                        </span>
                      ) : null}
                    </span>
                    <span
                      style={{
                        borderRadius: '999px',
                        border: '1px solid #cbd5e1',
                        color: '#334155',
                        padding: '7px 10px',
                        fontWeight: 900,
                        fontSize: '13px',
                      }}
                    >
                      {isExpanded ? '-' : '+'}
                    </span>
                  </button>

                  {isExpanded ? (
                    <div className="help-section-body">
                      {section.blocks.map((block, blockIndex) => renderBlock(block, sectionIndex, blockIndex))}
                    </div>
                  ) : null}
                </article>
              )
            })
          )}
        </div>
      </section>

      <style>{`
        .help-content-layout {
          display: grid;
          grid-template-columns: 260px minmax(0, 1fr);
          gap: 18px;
          align-items: start;
        }

        .help-table-of-contents {
          position: sticky;
          top: 96px;
          border-radius: 22px;
          border: 1px solid rgba(226, 232, 240, 0.9);
          background-color: rgba(255,255,255,0.88);
          padding: 16px;
          display: grid;
          gap: 10px;
          max-height: calc(100vh - 124px);
          overflow-y: auto;
        }

        .help-section-body {
          display: grid;
          gap: 13px;
          padding: 0 22px 22px 80px;
        }

        @media (max-width: 920px) {
          .help-content-layout {
            grid-template-columns: 1fr;
          }

          .help-table-of-contents {
            position: static;
            max-height: 260px;
          }
        }

        @media (max-width: 640px) {
          .help-page {
            max-width: 100%;
          }

          .help-search-bar {
            grid-template-columns: 1fr !important;
          }

          .help-section-body {
            padding: 0 18px 20px;
          }
        }
      `}</style>
    </main>
  )
}
