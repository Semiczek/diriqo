'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import DashboardShell from '../../components/DashboardShell'
import { useI18n } from '../../components/I18nProvider'
import { getIntlLocale } from '../../lib/i18n/config'
import type { CalendarMessages } from '../../lib/i18n/dictionaries/types'
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

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function startOfWeek(date: Date) {
  const d = startOfDay(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

function endOfWeek(date: Date) {
  return endOfDay(addDays(startOfWeek(date), 6))
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatDateInputValue(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

function parseDateInput(value: string, end = false) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return end ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day, 0, 0, 0, 0)
}

function getRangeBoundsFromPreset(view: CalendarView, range: RangeFilter, anchorDate: Date): { from: Date; to: Date } {
  const today = new Date()
  if (view === 'week') return { from: startOfWeek(anchorDate), to: endOfWeek(anchorDate) }
  if (view === 'month') return { from: startOfMonth(anchorDate), to: endOfMonth(anchorDate) }
  if (range === 'today') return { from: startOfDay(today), to: endOfDay(today) }
  if (range === '7d') return { from: startOfDay(today), to: endOfDay(addDays(today, 6)) }
  if (range === '14d') return { from: startOfDay(today), to: endOfDay(addDays(today, 13)) }
  return { from: startOfDay(today), to: endOfDay(addDays(today, 29)) }
}

function getDaysInRange(from: Date, to: Date) {
  const days: Date[] = []
  const cursor = new Date(from)
  while (cursor <= to) {
    days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function getMonthGridDays(anchorDate: Date) {
  return getDaysInRange(startOfWeek(startOfMonth(anchorDate)), endOfWeek(endOfMonth(anchorDate)))
}

function getItemHref(item: CalendarItem) {
  return item.type === 'job' ? `/jobs/${item.id}` : `/calendar/events/${item.id}`
}

function getItemStart(item: CalendarItem) {
  if (!item.start_at) return null
  const d = new Date(item.start_at)
  return Number.isNaN(d.getTime()) ? null : d
}

function getItemEnd(item: CalendarItem) {
  if (!item.end_at) {
    const start = getItemStart(item)
    return start ? new Date(start) : null
  }
  const d = new Date(item.end_at)
  return Number.isNaN(d.getTime()) ? getItemStart(item) : d
}

function itemOverlapsRange(item: CalendarItem, from: Date, to: Date) {
  const start = getItemStart(item)
  const end = getItemEnd(item)
  if (!start || !end) return false
  return start <= to && end >= from
}

function itemOccursOnDay(item: CalendarItem, day: Date) {
  return itemOverlapsRange(item, startOfDay(day), endOfDay(day))
}

function isMultiDayItem(item: CalendarItem) {
  const start = getItemStart(item)
  const end = getItemEnd(item)
  if (!start || !end) return false
  return !isSameDay(start, end)
}

function getItemTone(item: CalendarItem, messages: CalendarMessages) {
  if (item.type === 'job') {
    return {
      accent: '#2563eb',
      accentSoft: 'rgba(37, 99, 235, 0.12)',
      chipBg: 'linear-gradient(135deg, rgba(37,99,235,0.14), rgba(6,182,212,0.14))',
      chipColor: '#1d4ed8',
      label: messages.itemJob,
    }
  }

  return {
    accent: '#7c3aed',
    accentSoft: 'rgba(124, 58, 237, 0.12)',
    chipBg: 'linear-gradient(135deg, rgba(124,58,237,0.14), rgba(236,72,153,0.12))',
    chipColor: '#6d28d9',
    label: messages.itemEvent,
  }
}

function getStatusLabel(status: string | null, messages: CalendarMessages) {
  if (!status) return messages.noStatus
  const labels: Record<string, string> = {
    planned: messages.statusPlanned,
    in_progress: messages.statusInProgress,
    waiting_check: messages.statusWaitingCheck,
    done: messages.statusDone,
    cancelled: messages.statusCancelled,
    waiting_for_invoice: messages.statusWaitingForInvoice,
  }
  return labels[status] || status
}

export default function CalendarPage() {
  const { dictionary, locale } = useI18n()
  const intlLocale = getIntlLocale(locale)

  const [items, setItems] = useState<CalendarItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<CalendarView>('month')
  const [itemFilter, setItemFilter] = useState<ItemFilter>('all')
  const [rangeMode, setRangeMode] = useState<RangeMode>('preset')
  const [range, setRange] = useState<RangeFilter>('7d')
  const [anchorDate, setAnchorDate] = useState<Date>(new Date())
  const [customFrom, setCustomFrom] = useState(formatDateInputValue(new Date()))
  const [customTo, setCustomTo] = useState(formatDateInputValue(addDays(new Date(), 6)))

  const formatDateTime = (value: string | null) => {
    if (!value) return dictionary.calendar.noTime
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return dictionary.calendar.invalidDate
    return new Intl.DateTimeFormat(intlLocale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  const formatTime = (value: string | null) => {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '-'
    return new Intl.DateTimeFormat(intlLocale, { hour: '2-digit', minute: '2-digit' }).format(date)
  }

  const formatDayLabel = (date: Date) =>
    new Intl.DateTimeFormat(intlLocale, { weekday: 'long', day: '2-digit', month: '2-digit' }).format(date)

  const formatShortDayLabel = (date: Date) =>
    new Intl.DateTimeFormat(intlLocale, { weekday: 'short', day: '2-digit', month: '2-digit' }).format(date)

  const formatMonthLabel = (date: Date) =>
    new Intl.DateTimeFormat(intlLocale, { month: 'long', year: 'numeric' }).format(date)

  const getItemDayTimeLabel = (item: CalendarItem, day: Date) => {
    const start = getItemStart(item)
    const end = getItemEnd(item)
    if (!start || !end) return dictionary.calendar.noTime
    const startsToday = isSameDay(start, day)
    const endsToday = isSameDay(end, day)
    if (startsToday && endsToday) return `${formatTime(item.start_at)} - ${formatTime(item.end_at)}`
    if (startsToday) return `${dictionary.calendar.startsAt} ${formatTime(item.start_at)}`
    if (endsToday) return `${dictionary.calendar.endsAt} ${formatTime(item.end_at)}`
    return dictionary.calendar.allDayOrContinues
  }

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
        setError(dictionary.calendar.loadError)
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
        setError(dictionary.calendar.loadError)
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

      const merged = [...mappedJobs, ...mappedEvents].sort(
        (a, b) => (getItemStart(a)?.getTime() ?? 0) - (getItemStart(b)?.getTime() ?? 0)
      )
      setItems(merged)
      setLoading(false)
    }

    void loadCalendar()
  }, [dictionary.calendar.loadError, dictionary.calendar.untitledEvent, dictionary.calendar.untitledJob])

  const presetBounds = useMemo(() => getRangeBoundsFromPreset(view, range, anchorDate), [view, range, anchorDate])
  const customBounds = useMemo(() => {
    const from = parseDateInput(customFrom, false)
    const to = parseDateInput(customTo, true)
    if (!from || !to) return null
    return from > to ? { from: startOfDay(to), to: endOfDay(from) } : { from, to }
  }, [customFrom, customTo])

  const bounds = useMemo(
    () => (rangeMode === 'custom' && customBounds ? customBounds : presetBounds),
    [rangeMode, customBounds, presetBounds]
  )

  const filteredItems = useMemo(
    () =>
      items
        .filter((item) => {
          const matchesFilter =
            itemFilter === 'jobs' ? item.type === 'job' : itemFilter === 'events' ? item.type === 'event' : true
          return matchesFilter && itemOverlapsRange(item, bounds.from, bounds.to)
        })
        .sort((a, b) => (getItemStart(a)?.getTime() ?? 0) - (getItemStart(b)?.getTime() ?? 0)),
    [items, itemFilter, bounds]
  )

  const listDays = useMemo(() => getDaysInRange(bounds.from, bounds.to), [bounds])
  const weekDays = useMemo(() => getDaysInRange(bounds.from, bounds.to), [bounds])
  const monthGridDays = useMemo(() => getMonthGridDays(anchorDate), [anchorDate])
  const today = useMemo(() => new Date(), [])

  const stats = useMemo(() => {
    const todayItems = items.filter((item) => itemOccursOnDay(item, today)).length
    const weekBounds = { from: startOfWeek(today), to: endOfWeek(today) }
    return {
      total: filteredItems.length,
      today: todayItems,
      week: items.filter((item) => itemOverlapsRange(item, weekBounds.from, weekBounds.to)).length,
      jobs: filteredItems.filter((item) => item.type === 'job').length,
      tasks: filteredItems.filter((item) => item.type === 'event').length,
    }
  }, [filteredItems, items, today])

  function goPrev() {
    if (view === 'week') {
      setAnchorDate((prev) => addDays(prev, -7))
      return
    }
    if (view === 'month') {
      setAnchorDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
    }
  }

  function goNext() {
    if (view === 'week') {
      setAnchorDate((prev) => addDays(prev, 7))
      return
    }
    if (view === 'month') {
      setAnchorDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
    }
  }

  function goToday() {
    const now = new Date()
    setAnchorDate(now)
    if (rangeMode === 'custom') {
      setCustomFrom(formatDateInputValue(now))
      setCustomTo(formatDateInputValue(addDays(now, 6)))
    }
  }

  function CalendarItemCard({ item, activeDay }: { item: CalendarItem; activeDay?: Date }) {
    const tone = getItemTone(item, dictionary.calendar)
    const multiDay = isMultiDayItem(item)

    return (
      <Link href={getItemHref(item)} className="calendar-card-link">
        <article className="calendar-list-card" style={{ borderLeftColor: tone.accent }}>
          <div className="calendar-list-card-main">
            <div className="calendar-time-pill" style={{ background: tone.accentSoft, color: tone.accent }}>
              {activeDay ? getItemDayTimeLabel(item, activeDay) : formatTime(item.start_at)}
            </div>
            <div>
              <div className="calendar-card-title">{item.title}</div>
              <div className="calendar-card-meta">
                {item.customerName ? <span>{item.customerName}</span> : null}
                {item.type === 'job' && item.status ? <span>{getStatusLabel(item.status, dictionary.calendar)}</span> : null}
                {multiDay ? <span>{dictionary.calendar.multiDay}</span> : null}
              </div>
              {item.description ? <p className="calendar-card-description">{item.description}</p> : null}
            </div>
          </div>
          <span className="calendar-type-badge" style={{ background: tone.chipBg, color: tone.chipColor }}>
            {tone.label}
          </span>
        </article>
      </Link>
    )
  }

  function WeekItemCard({ item, day }: { item: CalendarItem; day: Date }) {
    const tone = getItemTone(item, dictionary.calendar)

    return (
      <Link href={getItemHref(item)} className="calendar-card-link">
        <article className="calendar-week-item" style={{ borderLeftColor: tone.accent }}>
          <div className="calendar-week-time">{getItemDayTimeLabel(item, day)}</div>
          <div className="calendar-week-title">{item.title}</div>
          <div className="calendar-week-meta">{tone.label}</div>
        </article>
      </Link>
    )
  }

  function MonthItemChip({ item, day }: { item: CalendarItem; day: Date }) {
    const tone = getItemTone(item, dictionary.calendar)

    return (
      <Link
        href={getItemHref(item)}
        className="calendar-month-chip"
        style={{ borderLeftColor: tone.accent, background: tone.chipBg }}
        title={`${item.title} | ${getItemDayTimeLabel(item, day)}`}
      >
        <span>{formatTime(item.start_at)}</span>
        <strong>{item.title}</strong>
      </Link>
    )
  }

  return (
    <DashboardShell activeItem="calendar">
      <section className="calendar-hero">
        <div>
          <div className="calendar-eyebrow">{dictionary.calendar.planning}</div>
          <h1>{dictionary.calendar.title}</h1>
          <p>{dictionary.calendar.subtitle}</p>
        </div>

        <div className="calendar-hero-side">
          <div className="calendar-mini-stat">
            <span>{dictionary.calendar.today}</span>
            <strong>{stats.today}</strong>
          </div>
          <div className="calendar-mini-stat">
            <span>{dictionary.calendar.thisWeek}</span>
            <strong>{stats.week}</strong>
          </div>
          <Link href="/calendar/new" className="calendar-primary-action" data-tour="calendar-new-button">
            + {dictionary.calendar.addEvent}
          </Link>
        </div>
      </section>

      <section className="calendar-toolbar">
        <div className="calendar-toolbar-top">
          <div className="calendar-tabs" aria-label={dictionary.calendar.calendarView} data-tour="calendar-view-switcher">
            {(['list', 'week', 'month'] as CalendarView[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setView(mode)
                  if (mode !== 'list') setRangeMode('preset')
                }}
                className={view === mode ? 'active' : ''}
              >
                {mode === 'list' ? dictionary.calendar.list : mode === 'week' ? dictionary.calendar.week : dictionary.calendar.month}
              </button>
            ))}
          </div>

          <div className="calendar-period-title">
            {view === 'list'
              ? `${formatDayLabel(bounds.from)} - ${formatDayLabel(bounds.to)}`
              : view === 'week'
                ? `${formatDayLabel(bounds.from)} - ${formatDayLabel(bounds.to)}`
                : formatMonthLabel(anchorDate)}
          </div>
        </div>

        <div className="calendar-filter-grid" data-tour="calendar-filters">
          <select value={itemFilter} onChange={(e) => setItemFilter(e.target.value as ItemFilter)}>
            <option value="all">{dictionary.calendar.allItems}</option>
            <option value="jobs">{dictionary.calendar.jobsOnly}</option>
            <option value="events">{dictionary.calendar.eventsOnly}</option>
          </select>

          {view === 'list' ? (
            <div className="calendar-segment">
              <button type="button" onClick={() => setRangeMode('preset')} className={rangeMode === 'preset' ? 'active' : ''}>
                {dictionary.calendar.quickSelection}
              </button>
              <button type="button" onClick={() => setRangeMode('custom')} className={rangeMode === 'custom' ? 'active' : ''}>
                {dictionary.calendar.customRange}
              </button>
            </div>
          ) : null}

          {view === 'list' && rangeMode === 'preset' ? (
            <select value={range} onChange={(e) => setRange(e.target.value as RangeFilter)}>
              <option value="today">{dictionary.calendar.today}</option>
              <option value="7d">{dictionary.calendar.days7}</option>
              <option value="14d">{dictionary.calendar.days14}</option>
              <option value="30d">{dictionary.calendar.days30}</option>
            </select>
          ) : null}

          {view === 'list' && rangeMode === 'custom' ? (
            <div className="calendar-date-range">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label={dictionary.calendar.from} />
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label={dictionary.calendar.to} />
            </div>
          ) : null}

          {view === 'week' || view === 'month' ? (
            <div className="calendar-nav-buttons">
              <button type="button" onClick={goPrev}>{dictionary.calendar.previous}</button>
              <button type="button" onClick={goToday}>{dictionary.calendar.today}</button>
              <button type="button" onClick={goNext}>{dictionary.calendar.next}</button>
            </div>
          ) : null}
        </div>

        <div className="calendar-stat-row">
          <div><span>{dictionary.calendar.inPeriod}</span><strong>{stats.total}</strong></div>
          <div><span>{dictionary.navigation.jobs}</span><strong>{stats.jobs}</strong></div>
          <div><span>{dictionary.calendar.tasks}</span><strong>{stats.tasks}</strong></div>
        </div>
      </section>

      {loading ? (
        <div className="calendar-state-card">{dictionary.calendar.loading}</div>
      ) : error ? (
        <div className="calendar-state-card error">{error}</div>
      ) : filteredItems.length === 0 ? (
        <div className="calendar-empty" data-tour="calendar-items">
          <div className="calendar-empty-icon">K</div>
          <div>
            <h2>{dictionary.calendar.empty}</h2>
            <p>{dictionary.calendar.emptyDescription}</p>
            <Link href="/calendar/new" data-tour="calendar-new-button">{dictionary.calendar.addEvent}</Link>
          </div>
        </div>
      ) : view === 'list' ? (
        <div className="calendar-list-view" data-tour="calendar-items">
          {listDays.map((day) => {
            const dayItems = filteredItems.filter((item) => itemOccursOnDay(item, day))
            if (dayItems.length === 0) return null

            return (
              <section key={day.toISOString()} className="calendar-day-section">
                <header>
                  <div>
                    <span>{new Intl.DateTimeFormat(intlLocale, { weekday: 'long' }).format(day)}</span>
                    <strong>{new Intl.DateTimeFormat(intlLocale, { day: '2-digit', month: '2-digit' }).format(day)}</strong>
                  </div>
                  <em>{dayItems.length} {dictionary.calendar.itemsCount}</em>
                </header>
                <div className="calendar-list-stack">
                  {dayItems.map((item) => (
                    <CalendarItemCard key={`${item.type}-${item.id}-${day.toISOString()}`} item={item} activeDay={day} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ) : view === 'week' ? (
        <div className="calendar-week-view" data-tour="calendar-items">
          {weekDays.map((day) => {
            const dayItems = filteredItems.filter((item) => itemOccursOnDay(item, day))
            const isTodayFlag = isSameDay(day, today)

            return (
              <section key={day.toISOString()} className={isTodayFlag ? 'calendar-week-day today' : 'calendar-week-day'}>
                <header>
                  <span>{new Intl.DateTimeFormat(intlLocale, { weekday: 'short' }).format(day)}</span>
                  <strong>{day.getDate()}</strong>
                  <em>{dayItems.length}</em>
                </header>
                <div className="calendar-week-stack">
                  {dayItems.length === 0 ? (
                    <div className="calendar-muted-empty">{dictionary.calendar.nothingPlanned}</div>
                  ) : (
                    dayItems.map((item) => (
                      <WeekItemCard key={`${item.type}-${item.id}-${day.toISOString()}`} item={item} day={day} />
                    ))
                  )}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="calendar-month-view" data-tour="calendar-items">
          <div className="calendar-month-weekdays">
            {Array.from({ length: 7 }, (_, index) =>
              new Intl.DateTimeFormat(intlLocale, { weekday: 'short' }).format(new Date(2026, 0, 5 + index))
            ).map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>
          <div className="calendar-month-grid">
            {monthGridDays.map((day) => {
              const dayItems = filteredItems.filter((item) => itemOccursOnDay(item, day))
              const inCurrentMonth = day.getMonth() === anchorDate.getMonth()
              const isTodayFlag = isSameDay(day, today)

              return (
                <section
                  key={day.toISOString()}
                  className={[
                    'calendar-month-cell',
                    inCurrentMonth ? '' : 'muted',
                    isTodayFlag ? 'today' : '',
                  ].join(' ')}
                >
                  <header>
                    <strong>{day.getDate()}</strong>
                    {dayItems.length > 0 ? <span>{dayItems.length}</span> : null}
                  </header>
                  <div className="calendar-month-items">
                    {dayItems.slice(0, 3).map((item) => (
                      <MonthItemChip key={`${item.type}-${item.id}-${day.toISOString()}`} item={item} day={day} />
                    ))}
                    {dayItems.length > 3 ? <div className="calendar-month-more">+{dayItems.length - 3} {dictionary.calendar.moreItems}</div> : null}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}

      <style jsx global>{`
        .calendar-hero {
          position: relative;
          overflow: hidden;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          margin-bottom: 12px;
          padding: 18px 20px;
          border-radius: 20px;
          background: linear-gradient(135deg, rgba(250,245,255,0.98) 0%, rgba(239,246,255,0.96) 52%, rgba(236,254,255,0.92) 100%);
          border: 1px solid rgba(203, 213, 225, 0.78);
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.065);
        }

        .calendar-hero h1 {
          margin: 0;
          color: #0f172a;
          font-size: 32px;
          font-weight: 900;
          line-height: 1.08;
          letter-spacing: 0;
        }

        .calendar-hero p {
          max-width: 560px;
          margin: 7px 0 0;
          color: #475569;
          font-size: 14px;
          line-height: 1.45;
        }

        .calendar-eyebrow {
          display: inline-flex;
          margin-bottom: 8px;
          padding: 4px 9px;
          border: 1px solid rgba(124,58,237,0.22);
          border-radius: 999px;
          background: rgba(255,255,255,0.72);
          color: #5b21b6;
          font-size: 11px;
          font-weight: 900;
        }

        .calendar-hero-side {
          display: grid;
          grid-template-columns: repeat(2, minmax(90px, 1fr));
          gap: 8px;
          min-width: min(360px, 100%);
        }

        .calendar-mini-stat {
          padding: 9px 11px;
          border: 1px solid rgba(226,232,240,0.9);
          border-radius: 14px;
          background: rgba(255,255,255,0.78);
          box-shadow: 0 8px 18px rgba(15,23,42,0.045);
        }

        .calendar-mini-stat span,
        .calendar-stat-row span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }

        .calendar-mini-stat strong {
          display: block;
          margin-top: 2px;
          color: #0f172a;
          font-size: 22px;
          font-weight: 900;
        }

        .calendar-primary-action {
          grid-column: 1 / -1;
          display: inline-flex;
          min-height: 36px;
          align-items: center;
          justify-content: center;
          padding: 8px 12px;
          border-radius: 999px;
          background: linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%);
          color: #fff;
          text-decoration: none;
          font-size: 14px;
          font-weight: 900;
          box-shadow: 0 10px 22px rgba(37,99,235,0.16);
        }

        .calendar-toolbar,
        .calendar-state-card,
        .calendar-empty,
        .calendar-day-section,
        .calendar-month-view {
          border: 1px solid rgba(226,232,240,0.92);
          border-radius: 26px;
          background: rgba(255,255,255,0.9);
          box-shadow: 0 16px 40px rgba(15,23,42,0.07);
        }

        .calendar-toolbar {
          display: grid;
          gap: 18px;
          margin-bottom: 22px;
          padding: 22px;
          backdrop-filter: blur(14px);
        }

        .calendar-toolbar-top,
        .calendar-filter-grid,
        .calendar-stat-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
        }

        .calendar-tabs,
        .calendar-segment,
        .calendar-nav-buttons {
          display: inline-flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .calendar-tabs button,
        .calendar-segment button,
        .calendar-nav-buttons button,
        .calendar-filter-grid select,
        .calendar-date-range input {
          min-height: 46px;
          border: 1px solid #d1d5db;
          border-radius: 999px;
          background: #fff;
          color: #111827;
          padding: 10px 16px;
          font-size: 15px;
          font-weight: 850;
          cursor: pointer;
        }

        .calendar-filter-grid select,
        .calendar-date-range input {
          border-radius: 14px;
          font-weight: 750;
          cursor: auto;
        }

        .calendar-tabs button.active,
        .calendar-segment button.active {
          border-color: transparent;
          background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);
          color: #fff;
          box-shadow: 0 12px 24px rgba(37,99,235,0.18);
        }

        .calendar-period-title {
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
          text-transform: capitalize;
        }

        .calendar-date-range {
          display: inline-flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .calendar-stat-row {
          justify-content: flex-start;
        }

        .calendar-stat-row div {
          min-width: 150px;
          padding: 14px 16px;
          border: 1px solid rgba(226,232,240,0.9);
          border-radius: 18px;
          background: linear-gradient(145deg, #ffffff, #f8fbff);
        }

        .calendar-stat-row strong {
          display: block;
          margin-top: 4px;
          color: #0f172a;
          font-size: 26px;
          font-weight: 950;
        }

        .calendar-state-card,
        .calendar-empty {
          padding: 24px;
        }

        .calendar-state-card.error {
          border-color: #fecaca;
          color: #b91c1c;
          background: #fff7f7;
        }

        .calendar-empty {
          display: flex;
          gap: 16px;
          align-items: flex-start;
        }

        .calendar-empty h2 {
          margin: 0 0 6px;
          color: #0f172a;
          font-size: 22px;
          font-weight: 900;
        }

        .calendar-empty p {
          margin: 0;
          color: #64748b;
        }

        .calendar-empty a {
          display: inline-flex;
          margin-top: 14px;
          padding: 10px 14px;
          border-radius: 999px;
          background: linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%);
          color: #fff;
          text-decoration: none;
          font-weight: 900;
        }

        .calendar-empty-icon {
          flex: 0 0 auto;
          width: 48px;
          height: 48px;
          border-radius: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, rgba(124,58,237,0.14), rgba(6,182,212,0.18));
          color: #2563eb;
          font-weight: 950;
        }

        .calendar-list-view {
          display: grid;
          gap: 18px;
        }

        .calendar-day-section {
          padding: 18px;
        }

        .calendar-day-section > header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }

        .calendar-day-section header span,
        .calendar-day-section header em {
          color: #64748b;
          font-size: 13px;
          font-style: normal;
          font-weight: 800;
          text-transform: capitalize;
        }

        .calendar-day-section header strong {
          display: block;
          color: #0f172a;
          font-size: 22px;
          font-weight: 950;
        }

        .calendar-list-stack,
        .calendar-week-stack {
          display: grid;
          gap: 12px;
        }

        .calendar-card-link {
          display: block;
          color: inherit;
          text-decoration: none;
        }

        .calendar-list-card {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          padding: 18px;
          border: 1px solid rgba(226,232,240,0.92);
          border-left: 6px solid;
          border-radius: 22px;
          background: #ffffff;
          box-shadow: 0 12px 30px rgba(15,23,42,0.06);
          transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
          cursor: pointer;
        }

        .calendar-list-card:hover,
        .calendar-week-item:hover,
        .calendar-month-cell:hover {
          transform: translateY(-2px);
          box-shadow: 0 18px 44px rgba(15,23,42,0.1);
        }

        .calendar-list-card-main {
          display: flex;
          gap: 14px;
          min-width: 0;
        }

        .calendar-time-pill,
        .calendar-type-badge {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 34px;
          padding: 0 12px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 900;
          white-space: nowrap;
        }

        .calendar-card-title {
          color: #0f172a;
          font-size: 20px;
          font-weight: 950;
          line-height: 1.2;
        }

        .calendar-card-meta {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 7px;
          color: #64748b;
          font-size: 13px;
          font-weight: 750;
        }

        .calendar-card-meta span:not(:last-child)::after {
          content: "";
          display: inline-block;
          width: 4px;
          height: 4px;
          margin-left: 8px;
          border-radius: 999px;
          background: #cbd5e1;
          vertical-align: middle;
        }

        .calendar-card-description {
          margin: 10px 0 0;
          color: #475569;
          font-size: 14px;
          line-height: 1.45;
          white-space: pre-wrap;
        }

        .calendar-week-view {
          display: grid;
          grid-template-columns: repeat(7, minmax(150px, 1fr));
          gap: 12px;
          overflow-x: auto;
          padding-bottom: 4px;
        }

        .calendar-week-day {
          min-height: 360px;
          padding: 14px;
          border: 1px solid rgba(226,232,240,0.92);
          border-radius: 24px;
          background: rgba(255,255,255,0.9);
          box-shadow: 0 14px 32px rgba(15,23,42,0.055);
        }

        .calendar-week-day.today {
          border-color: rgba(37,99,235,0.28);
          background: linear-gradient(180deg, rgba(239,246,255,0.95), #ffffff);
        }

        .calendar-week-day > header {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 2px 8px;
          align-items: center;
          margin-bottom: 14px;
        }

        .calendar-week-day header span {
          color: #64748b;
          font-size: 13px;
          font-weight: 850;
          text-transform: capitalize;
        }

        .calendar-week-day header strong {
          color: #0f172a;
          font-size: 30px;
          font-weight: 950;
        }

        .calendar-week-day header em {
          grid-row: 1 / span 2;
          grid-column: 2;
          display: inline-flex;
          min-width: 30px;
          height: 30px;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: #f1f5f9;
          color: #334155;
          font-style: normal;
          font-weight: 900;
        }

        .calendar-week-item {
          padding: 12px;
          border: 1px solid rgba(226,232,240,0.92);
          border-left: 5px solid;
          border-radius: 16px;
          background: #fff;
          box-shadow: 0 10px 22px rgba(15,23,42,0.045);
          transition: transform 160ms ease, box-shadow 160ms ease;
        }

        .calendar-week-time,
        .calendar-week-meta {
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }

        .calendar-week-title {
          margin: 5px 0;
          color: #0f172a;
          font-size: 14px;
          font-weight: 950;
          line-height: 1.25;
        }

        .calendar-muted-empty {
          padding: 18px 10px;
          border: 1px dashed #dbe3ef;
          border-radius: 16px;
          color: #94a3b8;
          text-align: center;
          font-weight: 800;
        }

        .calendar-month-view {
          padding: 18px;
        }

        .calendar-month-weekdays,
        .calendar-month-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 10px;
        }

        .calendar-month-weekdays {
          margin-bottom: 10px;
        }

        .calendar-month-weekdays div {
          padding: 8px 4px;
          color: #475569;
          font-weight: 900;
          text-align: center;
          text-transform: capitalize;
        }

        .calendar-month-cell {
          min-height: 142px;
          padding: 10px;
          border: 1px solid rgba(226,232,240,0.95);
          border-radius: 18px;
          background: #ffffff;
          box-shadow: 0 8px 20px rgba(15,23,42,0.035);
          transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
        }

        .calendar-month-cell.muted {
          background: #f8fafc;
          opacity: 0.62;
        }

        .calendar-month-cell.today {
          border-color: rgba(37,99,235,0.38);
          background: linear-gradient(180deg, rgba(239,246,255,0.95), #ffffff);
        }

        .calendar-month-cell header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .calendar-month-cell header strong {
          display: inline-flex;
          width: 30px;
          height: 30px;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          color: #0f172a;
          font-size: 16px;
          font-weight: 950;
        }

        .calendar-month-cell.today header strong {
          background: #0f172a;
          color: #fff;
        }

        .calendar-month-cell header span {
          display: inline-flex;
          min-width: 26px;
          height: 26px;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: #eef2ff;
          color: #4338ca;
          font-size: 12px;
          font-weight: 950;
        }

        .calendar-month-items {
          display: grid;
          gap: 6px;
        }

        .calendar-month-chip {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 6px;
          align-items: center;
          min-height: 28px;
          padding: 5px 7px;
          border-left: 4px solid;
          border-radius: 10px;
          color: #0f172a;
          text-decoration: none;
          overflow: hidden;
        }

        .calendar-month-chip span {
          color: #475569;
          font-size: 11px;
          font-weight: 900;
        }

        .calendar-month-chip strong {
          overflow: hidden;
          color: #0f172a;
          font-size: 12px;
          font-weight: 900;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .calendar-month-more {
          color: #64748b;
          font-size: 12px;
          font-weight: 850;
          padding-left: 6px;
        }

        @media (max-width: 1024px) {
          .calendar-hero {
            align-items: stretch;
            flex-direction: column;
          }

          .calendar-week-view {
            grid-template-columns: repeat(7, minmax(210px, 1fr));
          }
        }

        @media (max-width: 768px) {
          .calendar-hero,
          .calendar-toolbar,
          .calendar-day-section,
          .calendar-month-view {
            border-radius: 20px;
            padding: 18px;
          }

          .calendar-hero h1 {
            font-size: 30px;
          }

          .calendar-hero p {
            font-size: 14px;
          }

          .calendar-hero-side {
            grid-template-columns: 1fr;
          }

          .calendar-toolbar-top,
          .calendar-filter-grid {
            align-items: stretch;
            flex-direction: column;
          }

          .calendar-tabs,
          .calendar-segment,
          .calendar-nav-buttons,
          .calendar-filter-grid select,
          .calendar-date-range,
          .calendar-date-range input {
            width: 100%;
          }

          .calendar-tabs button,
          .calendar-segment button,
          .calendar-nav-buttons button {
            flex: 1 1 0;
          }

          .calendar-stat-row div {
            flex: 1 1 140px;
          }

          .calendar-list-card,
          .calendar-list-card-main {
            flex-direction: column;
          }

          .calendar-type-badge,
          .calendar-time-pill {
            width: fit-content;
          }

          .calendar-month-weekdays,
          .calendar-month-grid {
            grid-template-columns: 1fr;
          }

          .calendar-month-weekdays {
            display: none;
          }

          .calendar-month-cell {
            min-height: auto;
          }
        }
      `}</style>
    </DashboardShell>
  )
}
