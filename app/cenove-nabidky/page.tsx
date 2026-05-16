import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import type { CSSProperties } from 'react'
import {
  StatusPill,
  cardTitleStyle,
  emptyStateStyle,
  errorStateStyle,
  eyebrowStyle,
  fieldLabelStyle,
  filterCardStyle,
  heroCardStyle,
  heroContentStyle,
  heroTextStyle,
  heroTitleStyle,
  inputStyle,
  metaGridStyle,
  metaItemStyle,
  metaLabelStyle,
  metaValueStyle,
  mutedTextStyle,
  pageShellStyle,
  primaryButtonStyle,
  resourceCardStyle,
} from '@/components/SaasPageLayout'
import { getActiveCompanyContext } from '@/lib/active-company'
import {
  formatMonthLabel,
  getMonthDateRange,
  resolveMonthValue,
  shiftMonthValue,
} from '@/lib/month-filter'
import { resolveQuoteStatus, type QuoteStatus } from '@/lib/quote-status'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getIntlLocale } from '@/lib/i18n/config'
import { getRequestDictionary, getRequestLocale } from '@/lib/i18n/server'
import type { TranslationDictionary } from '@/lib/i18n/dictionaries/types'

type PageProps = {
  searchParams: Promise<{
    month?: string
    status?: string
    customer?: string
  }>
}

type QuoteRow = {
  id: string
  customer_id: string
  quote_number: string
  title: string
  status: string | null
  quote_date: string | null
  valid_until: string | null
  total_price: number | null
  customers?:
    | {
        id: string
        name: string | null
      }[]
    | {
        id: string
        name: string | null
      }
    | null
}

type CustomerRow = {
  id: string
  name: string | null
}

function formatCurrency(value: number | null | undefined, locale: string) {
  if (value == null) return '—'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(locale)
}

function getQuoteTone(status: ReturnType<typeof resolveQuoteStatus>) {
  if (status === 'accepted') return 'green'
  if (status === 'rejected' || status === 'expired') return 'red'
  if (status === 'sent' || status === 'viewed' || status === 'waiting_followup' || status === 'revision_requested') return 'orange'
  if (status === 'ready') return 'purple'
  return 'blue'
}

function getLocalizedQuoteStatusLabel(status: QuoteStatus, dictionary: TranslationDictionary) {
  const labels = dictionary.customers.quotesList

  if (status === 'ready') return labels.ready
  if (status === 'sent') return labels.sent
  if (status === 'viewed') return labels.viewed
  if (status === 'waiting_followup') return labels.interested
  if (status === 'revision_requested') return labels.revisionRequested
  if (status === 'accepted') return labels.accepted
  if (status === 'rejected') return labels.rejected
  if (status === 'expired') return labels.expired
  return labels.draft
}

const compactPageShellStyle: CSSProperties = {
  ...pageShellStyle,
  gap: '12px',
  maxWidth: '1120px',
}

const compactHeroCardStyle: CSSProperties = {
  ...heroCardStyle,
  gap: '14px',
  padding: '18px 20px',
  borderRadius: '20px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.065)',
}

const compactHeroContentStyle: CSSProperties = {
  ...heroContentStyle,
  flex: '1 1 360px',
}

const compactEyebrowStyle: CSSProperties = {
  ...eyebrowStyle,
  marginBottom: '8px',
  padding: '4px 9px',
  fontSize: '11px',
}

const compactHeroTitleStyle: CSSProperties = {
  ...heroTitleStyle,
  fontSize: '32px',
  lineHeight: 1.08,
}

const compactHeroTextStyle: CSSProperties = {
  ...heroTextStyle,
  margin: '7px 0 0',
  fontSize: '14px',
  lineHeight: 1.45,
}

const compactPrimaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  minHeight: '36px',
  padding: '8px 12px',
  fontSize: '14px',
  boxShadow: '0 10px 22px rgba(37, 99, 235, 0.16)',
}

const compactMonthCardStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '10px',
  flexWrap: 'wrap',
  padding: '11px 14px',
  borderRadius: '14px',
  border: '1px solid #e5e7eb',
  backgroundColor: '#ffffff',
  marginBottom: '4px',
  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.035)',
}

const compactMonthLinkStyle: CSSProperties = {
  color: '#111827',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 750,
  whiteSpace: 'nowrap',
}

const compactFilterCardStyle: CSSProperties = {
  ...filterCardStyle,
  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  gap: '10px',
  padding: '13px',
  borderRadius: '16px',
  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.045)',
}

const compactFieldLabelStyle: CSSProperties = {
  ...fieldLabelStyle,
  gap: '5px',
  fontSize: '12px',
}

