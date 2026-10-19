import { parseCoreQuoteConversion, type CoreQuoteConversionInput } from '../lib/core-quote-conversion'

export type PendingQuoteConversion = {
  version: 1; actorProfileId: string; payload: CoreQuoteConversionInput; sendConfirmation: boolean
}
export type WorkDay = { dateKey: string; label: string; startAt: Date; endAt: Date }
const pad = (value: number) => String(value).padStart(2, '0')
export const localDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
export const localDateTime = (date: Date) => `${localDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`

export function conversionDates(startText: string, endText: string) {
  const start = new Date(startText), end = new Date(endText)
  for (const [text, date] of [[startText, start], [endText, end]] as const) {
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(text) && localDateTime(date) !== text) {
      throw new Error('Termín musí obsahovat skutečné datum a čas.')
    }
  }
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error('Vyplňte platný začátek a konec realizace. Konec musí být později než začátek.')
  }
  return { start, end }
}

export function conversionWorkDays(start: Date, end: Date): WorkDay[] {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start ||
    end.getTime() - start.getTime() > 366 * 86400000 || localDateKey(start) === localDateKey(end)) return []
  const days: WorkDay[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  while (cursor <= end && days.length < 366) {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), start.getHours(), start.getMinutes())
    const until = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), end.getHours(), end.getMinutes())
    if (until <= from) until.setDate(until.getDate() + 1)
    if (from < end) days.push({ dateKey: localDateKey(cursor), label: new Intl.DateTimeFormat('cs-CZ', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(cursor), startAt: from, endAt: new Date(Math.min(until.getTime(), end.getTime())) })
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

export function conversionStorageKey(companyId: string, actorProfileId: string, quoteId: string) {
  return `diriqo:quote-conversion:v1:${companyId}:${actorProfileId}:${quoteId}`
}

export function readPendingConversion(raw: string | null, scope: { companyId: string; actorProfileId: string; quoteId: string }): PendingQuoteConversion | null {
  if (raw === null) return null
  try {
    const saved = JSON.parse(raw) as PendingQuoteConversion
    const p = saved.payload
    if (saved.version !== 1 || saved.actorProfileId !== scope.actorProfileId || !p ||
      p.companyId !== scope.companyId || p.quoteId !== scope.quoteId ||
      !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(p.operationId) ||
      typeof p.title !== 'string' || typeof p.startAt !== 'string' || typeof p.endAt !== 'string' ||
      !(p.description === null || typeof p.description === 'string') || !(p.address === null || typeof p.address === 'string') ||
      typeof saved.sendConfirmation !== 'boolean' || !Array.isArray(p.splitDays) || p.splitDays.length > 366 ||
      p.splitDays.some(day => !day || typeof day.label !== 'string' || typeof day.startAt !== 'string' || typeof day.endAt !== 'string')) throw new Error()
    parseCoreQuoteConversion(p)
    conversionDates(p.startAt, p.endAt)
    return saved
  } catch {
    throw new Error('Uložený požadavek nelze bezpečně obnovit. Před novým převodem ověřte zakázku u správce; uložený požadavek zůstává zachován.')
  }
}