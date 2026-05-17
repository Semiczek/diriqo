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
import { getActiveCompanyContext } from '@/lib/active-company'
import { listEntityThreadMessages } from '@/lib/email/listEntityThreadMessages'
import type { MessageFeedItem } from '@/lib/email/types'
import { getIntlLocale } from '@/lib/i18n/config'
import { getRequestDictionary, getRequestLocale } from '@/lib/i18n/server'
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

function formatPrice(value: number | null | undefined, locale = 'cs-CZ') {
  if (value == null) return '—'

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDateTime(value: string | null | undefined, locale = 'cs-CZ') {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

type JobStateLabels = {
  future: string
  active: string
  finished: string
  notStarted: string
  inProgress: string
  partiallyDone: string
  done: string
  waitingForInvoice: string
  due: string
  overdue: string
  paid: string
  unknownTime: string
  unknownWork: string
  unknownBilling: string
}

function getTimeStateLabel(state: TimeState, labels: JobStateLabels) {
  if (state === 'future') return labels.future
  if (state === 'active') return labels.active
  if (state === 'finished') return labels.finished
  return labels.unknownTime
}

function getWorkStateLabel(state: WorkState, labels: JobStateLabels) {
  if (state === 'not_started') return labels.notStarted
  if (state === 'in_progress') return labels.inProgress
  if (state === 'partially_done') return labels.partiallyDone
  if (state === 'done') return labels.done
  return labels.unknownWork
}

function getBillingStateLabel(state: BillingStateResolved, labels: JobStateLabels) {
  if (state === 'waiting_for_invoice') return labels.waitingForInvoice
  if (state === 'due') return labels.due
  if (state === 'overdue') return labels.overdue
  if (state === 'paid') return labels.paid
  return labels.unknownBilling
}

function getDisplayTimeStateLabel(state: TimeState, labels: JobStateLabels) {
  if (state === 'finished') return labels.done
  return getTimeStateLabel(state, labels)
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

function getCalculationStatusLabel(
  status: CustomerCalculationRow['status'],
  labels: { ready: string; draft: string; archived: string }
) {
  if (status === 'ready') return labels.ready
  if (status === 'archived') return labels.archived
  return labels.draft
}

function getQuoteStatusLabel(
  status: CustomerQuoteRow['status'],
  labels: { draft: string; ready: string; sent: string; accepted: string; rejected: string }
) {
  if (status === 'ready') return labels.ready
  if (status === 'sent') return labels.sent
  if (status === 'accepted') return labels.accepted
  if (status === 'rejected') return labels.rejected
  return labels.draft
}

function getResolvedJobStatusLabel(workState: WorkState, labels: JobStateLabels) {
  return getWorkStateLabel(workState, labels)
}

export default async function CustomerDetailPage({
  params,
}: CustomerDetailPageProps) {
  const { customerId } = await params
  const locale = await getRequestLocale()
  const dictionary = await getRequestDictionary()
  const intlLocale = getIntlLocale(locale)
  const t = dictionary.customers
  const detail = t.detail
  const jobsText = dictionary.jobs
  const jobStateLabels: JobStateLabels = {
    future: jobsText.future,
    active: jobsText.active,
    finished: jobsText.done,
    notStarted: jobsText.notStarted,
    inProgress: jobsText.inProgress,
    partiallyDone: jobsText.partiallyDone,
    done: jobsText.done,
    waitingForInvoice: jobsText.waitingForInvoice,
    due: jobsText.due,
    overdue: jobsText.overdue,
    paid: jobsText.paid,
    unknownTime: jobsText.unknownTime,
    unknownWork: jobsText.unknownWork,
    unknownBilling: jobsText.unknownBilling,
  }
  const calculationStatusLabels = {
    ready: t.calculationForm.ready,
    draft: t.calculationForm.draft,
    archived: detail.calculationArchived,
  }
  const quoteStatusLabels = {
    draft: t.quotesList.draft,
    ready: t.quotesList.ready,
    sent: t.quotesList.sent,
    accepted: t.quotesList.accepted,
    rejected: t.quotesList.rejected,
  }
  const supabase = await createSupabaseServerClient()
  const activeCompany = await getActiveCompanyContext({
    allowedRoles: ['super_admin', 'company_admin', 'manager'],
  })

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
          <div style={errorStateStyle}>{t.customerNotFound}</div>
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

  let communicationFeed: MessageFeedItem[] = []
  let communicationError: string | null = null

  if (activeCompany?.companyId) {
    try {
      const communication = await listEntityThreadMessages(
        supabase,
        activeCompany.companyId,
        'customer',
        customerId
      )
      communicationFeed = communication.feedItems.slice(-6).reverse()
    } catch (error) {
      communicationError = error instanceof Error ? error.message : dictionary.common.dataLoadFailed
    }
  }

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
    transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
  }

  const customerSectionStyle: React.CSSProperties = {
    ...sectionCardStyle,
    padding: '24px',
    background:
      'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(248,250,252,0.9) 100%)',
    border: '1px solid rgba(148, 163, 184, 0.22)',
    boxShadow: '0 18px 42px rgba(15, 23, 42, 0.07)',
  }

  const sectionHeaderStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '18px',
    flexWrap: 'wrap',
  }

  const sectionIntroStyle: React.CSSProperties = {
    ...mutedTextStyle,
    margin: '6px 0 0',
    maxWidth: '560px',
  }

  const emptyInlineStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    padding: '18px',
    borderRadius: '18px',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    background:
      'linear-gradient(135deg, rgba(248,250,252,0.95), rgba(239,246,255,0.7))',
    color: '#475569',
  }

  const emptyIconStyle: React.CSSProperties = {
    width: '42px',
    height: '42px',
    borderRadius: '16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    background: 'linear-gradient(135deg, rgba(124,58,237,0.14), rgba(6,182,212,0.14))',
    color: '#2563eb',
    fontWeight: 900,
  }

  const inlineActionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    alignItems: 'center',
  }

  return (
    <DashboardShell activeItem="customers">
      <main style={pageShellStyle}>
        <SecondaryAction href="/customers">{t.backToCustomers}</SecondaryAction>

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
              <div style={eyebrowStyle}>{dictionary.navigation.customers}</div>
              <h1 style={heroTitleStyle}>{customer.name || detail.unnamedCustomer}</h1>
              <p style={heroTextStyle}>{detail.subtitle}</p>
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
                {t.editCustomer}
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
                {t.deleteCustomer}
              </Link>
            </div>
          </div>

          <div style={metaGridStyle}>
            <div style={metaItemStyle}>
              <span style={metaLabelStyle}>{t.mainEmail}</span>
              <span style={metaValueStyle}>{customer.email || '—'}</span>
            </div>
            <div style={metaItemStyle}>
              <span style={metaLabelStyle}>{t.mainPhone}</span>
              <span style={metaValueStyle}>{customer.phone || '—'}</span>
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
                {detail.billingSectionTitle}
              </h2>
              <p style={{ ...mutedTextStyle, margin: '8px 0 0 0' }}>
                {detail.billingSectionDescription}
              </p>
            </div>

            <Link
              href={`/customers/${customerId}/edit`}
              style={secondaryButtonStyle}
            >
              {detail.editBilling}
            </Link>
          </div>

          <div style={{ display: 'grid', gap: '8px', fontSize: '16px', color: '#4b5563' }}>
            <div>
              <strong style={{ color: '#111827' }}>{t.billingName}:</strong>{' '}
              {customer.billing_name || customer.name || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>{t.companyNumber}:</strong>{' '}
              {customer.company_number || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>{t.vatNumber}:</strong>{' '}
              {customer.vat_number || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>{t.street}:</strong>{' '}
              {customer.billing_street || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>{t.city}:</strong>{' '}
              {customer.billing_city || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>{t.postalCode}:</strong>{' '}
              {customer.billing_postal_code || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>{t.country}:</strong>{' '}
              {customer.billing_country || '—'}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>{t.aresLastChecked}:</strong>{' '}
              {customer.ares_last_checked_at
                ? new Date(customer.ares_last_checked_at).toLocaleString(intlLocale)
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
                {detail.webLead}
              </h2>
              <p style={{ ...mutedTextStyle, margin: '8px 0 0 0' }}>
                {detail.webLeadDescription}
              </p>
            </div>

            <div style={{ display: 'grid', gap: '8px', fontSize: '16px', color: '#4b5563' }}>
              <div>
                <strong style={{ color: '#111827' }}>{t.contactName}:</strong>{' '}
                {customer.lead_contact_name || '—'}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>{t.source}:</strong>{' '}
                {customer.lead_source || '—'}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>{t.websiteLanguage}:</strong>{' '}
                {customer.lead_locale || '—'}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>{t.service}:</strong>{' '}
                {customer.lead_service_slug || '—'}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>{t.submittedAt}:</strong>{' '}
                {customer.lead_submitted_at
                  ? new Date(customer.lead_submitted_at).toLocaleString(intlLocale)
                  : '—'}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>{t.pageUrl}:</strong>{' '}
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
                <strong style={{ color: '#111827' }}>{t.referrer}:</strong>{' '}
                {customer.lead_referrer || '—'}
              </div>
              <div>
                <strong style={{ color: '#111827' }}>{t.leadMessage}:</strong>
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

        <section style={customerSectionStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '16px',
            }}
          >
            <div>
              <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>{detail.calculations}</h2>
              <p style={sectionIntroStyle}>{detail.calculationsDescription}</p>
            </div>

            <div style={inlineActionsStyle}>
              <Link
                href={`/customers/${customerId}/calculations`}
                style={secondaryButtonStyle}
              >
                {detail.showAll}
              </Link>

              <Link
                href={`/customers/${customerId}/calculations/new`}
                style={primaryButtonStyle}
              >
                {detail.addCalculation}
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
                        <strong style={{ color: '#111827' }}>{t.date}:</strong>{' '}
                        {calculation.calculation_date
                          ? new Date(calculation.calculation_date).toLocaleDateString(intlLocale)
                          : '—'}
                      </div>

                      <div style={{ color: '#4b5563' }}>
                        <strong style={{ color: '#111827' }}>{jobsText.price}:</strong>{' '}
                        {formatPrice(
                          calculation.total_price != null
                            ? Number(calculation.total_price)
                            : null,
                          intlLocale
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
                      {getCalculationStatusLabel(calculation.status, calculationStatusLabels)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div style={emptyInlineStyle}>
              <span style={emptyIconStyle}>+</span>
              <div>
                <strong style={{ display: 'block', color: '#0f172a', marginBottom: '3px' }}>
                  {detail.emptySectionTitle}
                </strong>
                <span>{t.calculationsEmpty}</span>
              </div>
            </div>
          )}
        </section>

        <section style={customerSectionStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '16px',
            }}
          >
            <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>{detail.quotes}</h2>

            <Link
              href={`/customers/${customerId}/quotes`}
              style={secondaryButtonStyle}
            >
              {detail.showAll}
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
                        <strong style={{ color: '#111827' }}>{t.date}:</strong>{' '}
                        {quote.quote_date
                          ? new Date(quote.quote_date).toLocaleDateString(intlLocale)
                          : '—'}
                      </div>

                      <div style={{ color: '#4b5563' }}>
                        <strong style={{ color: '#111827' }}>{jobsText.price}:</strong>{' '}
                        {formatPrice(quote.total_price != null ? Number(quote.total_price) : null, intlLocale)}
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
                      {getQuoteStatusLabel(quote.status, quoteStatusLabels)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div style={emptyInlineStyle}>
              <span style={emptyIconStyle}>+</span>
              <div>
                <strong style={{ display: 'block', color: '#0f172a', marginBottom: '3px' }}>
                  {detail.emptySectionTitle}
                </strong>
                <span>{t.quotesEmpty}</span>
              </div>
            </div>
          )}
        </section>

        <section style={customerSectionStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '16px',
            }}
          >
            <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>{detail.contacts}</h2>

            <Link
              href={`/customers/${customerId}/contacts/new`}
              style={primaryButtonStyle}
            >
              {t.addContact}
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
                        style={{ ...secondaryButtonStyle, minHeight: '36px', padding: '8px 12px', fontSize: '13px' }}
                      >
                        {t.edit}
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
                        {dictionary.common.delete}
                      </Link>
                    </div>
                  </div>

                  <div style={{ marginBottom: '6px' }}>
                    <strong>{t.role}:</strong> {contact.role || '—'}
                  </div>

                  <div style={{ marginBottom: '6px' }}>
                    <strong>{t.phoneLabel}:</strong> {contact.phone || '—'}
                  </div>

                  <div style={{ marginBottom: '6px' }}>
                    <strong>E-mail:</strong> {contact.email || '—'}
                  </div>

                  <div>
                    <strong>{t.note}:</strong> {contact.note || '—'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={emptyInlineStyle}>
              <span style={emptyIconStyle}>+</span>
              <div>
                <strong style={{ display: 'block', color: '#0f172a', marginBottom: '3px' }}>
                  {detail.emptySectionTitle}
                </strong>
                <span>{t.noContactsYet}</span>
              </div>
            </div>
          )}
        </section>

        {activeCompany ? (
          <section style={customerSectionStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Komunikace</h2>
                <p style={sectionIntroStyle}>Poslední e-maily spárované s tímto zákazníkem.</p>
              </div>
            </div>

            {communicationError ? (
              <div style={errorStateStyle}>{communicationError}</div>
            ) : communicationFeed.length === 0 ? (
              <div style={emptyInlineStyle}>
                <span style={emptyIconStyle}>@</span>
                <div>
                  <strong style={{ display: 'block', color: '#0f172a', marginBottom: '3px' }}>
                    Zatím bez e-mailů
                  </strong>
                  <span>Nové zprávy se zobrazí po odeslání ze zakázky nebo po odpovědi zákazníka.</span>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {communicationFeed.map((item) => (
                  <div key={`${item.direction}-${item.id}`} style={cardStyle}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '12px',
                        flexWrap: 'wrap',
                        marginBottom: '8px',
                      }}
                    >
                      <strong>{item.subject || 'Bez předmětu'}</strong>
                      <span style={{ color: '#64748b', fontSize: '13px' }}>
                        {formatDateTime(item.happenedAt, intlLocale)}
                      </span>
                    </div>
                    <div style={{ color: '#475569', fontSize: '14px', marginBottom: '6px' }}>
                      {item.direction === 'outbound' ? 'Komu' : 'Od'}: {item.email}
                    </div>
                    <div style={{ color: '#374151', fontSize: '14px' }}>
                      {item.preview || item.bodyText || 'Bez náhledu'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        <section style={customerSectionStyle}>
          <h2 style={sectionTitleStyle}>{t.customerJobs}</h2>

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
                        {job.title || jobsText.untitledJob}
                      </div>

                      <div style={{ marginBottom: '6px', color: '#4b5563' }}>
                        <strong style={{ color: '#111827' }}>{t.status}:</strong>{' '}
                        {getResolvedJobStatusLabel(job.work_state, jobStateLabels)}
                      </div>

                      <div style={{ marginBottom: '6px', color: '#4b5563' }}>
                        <strong style={{ color: '#111827' }}>{jobsText.price}:</strong>{' '}
                        {formatPrice(job.price != null ? Number(job.price) : null, intlLocale)}
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
                        {getDisplayTimeStateLabel(job.time_state, jobStateLabels)}
                      </div>
                      <div style={badgeStyle(getWorkStateStyles(job.work_state))}>
                        {getWorkStateLabel(job.work_state, jobStateLabels)}
                      </div>
                      {getVisibleBillingState(job.work_state, job.billing_state_resolved) && (
                        <div
                          style={badgeStyle(getBillingStateStyles(job.billing_state_resolved))}
                        >
                          {getBillingStateLabel(job.billing_state_resolved, jobStateLabels)}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div style={emptyInlineStyle}>
              <span style={emptyIconStyle}>+</span>
              <div>
                <strong style={{ display: 'block', color: '#0f172a', marginBottom: '3px' }}>
                  {detail.emptySectionTitle}
                </strong>
                <span>{t.customerJobsEmpty}</span>
              </div>
            </div>
          )}
        </section>
      </main>
    </DashboardShell>
  )
}
