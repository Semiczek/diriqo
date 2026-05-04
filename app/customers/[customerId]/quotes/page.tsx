import Link from 'next/link'
import type { CSSProperties } from 'react'
import DashboardShell from '@/components/DashboardShell'
import {
  SecondaryAction,
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
import { getRequestDictionary } from '@/lib/i18n/server'
import { getQuoteStatusLabel, getQuoteStatusStyle, resolveQuoteStatus } from '@/lib/quote-status'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type PageProps = {
  params: Promise<{
    customerId: string
  }>
  searchParams: Promise<{
    from?: string
    to?: string
    status?: string
  }>
}

type QuoteRow = {
  id: string
  quote_number: string
  title: string
  status: string | null
  quote_date: string | null
  valid_until: string | null
  total_price: number | null
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

const badgeBase: CSSProperties = {
  display: 'inline-block',
  height: 'fit-content',
  padding: '8px 12px',
  borderRadius: '999px',
  fontSize: '14px',
  fontWeight: 700,
  whiteSpace: 'nowrap',
}

function getQuoteTone(status: ReturnType<typeof resolveQuoteStatus>) {
  if (status === 'accepted') return 'green'
  if (status === 'rejected' || status === 'expired') return 'red'
  if (status === 'sent' || status === 'viewed' || status === 'waiting_followup' || status === 'revision_requested') return 'orange'
  if (status === 'ready') return 'purple'
  return 'blue'
}

export default async function CustomerQuotesPage({ params, searchParams }: PageProps) {
  const dictionary = await getRequestDictionary()
  const { customerId } = await params
  const { from = '', to = '', status = 'all' } = await searchParams
  const supabase = await createSupabaseServerClient()

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, name')
    .eq('id', customerId)
    .maybeSingle()

  if (customerError || !customer) {
    return (
      <DashboardShell activeItem="customers">
        <main style={pageShellStyle}>
          <p>{dictionary.customers.quotesList.customerNotFound}</p>
        </main>
      </DashboardShell>
    )
  }

  let quotesQuery = supabase
    .from('quotes')
    .select('id, quote_number, title, status, quote_date, valid_until, total_price')
    .eq('customer_id', customerId)
    .order('quote_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (from) {
    quotesQuery = quotesQuery.gte('quote_date', from)
  }

  if (to) {
    quotesQuery = quotesQuery.lte('quote_date', to)
  }

  if (status && status !== 'all') {
    quotesQuery = quotesQuery.eq('status', status)
  }

  const { data: quotes, error: quotesError } = await quotesQuery
  const normalizedQuotes = ((quotes ?? []) as QuoteRow[]).map((quote) => ({
    ...quote,
    resolvedStatus: resolveQuoteStatus(quote.status, quote.valid_until),
  }))

  return (
    <DashboardShell activeItem="customers">
      <main style={pageShellStyle}>
        <SecondaryAction href={`/customers/${customerId}`}>
          {dictionary.customers.quotesList.backToCustomer}
        </SecondaryAction>
        <section style={heroCardStyle}>
          <div style={heroContentStyle}>
            <div style={eyebrowStyle}>Nabídky</div>
            <h1 style={heroTitleStyle}>{dictionary.customers.quotesList.title}</h1>
            <p style={heroTextStyle}>{customer.name || dictionary.customers.quotesList.customerFallback}</p>
          </div>
        </section>

        <form
          method="get"
          style={filterCardStyle}
        >
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quotesList.from}</span>
            <input name="from" type="date" defaultValue={from} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quotesList.to}</span>
            <input name="to" type="date" defaultValue={to} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quotesList.status}</span>
            <select name="status" defaultValue={status} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }}>
              <option value="all">{dictionary.customers.quotesList.all}</option>
              <option value="draft">{dictionary.customers.quotesList.draft}</option>
              <option value="ready">{dictionary.customers.quotesList.ready}</option>
              <option value="sent">{dictionary.customers.quotesList.sent}</option>
              <option value="viewed">{dictionary.customers.quotesList.viewed}</option>
              <option value="waiting_followup">{dictionary.customers.quotesList.interested}</option>
              <option value="revision_requested">{dictionary.customers.quotesList.revisionRequested}</option>
              <option value="accepted">{dictionary.customers.quotesList.accepted}</option>
              <option value="rejected">{dictionary.customers.quotesList.rejected}</option>
              <option value="expired">{dictionary.customers.quotesList.expired}</option>
            </select>
          </label>
          <button
            type="submit"
            style={{
              padding: '12px 16px',
              borderRadius: '12px',
              border: 'none',
              backgroundColor: '#000000',
              color: '#ffffff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {dictionary.customers.quotesList.filter}
          </button>
        </form>

        {quotesError ? (
          <div style={{ border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '16px', padding: '20px' }}>
            {dictionary.customers.quotesList.loadFailed}: {quotesError.message}
          </div>
        ) : !normalizedQuotes || normalizedQuotes.length === 0 ? (
          <div style={{ border: '1px solid #e5e7eb', backgroundColor: '#ffffff', borderRadius: '16px', padding: '20px', color: '#6b7280' }}>
            {dictionary.customers.quotesList.empty}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '14px' }}>
            {normalizedQuotes.map((quote) => (
              <Link
                key={quote.id}
                href={`/customers/${customerId}/quotes/${quote.id}`}
                style={{
                  display: 'block',
                  textDecoration: 'none',
                  border: '1px solid #e5e7eb',
                  backgroundColor: '#ffffff',
                  borderRadius: '16px',
                  padding: '20px',
                  color: '#111827',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>{quote.quote_number}</div>
                    <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '10px' }}>{quote.title}</div>
                    <div style={{ color: '#4b5563', marginBottom: '6px' }}>
                      <strong>{dictionary.customers.quotesList.date}:</strong> {formatDate(quote.quote_date)}
                    </div>
                    <div style={{ color: '#4b5563', marginBottom: '6px' }}>
                      <strong>{dictionary.customers.quotesList.validUntil}:</strong> {formatDate(quote.valid_until)}
                    </div>
                    <div style={{ color: '#4b5563' }}>
                      <strong>{dictionary.customers.quotesList.price}:</strong> {formatCurrency(quote.total_price)}
                    </div>
                  </div>

                  <div
                    style={{
                      ...badgeBase,
                      ...getQuoteStatusStyle(quote.resolvedStatus),
                    }}
                  >
                    {getQuoteStatusLabel(quote.resolvedStatus)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </DashboardShell>
  )
}
