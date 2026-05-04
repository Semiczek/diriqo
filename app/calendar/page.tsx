'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import DashboardShell from '../../components/DashboardShell'
import { useI18n } from '../../components/I18nProvider'
import { getIntlLocale } from '../../lib/i18n/config'
import { supabase } from '../../lib/supabase'

type CalendarView = 'list' | 'week' | 'month'
type ItemFilter = 'all' | 'jobs' | 'events'
type RangeMode = 'preset' | 'custom'
type RangeFilter = 'today' | '7d' | '14d' | '30d'

type JobRow = {
  id: string
  parent_job_id: string | null
  title: string | null
  description: string | null
  status: string | null
  start_at: string | null
  end_at: string | null
  customer_id: string | null
  customers?: { name: string | null }[] | null
}

type CalendarEventRow = {
  id: string
  title: string | null
  description: string | null
  start_at: string | null
  end_at: string | null
  job_id: string | null
}

type CalendarItem = {
  id: string
  type: 'job' | 'event'
  title: string
  description: string
  status: string | null
  start_at: string | null
  end_at: string | null
  customerName: string | null
}

function startOfDay(date: Date) { const d = new Date(date); d.setHours(0,0,0,0); return d }
function endOfDay(date: Date) { const d = new Date(date); d.setHours(23,59,59,999); return d }
function addDays(date: Date, days: number) { const d = new Date(date); d.setDate(d.getDate()+days); return d }
function startOfWeek(date: Date) { const d = startOfDay(date); const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day; d.setDate(d.getDate()+diff); return d }
function endOfWeek(date: Date) { return endOfDay(addDays(startOfWeek(date), 6)) }
function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0) }
function endOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999) }
function isSameDay(a: Date, b: Date) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate() }
function formatDateInputValue(date: Date) { return `${date.getFullYear()}-${`${date.getMonth()+1}`.padStart(2,'0')}-${`${date.getDate()}`.padStart(2,'0')}` }
function parseDateInput(value: string, end = false) { if (!value) return null; const [year,month,day] = value.split('-').map(Number); if (!year || !month || !day) return null; return end ? new Date(year, month-1, day, 23,59,59,999) : new Date(year, month-1, day, 0,0,0,0) }

function getRangeBoundsFromPreset(view: CalendarView, range: RangeFilter, anchorDate: Date): { from: Date; to: Date } {
  const today = new Date()
  if (view === 'week') return { from: startOfWeek(anchorDate), to: endOfWeek(anchorDate) }
  if (view === 'month') return { from: startOfMonth(anchorDate), to: endOfMonth(anchorDate) }
  if (range === 'today') return { from: startOfDay(today), to: endOfDay(today) }
  if (range === '7d') return { from: startOfDay(today), to: endOfDay(addDays(today, 6)) }
  if (range === '14d') return { from: startOfDay(today), to: endOfDay(addDays(today, 13)) }
  return { from: startOfDay(today), to: endOfDay(addDays(today, 29)) }
}

function getDaysInRange(from: Date, to: Date) { const days: Date[] = []; const cursor = new Date(from); while (cursor <= to) { days.push(new Date(cursor)); cursor.setDate(cursor.getDate()+1) } return days }
function getMonthGridDays(anchorDate: Date) { return getDaysInRange(startOfWeek(startOfMonth(anchorDate)), endOfWeek(endOfMonth(anchorDate))) }
function getLeftBorderColor(type: 'job' | 'event') { return type === 'job' ? '#2563eb' : '#6b7280' }
function getItemHref(item: CalendarItem) { return item.type === 'job' ? `/jobs/${item.id}` : `/calendar/events/${item.id}` }
function getItemStart(item: CalendarItem) { if (!item.start_at) return null; const d = new Date(item.start_at); return Number.isNaN(d.getTime()) ? null : d }
function getItemEnd(item: CalendarItem) { if (!item.end_at) { const start = getItemStart(item); return start ? new Date(start) : null } const d = new Date(item.end_at); return Number.isNaN(d.getTime()) ? getItemStart(item) : d }
function itemOverlapsRange(item: CalendarItem, from: Date, to: Date) { const start = getItemStart(item); const end = getItemEnd(item); if (!start || !end) return false; return start <= to && end >= from }
function itemOccursOnDay(item: CalendarItem, day: Date) { return itemOverlapsRange(item, startOfDay(day), endOfDay(day)) }
function isMultiDayItem(item: CalendarItem) { const start = getItemStart(item); const end = getItemEnd(item); if (!start || !end) return false; return !isSameDay(start, end) }

