import React from 'react'
import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import {
  PrimaryAction,
  SecondaryAction,
  cardTitleStyle,
  emptyStateStyle,
  errorStateStyle,
  eyebrowStyle,
  heroCardStyle,
  heroContentStyle,
  heroTextStyle,
  heroTitleStyle,
  metaGridStyle,
  metaItemStyle,
  metaLabelStyle,
  metaValueStyle,
  mutedTextStyle,
  pageShellStyle,
  primaryButtonStyle,
  resourceCardStyle,
  secondaryButtonStyle,
  sectionCardStyle,
} from '@/components/SaasPageLayout'
import {
  getEffectiveJobWorkState,
  getVisibleBillingState,
  isMultiDayJobRange,
  resolveJobBillingState,
  resolveJobTimeState,
  resolveJobWorkState,
  resolveLegacyJobStatus,
} from '@/lib/job-status'
import type {
  BillingStateResolved,
  TimeState,
  WorkState,
} from '@/lib/job-status'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type CustomerDetailPageProps = {
  params: Promise<{
    customerId: string
  }>
}

type CustomerJobRow = {
  id: string
  title: string | null
  status: string | null
  price: number | null
  start_at: string | null
  end_at: string | null
  created_at: string | null
  time_state: TimeState | null
  work_state: WorkState | null
  billing_state_resolved: BillingStateResolved | null
}

type CustomerCalculationRow = {
  id: string
  title: string
  status: 'draft' | 'ready' | 'archived' | null
  calculation_date: string | null
  total_price: number | null
}

type CustomerQuoteRow = {
  id: string
  quote_number: string
  title: string
  status: 'draft' | 'ready' | 'sent' | 'accepted' | 'rejected' | null
  quote_date: string | null
  total_price: number | null
}

type CustomerDetailRow = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  created_at: string | null
  billing_name: string | null
  billing_street: string | null
  billing_city: string | null
  billing_postal_code: string | null
  billing_country: string | null
  company_number: string | null
  vat_number: string | null
  ares_last_checked_at: string | null
  lead_contact_name: string | null
  lead_source: string | null
  lead_locale: string | null
  lead_service_slug: string | null
  lead_message: string | null
  lead_page_url: string | null
  lead_referrer: string | null
  lead_user_agent: string | null
  lead_submitted_at: string | null
}

function isMissingCustomerBillingColumns(error: { message?: string | null } | null | undefined) {
  const message = error?.message ?? ''
  return (
    message.includes('billing_name') ||
    message.includes('billing_street') ||
    message.includes('billing_city') ||
    message.includes('billing_postal_code') ||
    message.includes('billing_country') ||
    message.includes('company_number') ||
    message.includes('vat_number') ||
    message.includes('ares_last_checked_at') ||
    message.includes('lead_contact_name') ||
    message.includes('lead_source') ||
    message.includes('lead_locale') ||
    message.includes('lead_service_slug') ||
    message.includes('lead_message') ||
    message.includes('lead_page_url') ||
    message.includes('lead_referrer') ||
    message.includes('lead_user_agent') ||
    message.includes('lead_submitted_at')
  )
}