const compactInputStyle: CSSProperties = {
  ...inputStyle,
  padding: '9px 11px',
  borderRadius: '11px',
  fontSize: '13px',
}

const compactResourceCardStyle: CSSProperties = {
  ...resourceCardStyle,
  padding: '14px 15px',
  borderRadius: '16px',
  boxShadow: '0 9px 22px rgba(15, 23, 42, 0.045)',
}

const compactCardTitleStyle: CSSProperties = {
  ...cardTitleStyle,
  fontSize: '18px',
}

const compactMutedTextStyle: CSSProperties = {
  ...mutedTextStyle,
  fontSize: '12px',
}

const compactMetaGridStyle: CSSProperties = {
  ...metaGridStyle,
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
  gap: '8px',
  marginTop: '10px',
}

const compactMetaItemStyle: CSSProperties = {
  ...metaItemStyle,
  padding: '8px 10px',
  borderRadius: '12px',
}

const compactMetaLabelStyle: CSSProperties = {
  ...metaLabelStyle,
  marginBottom: '2px',
  fontSize: '11px',
}

const compactMetaValueStyle: CSSProperties = {
  ...metaValueStyle,
  fontSize: '13px',
}

const compactEmptyStateStyle: CSSProperties = {
  ...emptyStateStyle,
  padding: '20px',
  borderRadius: '16px',
}