export default function CalendarPage() {
  const { dictionary, locale } = useI18n()
  const intlLocale = getIntlLocale(locale)

  const formatDateTime = (value: string | null) => {
    if (!value) return dictionary.calendar.noTime
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return dictionary.calendar.invalidDate
    return new Intl.DateTimeFormat(intlLocale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
  }

  const formatTime = (value: string | null) => {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '-'
    return new Intl.DateTimeFormat(intlLocale, { hour: '2-digit', minute: '2-digit' }).format(date)
  }

  const formatDayLabel = (date: Date) => new Intl.DateTimeFormat(intlLocale, { weekday: 'long', day: '2-digit', month: '2-digit' }).format(date)
  const formatShortDayLabel = (date: Date) => new Intl.DateTimeFormat(intlLocale, { weekday: 'short', day: '2-digit', month: '2-digit' }).format(date)
  const formatMonthLabel = (date: Date) => new Intl.DateTimeFormat(intlLocale, { month: 'long', year: 'numeric' }).format(date)
  const getItemTypeLabel = (type: 'job' | 'event') => type === 'job' ? dictionary.calendar.itemJob : dictionary.calendar.itemEvent
  const getStatusLabel = (status: string | null) => status || dictionary.calendar.noStatus

  const getItemDayTimeLabel = (item: CalendarItem, day: Date) => {
    const start = getItemStart(item)
    const end = getItemEnd(item)
    if (!start || !end) return dictionary.calendar.noTime
    const startsToday = isSameDay(start, day)
    const endsToday = isSameDay(end, day)
    if (startsToday && endsToday) return `${formatTime(item.start_at)} - ${formatTime(item.end_at)}`
    if (startsToday) return `${dictionary.calendar.fromTime} ${formatTime(item.start_at)}`
    if (endsToday) return `${dictionary.calendar.untilTime} ${formatTime(item.end_at)}`
    return dictionary.calendar.allDayOrContinues
  }

  function CalendarItemCard({ item, activeDay }: { item: CalendarItem; activeDay?: Date }) {
    const multiDay = isMultiDayItem(item)
    return (
      <Link href={getItemHref(item)} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
        <div style={{ border: '1px solid rgba(226, 232, 240, 0.9)', borderLeft: `6px solid ${getLeftBorderColor(item.type)}`, borderRadius: 18, padding: 16, background: 'linear-gradient(145deg, #ffffff 0%, #f8fbff 100%)', display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 12px 28px rgba(15,23,42,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#111827' }}>{item.title}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {multiDay ? <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', background: '#ede9fe', padding: '4px 8px', borderRadius: 999 }}>{dictionary.calendar.multiDay}</div> : null}
              <div style={{ fontSize: 12, fontWeight: 600, color: item.type === 'job' ? '#1d4ed8' : '#4b5563', background: item.type === 'job' ? '#dbeafe' : '#f3f4f6', padding: '4px 8px', borderRadius: 999 }}>{getItemTypeLabel(item.type)}</div>
            </div>
          </div>
          {activeDay ? <div style={{ fontSize: 13, color: '#111827', fontWeight: 700 }}>{dictionary.calendar.forThisDay}: {getItemDayTimeLabel(item, activeDay)}</div> : null}
          <div style={{ fontSize: 13, color: '#374151' }}><strong>{dictionary.calendar.startsAt}:</strong> {formatDateTime(item.start_at)}</div>
          <div style={{ fontSize: 13, color: '#374151' }}><strong>{dictionary.calendar.endsAt}:</strong> {formatDateTime(item.end_at)}</div>
          {item.customerName ? <div style={{ fontSize: 13, color: '#374151' }}><strong>{dictionary.calendar.customer}:</strong> {item.customerName}</div> : null}
          {item.type === 'job' ? <div style={{ fontSize: 13, color: '#374151' }}><strong>{dictionary.calendar.status}:</strong> {getStatusLabel(item.status)}</div> : null}
          {item.description ? <div style={{ fontSize: 13, color: '#4b5563', whiteSpace: 'pre-wrap' }}>{item.description}</div> : null}
        </div>
      </Link>
    )
  }

  function WeekItemCard({ item, day }: { item: CalendarItem; day: Date }) {
    return (
      <Link href={getItemHref(item)} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
        <div style={{ border: '1px solid rgba(226,232,240,0.9)', borderLeft: `5px solid ${getLeftBorderColor(item.type)}`, borderRadius: 16, padding: 12, background: '#fff' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: '#111827' }}>{item.title}</div>
          <div style={{ fontSize: 12, color: '#4b5563' }}>{getItemDayTimeLabel(item, day)}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{getItemTypeLabel(item.type)}</div>
        </div>
      </Link>
    )
  }

  function MonthItemChip({ item, day }: { item: CalendarItem; day: Date }) {
    return (
      <Link href={getItemHref(item)} style={{ fontSize: 12, borderLeft: `4px solid ${getLeftBorderColor(item.type)}`, background: '#f8fafc', borderRadius: 10, padding: '6px 6px 6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', textDecoration: 'none', color: '#111827' }} title={`${item.title} | ${getItemDayTimeLabel(item, day)}`}>
        {item.title}
      </Link>
    )
  }

  const [items, setItems] = useState<CalendarItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<CalendarView>('list')
  const [itemFilter, setItemFilter] = useState<ItemFilter>('all')
  const [rangeMode, setRangeMode] = useState<RangeMode>('preset')
  const [range, setRange] = useState<RangeFilter>('7d')
  const [anchorDate, setAnchorDate] = useState<Date>(new Date())
  const [customFrom, setCustomFrom] = useState(formatDateInputValue(new Date()))
  const [customTo, setCustomTo] = useState(formatDateInputValue(addDays(new Date(), 6)))

  useEffect(() => {
    async function loadCalendar() {
      setLoading(true)
      setError(null)

      const { data: jobsData, error: jobsError } = await supabase.from('jobs').select(`
        id,
        parent_job_id,
        title,
        description,
        status,
        start_at,
        end_at,
        customer_id,
        customers (
          name
        )
      `).order('start_at', { ascending: true })

      if (jobsError) {
        console.error('Calendar jobs load error', jobsError)
        setError('Data se nepodařilo načíst.')
        setLoading(false)
        return
      }

      const { data: eventsData, error: eventsError } = await supabase.from('calendar_events').select(`
        id,
        title,
        description,
        start_at,
        end_at,
        job_id
      `).is('job_id', null).order('start_at', { ascending: true })

      if (eventsError) {
        console.error('Calendar events load error', eventsError)
        setError('Data se nepodařilo načíst.')
        setLoading(false)
        return
      }

      const jobs = ((jobsData as JobRow[]) || [])
      const parentJobIds = new Set(
        jobs
          .map((job) => job.parent_job_id)
          .filter((parentJobId): parentJobId is string => Boolean(parentJobId))
      )
      const visibleJobs = jobs.filter((job) => !parentJobIds.has(job.id))

      const mappedJobs: CalendarItem[] = visibleJobs.map((job) => ({
        id: job.id,
        type: 'job',
        title: job.title || dictionary.calendar.untitledJob,
        description: job.description || '',
        status: job.status,
        start_at: job.start_at,
        end_at: job.end_at,
        customerName: job.customers?.[0]?.name || null,
      }))

      const mappedEvents: CalendarItem[] = ((eventsData as CalendarEventRow[]) || []).map((event) => ({
        id: event.id,
        type: 'event',
        title: event.title || dictionary.calendar.untitledEvent,
        description: event.description || '',
        status: null,
        start_at: event.start_at,
        end_at: event.end_at,
        customerName: null,
      }))

      const merged = [...mappedJobs, ...mappedEvents].sort((a, b) => (getItemStart(a)?.getTime() ?? 0) - (getItemStart(b)?.getTime() ?? 0))
      setItems(merged)
      setLoading(false)
    }

    void loadCalendar()
  }, [dictionary.calendar.eventsLoadError, dictionary.calendar.jobsLoadError, dictionary.calendar.untitledEvent, dictionary.calendar.untitledJob])

  const presetBounds = useMemo(() => getRangeBoundsFromPreset(view, range, anchorDate), [view, range, anchorDate])
  const customBounds = useMemo(() => {
    const from = parseDateInput(customFrom, false)
    const to = parseDateInput(customTo, true)
    if (!from || !to) return null
    return from > to ? { from: startOfDay(to), to: endOfDay(from) } : { from, to }
  }, [customFrom, customTo])
  const bounds = useMemo(() => rangeMode === 'custom' && customBounds ? customBounds : presetBounds, [rangeMode, customBounds, presetBounds])
  const filteredItems = useMemo(() => items.filter((item) => (itemFilter === 'jobs' ? item.type === 'job' : itemFilter === 'events' ? item.type === 'event' : true) && itemOverlapsRange(item, bounds.from, bounds.to)).sort((a,b)=>(getItemStart(a)?.getTime() ?? 0) - (getItemStart(b)?.getTime() ?? 0)), [items, itemFilter, bounds])
  const listDays = useMemo(() => getDaysInRange(bounds.from, bounds.to), [bounds])
  const weekDays = useMemo(() => getDaysInRange(bounds.from, bounds.to), [bounds])
  const monthGridDays = useMemo(() => getMonthGridDays(anchorDate), [anchorDate])

  function goPrev() { if (view === 'week') { setAnchorDate((prev)=>addDays(prev, -7)); return } if (view === 'month') { setAnchorDate((prev)=>new Date(prev.getFullYear(), prev.getMonth()-1, 1)) } }
  function goNext() { if (view === 'week') { setAnchorDate((prev)=>addDays(prev, 7)); return } if (view === 'month') { setAnchorDate((prev)=>new Date(prev.getFullYear(), prev.getMonth()+1, 1)) } }
  function goToday() { const now = new Date(); setAnchorDate(now); if (rangeMode === 'custom') { setCustomFrom(formatDateInputValue(now)); setCustomTo(formatDateInputValue(addDays(now, 6))) } }

  return (
    <DashboardShell activeItem="calendar">
      <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap', marginBottom: 22, padding: 28, borderRadius: 28, background: 'linear-gradient(135deg, rgba(250,245,255,0.96) 0%, rgba(239,246,255,0.94) 52%, rgba(236,254,255,0.9) 100%)', border: '1px solid rgba(203, 213, 225, 0.78)', boxShadow: '0 22px 58px rgba(15, 23, 42, 0.10)' }}>
        <div>
          <div style={{ display: 'inline-flex', marginBottom: 12, padding: '7px 11px', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.72)', border: '1px solid rgba(124,58,237,0.2)', color: '#5b21b6', fontSize: 12, fontWeight: 900 }}>
            Plánování
          </div>
          <h1 style={{ margin: 0, fontSize: 44, lineHeight: 1.05, fontWeight: 850, color: '#0f172a' }}>{dictionary.calendar.title}</h1>
          <div style={{ color: '#475569', marginTop: 10, fontSize: 16, lineHeight: 1.6 }}>Plán zakázek a směn v čase.</div>
        </div>

        <Link href="/calendar/new" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)', color: '#fff', textDecoration: 'none', padding: '13px 18px', borderRadius: 999, fontWeight: 900, boxShadow: '0 16px 34px rgba(37,99,235,0.22)' }}>
          {dictionary.calendar.newInternalEvent}
        </Link>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.82)', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 24, padding: 18, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 14px 34px rgba(15,23,42,0.06)', backdropFilter: 'blur(14px)' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(['list','week','month'] as CalendarView[]).map((mode) => (
            <button key={mode} onClick={() => { setView(mode); if (mode !== 'list') setRangeMode('preset') }} style={{ padding: '10px 14px', borderRadius: 999, border: view === mode ? '1px solid #2563eb' : '1px solid #d1d5db', background: view === mode ? 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)' : '#fff', color: view === mode ? '#fff' : '#111827', fontWeight: 800, cursor: 'pointer' }}>
              {mode === 'list' ? dictionary.calendar.list : mode === 'week' ? dictionary.calendar.week : dictionary.calendar.month}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={itemFilter} onChange={(e) => setItemFilter(e.target.value as ItemFilter)} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff' }}>
            <option value="all">{dictionary.calendar.allItems}</option>
            <option value="jobs">{dictionary.calendar.jobsOnly}</option>
            <option value="events">{dictionary.calendar.eventsOnly}</option>
          </select>

          {view === 'list' ? (<>
            <button onClick={() => setRangeMode('preset')} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: rangeMode === 'preset' ? '#111827' : '#fff', color: rangeMode === 'preset' ? '#fff' : '#111827', fontWeight: 700, cursor: 'pointer' }}>{dictionary.calendar.quickSelection}</button>
            <button onClick={() => setRangeMode('custom')} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: rangeMode === 'custom' ? '#111827' : '#fff', color: rangeMode === 'custom' ? '#fff' : '#111827', fontWeight: 700, cursor: 'pointer' }}>{dictionary.calendar.customRange}</button>
          </>) : null}

          {view === 'list' && rangeMode === 'preset' ? (
            <select value={range} onChange={(e) => setRange(e.target.value as RangeFilter)} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff' }}>
              <option value="today">{dictionary.calendar.today}</option>
              <option value="7d">{dictionary.calendar.days7}</option>
              <option value="14d">{dictionary.calendar.days14}</option>
              <option value="30d">{dictionary.calendar.days30}</option>
            </select>
          ) : null}

          {view === 'list' && rangeMode === 'custom' ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 14, color: '#374151', fontWeight: 600 }}>{dictionary.calendar.from}</span><input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff' }} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 14, color: '#374151', fontWeight: 600 }}>{dictionary.calendar.to}</span><input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff' }} /></div>
            </div>
          ) : null}

          {view === 'week' || view === 'month' ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={goPrev} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 700 }}>{dictionary.calendar.previous}</button>
              <button onClick={goToday} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 700 }}>{dictionary.calendar.today}</button>
              <button onClick={goNext} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 700 }}>{dictionary.calendar.next}</button>
            </div>
          ) : null}
        </div>

        <div style={{ fontSize: 14, color: '#4b5563', fontWeight: 600 }}>
          {view === 'list' ? `${dictionary.calendar.displayedPeriod}: ${formatDateTime(bounds.from.toISOString())} - ${formatDateTime(bounds.to.toISOString())}` : view === 'week' ? `${dictionary.calendar.weekLabel}: ${formatDayLabel(bounds.from)} - ${formatDayLabel(bounds.to)}` : `${dictionary.calendar.monthLabel}: ${formatMonthLabel(anchorDate)}`}
        </div>
      </div>

      {loading ? (
        <div style={{ background: '#fff', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 22, padding: 22 }}>{dictionary.calendar.loading}</div>
      ) : error ? (
        <div style={{ background: '#fff', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 22, padding: 22 }}>
          <strong>Data se nepodařilo načíst.</strong>
          <div style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>Technický detail je v konzoli.</div>
        </div>
      ) : filteredItems.length === 0 ? (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', background: 'linear-gradient(145deg, #ffffff 0%, #f8fbff 100%)', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 24, padding: 22, boxShadow: '0 16px 36px rgba(15,23,42,0.055)' }}>
          <div style={{ width: 42, height: 42, borderRadius: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, rgba(124,58,237,0.14), rgba(6,182,212,0.16))', color: '#2563eb', fontWeight: 950 }}>C</div>
          <div>
            <div style={{ color: '#0f172a', fontSize: 18, fontWeight: 850, marginBottom: 4 }}>Zatím žádné události v kalendáři.</div>
            <div style={{ color: '#64748b' }}>Vytvoř první interní událost nebo naplánuj zakázku.</div>
            <Link href="/calendar/new" style={{ display: 'inline-flex', marginTop: 12, padding: '9px 12px', borderRadius: 999, background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)', color: '#ffffff', textDecoration: 'none', fontSize: 13, fontWeight: 900 }}>{dictionary.calendar.newInternalEvent}</Link>
          </div>
        </div>
      ) : view === 'list' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {listDays.map((day) => {
            const dayItems = filteredItems.filter((item) => itemOccursOnDay(item, day))
            if (dayItems.length === 0) return null
            return (
              <section key={day.toISOString()} style={{ background: '#fff', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 24, padding: 18, boxShadow: '0 14px 34px rgba(15,23,42,0.055)' }}>
                <h2 style={{ marginTop: 0, marginBottom: 14, fontSize: 18, fontWeight: 800, textTransform: 'capitalize' }}>{formatDayLabel(day)}</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{dayItems.map((item) => <CalendarItemCard key={`${item.type}-${item.id}-${day.toISOString()}`} item={item} activeDay={day} />)}</div>
              </section>
            )
          })}
        </div>
      ) : view === 'week' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {weekDays.map((day) => {
            const dayItems = filteredItems.filter((item) => itemOccursOnDay(item, day))
            return (
              <div key={day.toISOString()} style={{ background: '#fff', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 22, padding: 14, minHeight: 220, boxShadow: '0 12px 28px rgba(15,23,42,0.045)' }}>
                <div style={{ fontWeight: 800, marginBottom: 12, fontSize: 15, textTransform: 'capitalize' }}>{formatShortDayLabel(day)}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{dayItems.length === 0 ? <div style={{ color: '#9ca3af', fontSize: 13 }}>{dictionary.calendar.nothingPlanned}</div> : dayItems.map((item) => <WeekItemCard key={`${item.type}-${item.id}-${day.toISOString()}`} item={item} day={day} />)}</div>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 24, padding: 14, boxShadow: '0 14px 34px rgba(15,23,42,0.055)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8, marginBottom: 8 }}>
            {Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(intlLocale, { weekday: 'short' }).format(new Date(2026, 0, 5 + index))).map((label) => (
              <div key={label} style={{ fontWeight: 800, textAlign: 'center', padding: '8px 4px', color: '#374151' }}>{label}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}>
            {monthGridDays.map((day) => {
              const dayItems = filteredItems.filter((item) => itemOccursOnDay(item, day))
              const inCurrentMonth = day.getMonth() === anchorDate.getMonth()
              const isTodayFlag = isSameDay(day, new Date())
              return (
                <div key={day.toISOString()} style={{ minHeight: 120, border: '1px solid #e5e7eb', borderRadius: 10, padding: 8, background: inCurrentMonth ? '#fff' : '#f9fafb', opacity: inCurrentMonth ? 1 : 0.65 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 999, background: isTodayFlag ? '#111827' : 'transparent', color: isTodayFlag ? '#fff' : '#111827' }}>{day.getDate()}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {dayItems.slice(0, 3).map((item) => <MonthItemChip key={`${item.type}-${item.id}-${day.toISOString()}`} item={item} day={day} />)}
                    {dayItems.length > 3 ? <div style={{ fontSize: 12, color: '#6b7280' }}>+{dayItems.length - 3} {dictionary.calendar.moreItems}</div> : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </DashboardShell>
  )
}