function formatPrice(value: number | null | undefined) {
  if (value == null) return '—'

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function getTimeStateLabel(state: TimeState) {
  if (state === 'future') return 'Budoucí'
  if (state === 'active') return 'V termínu'
  if (state === 'finished') return 'Hotovo'
  return 'Neznámý čas'
}

function getWorkStateLabel(state: WorkState) {
  if (state === 'not_started') return 'Nezahájeno'
  if (state === 'in_progress') return 'Probíhá'
  if (state === 'partially_done') return 'Částečně hotovo'
  if (state === 'done') return 'Hotovo'
  return 'Neznámý provoz'
}

function getBillingStateLabel(state: BillingStateResolved) {
  if (state === 'waiting_for_invoice') return 'Čeká na fakturaci'
  if (state === 'due') return 'Ve splatnosti'
  if (state === 'overdue') return 'Po splatnosti'
  if (state === 'paid') return 'Zaplaceno'
  return 'Neznámá fakturace'
}

function getDisplayTimeStateLabel(state: TimeState) {
  if (state === 'finished') return 'Hotovo'
  return getTimeStateLabel(state)
}

function getTimeStateStyles(state: TimeState): React.CSSProperties {
  if (state === 'future') {
    return {
      backgroundColor: '#dbeafe',
      color: '#1d4ed8',
      border: '1px solid #bfdbfe',
    }
  }

  if (state === 'active') {
    return {
      backgroundColor: '#fef3c7',
      color: '#b45309',
      border: '1px solid #fde68a',
    }
  }

  if (state === 'finished') {
    return {
      backgroundColor: '#fee2e2',
      color: '#991b1b',
      border: '1px solid #fecaca',
    }
  }

  return {
    backgroundColor: '#e5e7eb',
    color: '#374151',
    border: '1px solid #d1d5db',
  }
}

function getWorkStateStyles(state: WorkState): React.CSSProperties {
  if (state === 'not_started') {
    return {
      backgroundColor: '#f3f4f6',
      color: '#374151',
      border: '1px solid #d1d5db',
    }
  }

  if (state === 'in_progress') {
    return {
      backgroundColor: '#fef3c7',
      color: '#92400e',
      border: '1px solid #fde68a',
    }
  }

  if (state === 'partially_done') {
    return {
      backgroundColor: '#ede9fe',
      color: '#6d28d9',
      border: '1px solid #ddd6fe',
    }
  }

  if (state === 'done') {
    return {
      backgroundColor: '#dcfce7',
      color: '#166534',
      border: '1px solid #bbf7d0',
    }
  }

  return {
    backgroundColor: '#e5e7eb',
    color: '#374151',
    border: '1px solid #d1d5db',
  }
}

function getBillingStateStyles(state: BillingStateResolved): React.CSSProperties {
  if (state === 'waiting_for_invoice') {
    return {
      backgroundColor: '#fef9c3',
      color: '#854d0e',
      border: '1px solid #fde68a',
    }
  }

  if (state === 'due') {
    return {
      backgroundColor: '#dbeafe',
      color: '#1d4ed8',
      border: '1px solid #bfdbfe',
    }
  }

  if (state === 'overdue') {
    return {
      backgroundColor: '#fee2e2',
      color: '#991b1b',
      border: '1px solid #fecaca',
    }
  }

  if (state === 'paid') {
    return {
      backgroundColor: '#dcfce7',
      color: '#166534',
      border: '1px solid #bbf7d0',
    }
  }

  return {
    backgroundColor: '#e5e7eb',
    color: '#374151',
    border: '1px solid #d1d5db',
  }
}

function badgeStyle(style: React.CSSProperties): React.CSSProperties {
  return {
    ...style,
    display: 'inline-block',
    padding: '8px 12px',
    borderRadius: '999px',
    fontSize: '14px',
    fontWeight: '700',
    whiteSpace: 'nowrap',
  }
}

function getJobStatusLabel(job: {
  status: string | null
  start_at: string | null
  end_at: string | null
}) {
  const now = new Date()

  const start = job.start_at ? new Date(job.start_at) : null
  const end = job.end_at ? new Date(job.end_at) : null
  const rawStatus = (job.status ?? '').toLowerCase()

  if (end && end < now) return 'Hotovo'
  if (start && start > now) return 'Budoucí'
  if (start && (!end || end >= now)) return 'Probíhá'

  if (rawStatus === 'done') return 'Hotovo'
  if (rawStatus === 'in_progress') return 'Probíhá'
  if (rawStatus === 'future') return 'Budoucí'

  if (end && end < now) return 'Hotovo'
  if (start && start > now) return 'Budoucí'
  if (start && (!end || end >= now)) return 'Probíhá'

  return job.status ?? '—'
}

function getCalculationStatusLabel(status: CustomerCalculationRow['status']) {
  if (status === 'ready') return 'Hotovo'
  if (status === 'archived') return 'Archiv'
  return 'Koncept'
}

function getQuoteStatusLabel(status: CustomerQuoteRow['status']) {
  if (status === 'ready') return 'Připraveno'
  if (status === 'sent') return 'Odesláno'
  if (status === 'accepted') return 'Schváleno'
  if (status === 'rejected') return 'Zamítnuto'
  return 'Koncept'
}

function getResolvedJobStatusLabel(workState: WorkState) {
  return getWorkStateLabel(workState)
}

export default async function CustomerDetailPage({
  params,
}: CustomerDetailPageProps) {
  const { customerId } = await params
  const supabase = await createSupabaseServerClient()

  const customerQuery = supabase
    .from('customers')
    .select(
      'id, name, email, phone, created_at, billing_name, billing_street, billing_city, billing_postal_code, billing_country, company_number, vat_number, ares_last_checked_at, lead_contact_name, lead_source, lead_locale, lead_service_slug, lead_message, lead_page_url, lead_referrer, lead_user_agent, lead_submitted_at'
    )
    .eq('id', customerId)
    .maybeSingle()

  let { data: customer, error: customerError } = await customerQuery

  if (customerError && isMissingCustomerBillingColumns(customerError)) {
    const fallbackResult = await supabase
      .from('customers')
      .select('id, name, email, phone, created_at')
      .eq('id', customerId)
      .maybeSingle()

    customer = (fallbackResult.data
      ? {
          ...fallbackResult.data,
          billing_name: null,
          billing_street: null,
          billing_city: null,
          billing_postal_code: null,
          billing_country: null,
          company_number: null,
          vat_number: null,
          ares_last_checked_at: null,
          lead_contact_name: null,
          lead_source: null,
          lead_locale: null,
          lead_service_slug: null,
          lead_message: null,
          lead_page_url: null,
          lead_referrer: null,
          lead_user_agent: null,
          lead_submitted_at: null,
        }
      : null) as CustomerDetailRow | null
    customerError = fallbackResult.error
  }

  if (customerError || !customer) {
    return (
      <DashboardShell activeItem="customers">
        <main style={pageShellStyle}>
          <div style={errorStateStyle}>Zákazník nebyl nalezen.</div>
        </main>
      </DashboardShell>
    )
  }

  const { data: contacts } = await supabase
    .from('customer_contacts')
    .select('id, full_name, role, phone, email, note, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  const { data: jobs } = await supabase
    .from('jobs_with_state')
    .select(
      'id, title, status, price, customer_id, start_at, end_at, created_at, time_state, work_state, billing_state_resolved'
    )
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  const { data: calculations } = await supabase
    .from('calculations')
    .select('id, title, status, calculation_date, total_price')
    .eq('customer_id', customerId)
    .order('calculation_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(3)

  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, quote_number, title, status, quote_date, total_price')
    .eq('customer_id', customerId)
    .order('quote_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(3)

  const resolvedJobs = ((jobs ?? []) as CustomerJobRow[]).map((job) => {
    const timeState = resolveJobTimeState(job.time_state)
    const workState = getEffectiveJobWorkState({
      timeState,
      workState: resolveJobWorkState(job.work_state),
      legacyStatus: resolveLegacyJobStatus(job.status),
      isMultiDay: isMultiDayJobRange(job.start_at, job.end_at),
    })

    return {
      ...job,
      time_state: timeState,
      work_state: workState,
      billing_state_resolved: resolveJobBillingState(job.billing_state_resolved),
    }
  })

  const sectionTitleStyle: React.CSSProperties = {
    ...cardTitleStyle,
    fontSize: '24px',
    marginBottom: '16px',
  }

  const cardStyle: React.CSSProperties = {
    ...resourceCardStyle,
  }

  return (
    <DashboardShell activeItem="customers">
      <main style={pageShellStyle}>
        <SecondaryAction href="/customers">Zpět na zákazníky</SecondaryAction>

        <section
          style={heroCardStyle}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '16px',
              marginBottom: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={heroContentStyle}>
              <div style={eyebrowStyle}>Zákazník</div>
              <h1 style={heroTitleStyle}>{customer.name || 'Bez názvu zákazníka'}</h1>
              <p style={heroTextStyle}>Kontakty, zakázky, kalkulace a nabídky na jednom místě.</p>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <Link
                href={`/customers/${customerId}/edit`}
                style={primaryButtonStyle}
              >
                Upravit zákazníka
              </Link>

              <Link
                href={`/customers/${customerId}/delete`}
                style={{
                  ...secondaryButtonStyle,
                  backgroundColor: '#fff7f7',
                  color: '#991b1b',
                  border: '1px solid #fecaca',
                }}
              >
                Smazat zákazníka
              </Link>
            </div>
          </div>

          <div style={metaGridStyle}>
            <div style={metaItemStyle}>
              <span style={metaLabelStyle}>Hlavní e-mail</span>
              <span style={metaValueStyle}>{customer.email || '—'}</span>
            </div>
            <div style={metaItemStyle}>
              <span style={metaLabelStyle}>Hlavní telefon</span>
              <span style={metaValueStyle}>{customer.phone || '—'}</span>
            </div>
            <div style={metaItemStyle}>
              <span style={metaLabelStyle}>ID zákazníka</span>
              <span style={{ ...metaValueStyle, color: '#64748b', fontSize: '12px' }}>{customer.id}</span>
            </div>
          </div>
        </section>

        <section
          style={sectionCardStyle}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '16px',
              marginBottom: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h2
                style={cardTitleStyle}
              >
                Fakturační údaje
              </h2>
              <p style={{ ...mutedTextStyle, margin: '8px 0 0 0' }}>
                Údaje pro fakturaci a měsíční soupis zakázek.
              </p>
            </div>

            <Link
              href={`/customers/${customerId}/edit`}
              style={secondaryButtonStyle}
            >
              Upravit fakturaci
            </Link>
          </div>

          <div style={{ display: 'grid', gap: '8px', fontSize: '16px', color: '#4b5563' }}>
            <div>
              <strong style={{ color: '#111827' }}>Fakturacni nazev:</strong>{' '}
              {customer.billing_name || customer.name || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>ICO:</strong>{' '}
              {customer.company_number || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>DIC:</strong>{' '}
              {customer.vat_number || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>Ulice a cislo:</strong>{' '}
              {customer.billing_street || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>Mesto:</strong>{' '}
              {customer.billing_city || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>PSC:</strong>{' '}
              {customer.billing_postal_code || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>Stat:</strong>{' '}
              {customer.billing_country || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>ARES naposledy:</strong>{' '}
              {customer.ares_last_checked_at
                ? new Date(customer.ares_last_checked_at).toLocaleString('cs-CZ')
                : '—'}
            </div>
          </div>
        </section>

        {(customer.lead_message ||
          customer.lead_contact_name ||
          customer.lead_source ||
          customer.lead_service_slug) && (
          <section
            id="web-poptavka"
            style={sectionCardStyle}
          >
            <div style={{ marginBottom: '16px' }}>
              <h2
                style={cardTitleStyle}
              >
                Webová poptávka
              </h2>
              <p style={{ ...mutedTextStyle, margin: '8px 0 0 0' }}>
                Poptávka přijatá z veřejného webu Diriqo.
              </p>
            </div>

            <div style={{ display: 'grid', gap: '8px', fontSize: '16px', color: '#4b5563' }}>
              <div>
                <strong style={{ color: '#111827' }}>Kontaktni osoba:</strong>{' '}
                {customer.lead_contact_name || '—'}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>Zdroj:</strong>{' '}
                {customer.lead_source || '—'}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>Jazyk webu:</strong>{' '}
                {customer.lead_locale || '—'}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>Sluzba:</strong>{' '}
                {customer.lead_service_slug || '—'}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>Odeslano:</strong>{' '}
                {customer.lead_submitted_at
                  ? new Date(customer.lead_submitted_at).toLocaleString('cs-CZ')
                  : '—'}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>URL stranky:</strong>{' '}
                {customer.lead_page_url ? (
                  <a
                    href={customer.lead_page_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#2563eb' }}
                  >
                    {customer.lead_page_url}
                  </a>
                ) : (
                  '—'
                )}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>Referrer:</strong>{' '}
                {customer.lead_referrer || '—'}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>Poptavka:</strong>
                <div
                  style={{
                    marginTop: '8px',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    backgroundColor: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    color: '#111827',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {customer.lead_message || '—'}
                </div>
              </div>
            </div>
          </section>
        )}

        <section style={sectionCardStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '16px',
            }}
          >
            <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Kalkulace</h2>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Link
                href={`/customers/${customerId}/calculations`}
                style={{
                  display: 'inline-block',
                  backgroundColor: '#f3f4f6',
                  color: '#111827',
                  textDecoration: 'none',
                  fontWeight: '700',
                  fontSize: '14px',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  border: '1px solid #d1d5db',
                  whiteSpace: 'nowrap',
                }}
              >
                Zobrazit vše
              </Link>

              <Link
                href={`/customers/${customerId}/calculations/new`}
                style={{
                  display: 'inline-block',
                  backgroundColor: '#000000',
                  color: '#ffffff',
                  textDecoration: 'none',
                  fontWeight: '700',
                  fontSize: '14px',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  whiteSpace: 'nowrap',
                }}
              >
                + Nová kalkulace
              </Link>
            </div>
          </div>

          {calculations && calculations.length > 0 ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              {(calculations as CustomerCalculationRow[]).map((calculation) => (
                <Link
                  key={calculation.id}
                  href={`/customers/${customerId}/calculations/${calculation.id}`}
                  style={{
                    ...cardStyle,
                    textDecoration: 'none',
                    display: 'block',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '16px',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          marginBottom: '8px',
                          fontSize: '20px',
                          fontWeight: '700',
                          color: '#111827',
                        }}
                      >
                        {calculation.title}
                      </div>

                      <div style={{ marginBottom: '6px', color: '#4b5563' }}>
                        <strong style={{ color: '#111827' }}>Datum:</strong>{' '}
                        {calculation.calculation_date
                          ? new Date(calculation.calculation_date).toLocaleDateString('cs-CZ')
                          : '—'}
                      </div>

                      <div style={{ color: '#4b5563' }}>
                        <strong style={{ color: '#111827' }}>Cena:</strong>{' '}
                        {formatPrice(
                          calculation.total_price != null
                            ? Number(calculation.total_price)
                            : null
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        ...badgeStyle(
                          calculation.status === 'ready'
                            ? {
                                backgroundColor: '#dcfce7',
                                color: '#166534',
                                border: '1px solid #bbf7d0',
                              }
                            : calculation.status === 'archived'
                              ? {
                                  backgroundColor: '#f3f4f6',
                                  color: '#4b5563',
                                  border: '1px solid #d1d5db',
                                }
                              : {
                                  backgroundColor: '#dbeafe',
                                  color: '#1d4ed8',
                                  border: '1px solid #bfdbfe',
                                }
                        ),
                      }}
                    >
                      {getCalculationStatusLabel(calculation.status)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p style={{ color: '#6b7280' }}>Tento zákazník zatím nemá žádné kalkulace.</p>
          )}
        </section>

        <section style={sectionCardStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '16px',
            }}
          >
            <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Cenové nabídky</h2>

            <Link
              href={`/customers/${customerId}/quotes`}
              style={{
                display: 'inline-block',
                backgroundColor: '#f3f4f6',
                color: '#111827',
                textDecoration: 'none',
                fontWeight: '700',
                fontSize: '14px',
                padding: '10px 14px',
                borderRadius: '12px',
                border: '1px solid #d1d5db',
                whiteSpace: 'nowrap',
              }}
            >
              Zobrazit vše
            </Link>
          </div>

          {quotes && quotes.length > 0 ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              {(quotes as CustomerQuoteRow[]).map((quote) => (
                <Link
                  key={quote.id}
                  href={`/customers/${customerId}/quotes/${quote.id}`}
                  style={{
                    ...cardStyle,
                    textDecoration: 'none',
                    display: 'block',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '16px',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '6px' }}>
                        {quote.quote_number}
                      </div>

                      <div
                        style={{
                          marginBottom: '8px',
                          fontSize: '20px',
                          fontWeight: '700',
                          color: '#111827',
                        }}
                      >
                        {quote.title}
                      </div>

                      <div style={{ marginBottom: '6px', color: '#4b5563' }}>
                        <strong style={{ color: '#111827' }}>Datum:</strong>{' '}
                        {quote.quote_date
                          ? new Date(quote.quote_date).toLocaleDateString('cs-CZ')
                          : '—'}
                      </div>

                      <div style={{ color: '#4b5563' }}>
                        <strong style={{ color: '#111827' }}>Cena:</strong>{' '}
                        {formatPrice(quote.total_price != null ? Number(quote.total_price) : null)}
                      </div>
                    </div>

                    <div
                      style={{
                        ...badgeStyle(
                          quote.status === 'accepted'
                            ? {
                                backgroundColor: '#dcfce7',
                                color: '#166534',
                                border: '1px solid #bbf7d0',
                              }
                            : quote.status === 'rejected'
                              ? {
                                  backgroundColor: '#fee2e2',
                                  color: '#991b1b',
                                  border: '1px solid #fecaca',
                                }
                              : quote.status === 'sent'
                                ? {
                                    backgroundColor: '#fef3c7',
                                    color: '#92400e',
                                    border: '1px solid #fde68a',
                                  }
                                : quote.status === 'ready'
                                  ? {
                                      backgroundColor: '#dbeafe',
                                      color: '#1d4ed8',
                                      border: '1px solid #bfdbfe',
                                    }
                                  : {
                                      backgroundColor: '#f3f4f6',
                                      color: '#4b5563',
                                      border: '1px solid #d1d5db',
                                    }
                        ),
                      }}
                    >
                      {getQuoteStatusLabel(quote.status)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p style={{ color: '#6b7280' }}>Tento zákazník zatím nemá žádné cenové nabídky.</p>
          )}
        </section>

        <section style={sectionCardStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '16px',
            }}
          >
            <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Kontaktní osoby</h2>

            <Link
              href={`/customers/${customerId}/contacts/new`}
              style={{
                display: 'inline-block',
                backgroundColor: '#000000',
                color: '#ffffff',
                textDecoration: 'none',
                fontWeight: '700',
                fontSize: '14px',
                padding: '10px 14px',
                borderRadius: '12px',
                whiteSpace: 'nowrap',
              }}
            >
              + Přidat kontakt
            </Link>
          </div>

          {contacts && contacts.length > 0 ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              {contacts.map((contact) => (
                <div key={contact.id} style={cardStyle}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '16px',
                      marginBottom: '8px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ fontSize: '18px', fontWeight: '700' }}>
                      {contact.full_name}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <Link
                        href={`/customers/${customerId}/contacts/${contact.id}/edit`}
                        style={{
                          display: 'inline-block',
                          backgroundColor: '#f3f4f6',
                          color: '#111827',
                          textDecoration: 'none',
                          fontWeight: '700',
                          fontSize: '14px',
                          padding: '8px 12px',
                          borderRadius: '10px',
                          border: '1px solid #d1d5db',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Upravit
                      </Link>

                      <Link
                        href={`/customers/${customerId}/contacts/${contact.id}/delete`}
                        style={{
                          display: 'inline-block',
                          backgroundColor: '#fef2f2',
                          color: '#991b1b',
                          textDecoration: 'none',
                          fontWeight: '700',
                          fontSize: '14px',
                          padding: '8px 12px',
                          borderRadius: '10px',
                          border: '1px solid #fecaca',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Smazat
                      </Link>
                    </div>
                  </div>

                  <div style={{ marginBottom: '6px' }}>
                    <strong>Funkce:</strong> {contact.role || '—'}
                  </div>

                  <div style={{ marginBottom: '6px' }}>
                    <strong>Telefon:</strong> {contact.phone || '—'}
                  </div>

                  <div style={{ marginBottom: '6px' }}>
                    <strong>E-mail:</strong> {contact.email || '—'}
                  </div>

                  <div>
                    <strong>Poznámka:</strong> {contact.note || '—'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#6b7280' }}>Zatím nejsou přidané žádné kontaktní osoby.</p>
          )}
        </section>

        <section style={sectionCardStyle}>
          <h2 style={sectionTitleStyle}>Zakázky zákazníka</h2>

          {resolvedJobs.length > 0 ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              {resolvedJobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  style={{
                    ...cardStyle,
                    textDecoration: 'none',
                    display: 'block',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '16px',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          marginBottom: '8px',
                          fontSize: '20px',
                          fontWeight: '700',
                          color: '#111827',
                        }}
                      >
                        {job.title || 'Bez názvu zakázky'}
                      </div>

                      <div style={{ marginBottom: '6px', color: '#4b5563' }}>
                        <strong style={{ color: '#111827' }}>Stav:</strong>{' '}
                        {getResolvedJobStatusLabel(job.work_state)}
                      </div>

                      <div style={{ marginBottom: '6px', color: '#4b5563' }}>
                        <strong style={{ color: '#111827' }}>Cena:</strong>{' '}
                        {formatPrice(job.price != null ? Number(job.price) : null)}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        flexWrap: 'wrap',
                        justifyContent: 'flex-end',
                      }}
                    >
                      <div style={badgeStyle(getTimeStateStyles(job.time_state))}>
                        {getDisplayTimeStateLabel(job.time_state)}
                      </div>
                      <div style={badgeStyle(getWorkStateStyles(job.work_state))}>
                        {getWorkStateLabel(job.work_state)}
                      </div>
                      {getVisibleBillingState(job.work_state, job.billing_state_resolved) && (
                        <div
                          style={badgeStyle(getBillingStateStyles(job.billing_state_resolved))}
                        >
                          {getBillingStateLabel(job.billing_state_resolved)}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p style={{ color: '#6b7280' }}>Tento zákazník zatím nemá žádné zakázky.</p>
          )}
        </section>
      </main>
    </DashboardShell>
  )
}
