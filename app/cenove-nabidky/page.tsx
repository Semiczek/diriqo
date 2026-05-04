import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import {
  PrimaryAction,
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
import { getQuoteStatusLabel, resolveQuoteStatus } from '@/lib/quote-status'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getRequestDictionary } from '@/lib/i18n/server'

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

function formatCurrency(value: number | null | undefined) {
  if (value == null) return '—'
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('cs-CZ')
}

function getQuoteTone(status: ReturnType<typeof resolveQuoteStatus>) {
  if (status === 'accepted') return 'green'
  if (status === 'rejected' || status === 'expired') return 'red'
  if (status === 'sent' || status === 'viewed' || status === 'waiting_followup' || status === 'revision_requested') return 'orange'
  if (status === 'ready') return 'purple'
  return 'blue'
}

export default async function QuotesPage({ searchParams }: PageProps) {
  const dictionary = await getRequestDictionary()
  const { month: monthParam, status = 'all', customer = 'all' } = await searchParams
  const selectedMonth = resolveMonthValue(monthParam)
  const monthRange = getMonthDateRange(selectedMonth)
  const previousMonth = shiftMonthValue(selectedMonth, -1)
  const nextMonth = shiftMonthValue(selectedMonth, 1)
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return (
      <DashboardShell activeItem="quotes">
        <main style={pageShellStyle}>
          <div style={errorStateStyle}>
            Nemate pristup do interniho Hubu.
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
      <main style={pageShellStyle}>
        <section style={heroCardStyle}>
          <div style={heroContentStyle}>
            <div style={eyebrowStyle}>Prodej</div>
            <h1 style={heroTitleStyle}>{dictionary.quotesOverview.title}</h1>
            <p style={heroTextStyle}>{dictionary.quotesOverview.subtitle}</p>
          </div>
          <PrimaryAction href="/kalkulace">Vytvořit z kalkulace</PrimaryAction>
        </section>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            padding: '16px 20px',
            borderRadius: '16px',
            border: '1px solid #e5e7eb',
            backgroundColor: '#ffffff',
            marginBottom: '16px',
          }}
        >
          <Link
            href={buildMonthHref(previousMonth)}
            style={{
              color: '#111827',
              textDecoration: 'none',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            ← {dictionary.quotesOverview.previousMonth}
          </Link>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: 700 }}>
              {dictionary.quotesOverview.displayedMonth}
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800 }}>
              {formatMonthLabel(selectedMonth)}
            </div>
          </div>
          <Link
            href={buildMonthHref(nextMonth)}
            style={{
              color: '#111827',
              textDecoration: 'none',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {dictionary.quotesOverview.nextMonth} →
          </Link>
        </div>

        <form
          method="get"
          style={filterCardStyle}
        >
          <label style={fieldLabelStyle}>
            <span>{dictionary.quotesOverview.customer}</span>
            <select
              name="customer"
              defaultValue={customer}
              style={inputStyle}
            >
              <option value="all">{dictionary.quotesOverview.allCustomers}</option>
              {(customers as CustomerRow[] | null)?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name || dictionary.quotesOverview.unnamedCustomer}
                </option>
              ))}
            </select>
          </label>

          <label style={fieldLabelStyle}>
            <span>{dictionary.quotesOverview.month}</span>
            <input
              name="month"
              type="month"
              defaultValue={selectedMonth}
              style={inputStyle}
            />
          </label>

          <label style={fieldLabelStyle}>
            <span>{dictionary.quotesOverview.status}</span>
            <select
              name="status"
              defaultValue={status}
              style={inputStyle}
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
            style={{ ...primaryButtonStyle, cursor: 'pointer' }}
          >
            {dictionary.quotesOverview.filter}
          </button>
        </form>

        {error ? (
          <div style={errorStateStyle}>
            Data se nepodařilo načíst. Technický detail je v konzoli.
          </div>
        ) : normalizedQuotes.length === 0 ? (
          <div style={emptyStateStyle}>
            <div style={{ fontSize: '30px', marginBottom: '8px' }}>%</div>
            <h2 style={{ margin: '0 0 6px', color: '#0f172a' }}>{dictionary.quotesOverview.empty}</h2>
            <p style={{ margin: '0 0 16px' }}>Připrav nabídku z hotové kalkulace a sleduj reakce zákazníka.</p>
            <PrimaryAction href="/kalkulace">Přejít na kalkulace</PrimaryAction>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '14px' }}>
            {normalizedQuotes.map((quote) => (
              <Link
                key={quote.id}
                href={`/customers/${quote.customer_id}/quotes/${quote.id}`}
                style={resourceCardStyle}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '16px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ ...mutedTextStyle, marginBottom: '8px' }}>
                      {quote.quote_number}
                    </div>
                    <h2 style={cardTitleStyle}>{quote.title}</h2>
                    <div style={metaGridStyle}>
                      <div style={metaItemStyle}><span style={metaLabelStyle}>{dictionary.quotesOverview.customer}</span><span style={metaValueStyle}>{quote.customers?.name || '—'}</span></div>
                      <div style={metaItemStyle}><span style={metaLabelStyle}>{dictionary.quotesOverview.date}</span><span style={metaValueStyle}>{formatDate(quote.quote_date)}</span></div>
                      <div style={metaItemStyle}><span style={metaLabelStyle}>{dictionary.quotesOverview.validUntil}</span><span style={metaValueStyle}>{formatDate(quote.valid_until)}</span></div>
                      <div style={metaItemStyle}><span style={metaLabelStyle}>{dictionary.quotesOverview.price}</span><span style={metaValueStyle}>{formatCurrency(quote.total_price)}</span></div>
                    </div>
                  </div>

                  <StatusPill tone={getQuoteTone(quote.resolvedStatus)}>
                    {getQuoteStatusLabel(quote.resolvedStatus)}
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
