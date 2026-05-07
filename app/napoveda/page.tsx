import { readFile } from 'fs/promises'
import path from 'path'

import DashboardShell from '@/components/DashboardShell'
import HelpCenterClient, { type HelpBlock, type HelpSection } from '@/components/HelpCenterClient'
import type { Locale } from '@/lib/i18n/config'
import { getRequestDictionary, getRequestLocale } from '@/lib/i18n/server'

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
  const intro: string[] = []
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

    if (!currentSection) {
      intro.push(trimmed)
      continue
    }

    const subheadingMatch = trimmed.match(/^###\s+(.*)$/)
    if (subheadingMatch) {
      pushParagraph(paragraphLines, currentSection.blocks)
      pushList(listType, listItems, currentSection.blocks)
      listType = null
      currentSection.blocks.push({ type: 'subheading', text: subheadingMatch[1] })
      continue
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/)
    if (orderedMatch) {
      pushParagraph(paragraphLines, currentSection.blocks)
      if (listType !== 'ordered-list') {
        pushList(listType, listItems, currentSection.blocks)
        listType = 'ordered-list'
      }
      listItems.push(orderedMatch[1].trim())
      continue
    }

    const unorderedMatch = line.match(/^\s*-\s+(.*)$/)
    if (unorderedMatch) {
      pushParagraph(paragraphLines, currentSection.blocks)
      if (listType !== 'unordered-list') {
        pushList(listType, listItems, currentSection.blocks)
        listType = 'unordered-list'
      }
      listItems.push(unorderedMatch[1].trim())
      continue
    }

    if (/^\s{2,}\S/.test(line) && listItems.length > 0) {
      listItems[listItems.length - 1] += ` ${trimmed}`
      continue
    }

    pushList(listType, listItems, currentSection.blocks)
    listType = null
    paragraphLines.push(trimmed)
  }

  flushSectionState()
  return { intro, sections }
}

async function readManualForLocale(locale: Locale) {
  if (locale === 'en') return readFile(path.join(process.cwd(), 'NAVOD-JEDNATELKA.en.md'), 'utf8')
  if (locale === 'de') return readFile(path.join(process.cwd(), 'NAVOD-JEDNATELKA.de.md'), 'utf8')
  return readFile(path.join(process.cwd(), 'NAVOD-JEDNATELKA.md'), 'utf8')
}

export default async function HelpPage() {
  const locale = await getRequestLocale()
  const dictionary = await getRequestDictionary()
  const manualContent = await readManualForLocale(locale)
  const { intro, sections } = parseManual(manualContent)

  return (
    <DashboardShell activeItem="help">
      <HelpCenterClient locale={locale} dictionary={dictionary} intro={intro} sections={sections} />
    </DashboardShell>
  )
}