export default async function QuotesPage({ searchParams }: PageProps) {
  const dictionary = await getRequestDictionary()
  const locale = await getRequestLocale()
  const intlLocale = getIntlLocale(locale)
  const { month: monthParam, status = 'all', customer = 'all' } = await searchParams
  const selectedMonth = resolveMonthValue(monthParam)
  const monthRange = getMonthDateRange(selectedMonth)
  const previousMonth = shiftMonthValue(selectedMonth, -1)
  const nextMonth = shiftMonthValue(selectedMonth, 1)
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return (
      <DashboardShell activeItem="quotes">
        <main style={compactPageShellStyle}>
          <div style={errorStateStyle}>
            {dictionary.auth.noHubAccess}
          </div>
        </main>
      </DashboardShell>
    )
  }

  const supabase = await createSupabaseServerClient()
  const buildMonthHref = (targetMonth: string) => {
    const params = new URLSearchParams({ month: targetMonth })

    if (customer !== 'all') params.set('customer', customer)
    if (status !== 'all') params.set('status', status)

    return `/cenove-nabidky?${params.toString()}`
  }

  const [{ data: customers }, quotesResult] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name')
      .eq('company_id', activeCompany.companyId)
      .order('name', { ascending: true })
      .limit(200),
    (async () => {
      let quotesQuery = supabase
        .from('quotes')
        .select(
          'id, customer_id, quote_number, title, status, quote_date, valid_until, total_price, customers(id, name)',
        )
        .eq('company_id', activeCompany.companyId)
        .gte('quote_date', monthRange.from)
        .lte('quote_date', monthRange.to)
        .order('quote_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (status !== 'all') {
        quotesQuery = quotesQuery.eq('status', status)
      }

      if (customer !== 'all') {
        quotesQuery = quotesQuery.eq('customer_id', customer)
      }

      return quotesQuery
    })(),
  ])

  const { data: quotes, error } = quotesResult

  const normalizedQuotes = ((quotes ?? []) as QuoteRow[]).map((quote) => ({
    ...quote,
    customers: Array.isArray(quote.customers) ? quote.customers[0] ?? null : quote.customers ?? null,
    resolvedStatus: resolveQuoteStatus(quote.status, quote.valid_until),
  })) as Array<
    Omit<QuoteRow, 'customers'> & {
      customers: {
        id: string
        name: string | null
      } | null
      resolvedStatus: ReturnType<typeof resolveQuoteStatus>
    }
  >

  return (
    <DashboardShell activeItem="quotes">
      <main style={compactPageShellStyle}>
        <section style={compactHeroCardStyle}>
          <div style={compactHeroContentStyle}>
            <div style={compactEyebrowStyle}>{dictionary.quotesOverview.eyebrow}</div>
            <h1 style={compactHeroTitleStyle}>{dictionary.quotesOverview.title}</h1>
            <p style={compactHeroTextStyle}>{dictionary.quotesOverview.subtitle}</p>
          </div>
          <Link href="/kalkulace" style={compactPrimaryButtonStyle}>
            {dictionary.quotesOverview.createFromCalculation}
          </Link>
        </section>

        <div
          style={compactMonthCardStyle}
        >
          <Link
            href={buildMonthHref(previousMonth)}
            style={compactMonthLinkStyle}
          >
            ← {dictionary.quotesOverview.previousMonth}
          </Link>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 750 }}>
              {dictionary.quotesOverview.displayedMonth}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 820 }}>
              {formatMonthLabel(selectedMonth, intlLocale)}
            </div>
          </div>
          <Link
            href={buildMonthHref(nextMonth)}
            style={compactMonthLinkStyle}
          >
            {dictionary.quotesOverview.nextMonth} →
          </Link>
        </div>

        <form
          method="get"
          style={compactFilterCardStyle}
        >
          <label style={compactFieldLabelStyle}>
            <span>{dictionary.quotesOverview.customer}</span>
            <select
              name="customer"
              defaultValue={customer}
              style={compactInputStyle}
            >
              <option value="all">{dictionary.quotesOverview.allCustomers}</option>
              {(customers as CustomerRow[] | null)?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name || dictionary.quotesOverview.unnamedCustomer}
                </option>
              ))}
            </select>
          </label>

          <label style={compactFieldLabelStyle}>
            <span>{dictionary.quotesOverview.month}</span>
            <input
              name="month"
              type="month"
              defaultValue={selectedMonth}
              style={compactInputStyle}
            />
          </label>

          <label style={compactFieldLabelStyle}>
            <span>{dictionary.quotesOverview.status}</span>
            <select
              name="status"
              defaultValue={status}
              style={compactInputStyle}
            >
              <option value="all">{dictionary.quotesOverview.all}</option>
              <option value="draft">{dictionary.customers.quotesList.draft}</option>
              <option value="ready">{dictionary.customers.quotesList.ready}</option>
              <option value="sent">{dictionary.customers.quotesList.sent}</option>
              <option value="viewed">{dictionary.customers.quotesList.viewed}</option>
              <option value="accepted">{dictionary.customers.quotesList.accepted}</option>
              <option value="rejected">{dictionary.customers.quotesList.rejected}</option>
              <option value="expired">{dictionary.customers.quotesList.expired}</option>
            </select>
          </label>

          <button
            type="submit"
            style={{ ...compactPrimaryButtonStyle, cursor: 'pointer' }}
          >
            {dictionary.quotesOverview.filter}
          </button>
        </form>

        {error ? (
          <div style={errorStateStyle}>
            {dictionary.common.dataLoadFailed} {dictionary.common.technicalDetailConsole}
          </div>
        ) : normalizedQuotes.length === 0 ? (
          <div style={compactEmptyStateStyle}>
            <div style={{ fontSize: '24px', marginBottom: '6px' }}>%</div>
            <h2 style={{ margin: '0 0 6px', color: '#0f172a' }}>{dictionary.quotesOverview.empty}</h2>
            <p style={{ margin: '0 0 12px' }}>{dictionary.quotesOverview.emptyDescription}</p>
            <Link href="/kalkulace" style={compactPrimaryButtonStyle}>
              {dictionary.quotesOverview.goToCalculations}
            </Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {normalizedQuotes.map((quote) => (
              <Link
                key={quote.id}
                href={
                  quote.customer_id
                    ? `/customers/${quote.customer_id}/quotes/${quote.id}`
                    : `/cenove-nabidky/${quote.id}`
                }
                style={compactResourceCardStyle}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ ...compactMutedTextStyle, marginBottom: '5px' }}>
                      {quote.quote_number}
                    </div>
                    <h2 style={compactCardTitleStyle}>{quote.title}</h2>
                    <div style={compactMetaGridStyle}>
                      <div style={compactMetaItemStyle}><span style={compactMetaLabelStyle}>{dictionary.quotesOverview.customer}</span><span style={compactMetaValueStyle}>{quote.customers?.name || '—'}</span></div>
                      <div style={compactMetaItemStyle}><span style={compactMetaLabelStyle}>{dictionary.quotesOverview.date}</span><span style={compactMetaValueStyle}>{formatDate(quote.quote_date, intlLocale)}</span></div>
                      <div style={compactMetaItemStyle}><span style={compactMetaLabelStyle}>{dictionary.quotesOverview.validUntil}</span><span style={compactMetaValueStyle}>{formatDate(quote.valid_until, intlLocale)}</span></div>
                      <div style={compactMetaItemStyle}><span style={compactMetaLabelStyle}>{dictionary.quotesOverview.price}</span><span style={compactMetaValueStyle}>{formatCurrency(quote.total_price, intlLocale)}</span></div>
                    </div>
                  </div>

                  <StatusPill tone={getQuoteTone(quote.resolvedStatus)} style={{ padding: '5px 8px', fontSize: '11px' }}>
                    {getLocalizedQuoteStatusLabel(quote.resolvedStatus, dictionary)}
                  </StatusPill>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </DashboardShell>
  )
}
