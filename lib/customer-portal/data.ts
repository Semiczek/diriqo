import 'server-only'

import { buildQrPaymentPayload, formatInvoiceStatus } from '@/lib/invoices'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

const JOB_PHOTO_BUCKET = 'job-photos'

export type PortalJobStatus = 'Objednáno' | 'Probíhá' | 'Hotovo'
export type PortalInquiryStatus = 'Přijatá' | 'Řeší se' | 'Naceněno' | 'Uzavřeno'

type JobRow = {
  id: string
  title: string | null
  address: string | null
  price: number | null
  status: string | null
  start_at: string | null
  end_at: string | null
  created_at: string | null
  customer_summary: string | null
}

type JobStateRow = {
  id: string
  time_state: string | null
  work_state: string | null
}

type JobPhotoRow = {
  id: string
  photo_type: string | null
  file_name: string | null
  taken_at: string | null
  storage_path: string | null
  thumb_storage_path: string | null
}

type QuoteRow = {
  id: string
  quote_number: string
  title: string
  status: string | null
  quote_date: string | null
  valid_until: string | null
  contact_name: string | null
  contact_email: string | null
  customer_request_title: string | null
  customer_request: string | null
  our_solution_title: string | null
  timeline_title: string | null
  pricing_title: string | null
  payment_terms_title: string | null
  benefits_text: string | null
  total_price: number | null
  intro_text: string | null
  proposed_solution: string | null
  pricing_text: string | null
  work_description: string | null
  work_schedule: string | null
  payment_terms: string | null
  customer_summary: string | null
  created_at: string | null
  updated_at: string | null
  profiles?: { full_name: string | null }[] | { full_name: string | null } | null
  accepted_at: string | null
  customer_portal_approved_by: string | null
  customer_portal_approved_note: string | null
}

type QuoteItemRow = {
  id: string
  name: string
  description: string | null
  quantity: number | null
  unit: string | null
  unit_price: number | null
  total_price: number | null
  note: string | null
}

type LeadRow = {
  id: string
  subject: string | null
  location_text: string | null
  message: string | null
  customer_note: string | null
  preferred_month: string | null
  status: string | null
  created_at: string | null
  closed_at: string | null
}

type InvoiceRow = {
  id: string
  invoice_number: string | null
  variable_symbol: string | null
  status: string | null
  issue_date: string | null
  due_date: string | null
  total_with_vat: number | null
  paid_at: string | null
  taxable_supply_date?: string | null
  payment_method?: string | null
  is_vat_payer?: boolean | null
  vat_note?: string | null
  subtotal_without_vat?: number | null
  vat_total?: number | null
  note?: string | null
  customer_snapshot?: Record<string, unknown> | null
  supplier_snapshot?: Record<string, unknown> | null
}

type InvoiceItemRow = {
  id: string
  source_job_id: string | null
  item_name: string
  description: string | null
  quantity: number | null
  unit: string | null
  unit_price_without_vat: number | null
  vat_rate: number | null
  vat_amount: number | null
  total_without_vat: number | null
  total_with_vat: number | null
}

export type PortalJobListItem = {
  id: string
  title: string
  location: string | null
  dateLabel: string
  workPriceLabel: string
  customerStatus: PortalJobStatus
  customerSummary: string | null
  updatedAtLabel: string
  monthValue: string | null
}

export type PortalPhotoItem = {
  id: string
  fileName: string
  takenAtLabel: string
  previewUrl: string | null
  imageUrl: string | null
  photoType: 'before' | 'after'
}

export type PortalOfferListItem = {
  id: string
  quoteNumber: string
  title: string
  statusLabel: string
  summary: string | null
  totalPriceLabel: string
  validUntilLabel: string
  canApprove: boolean
}

export type PortalInquiryListItem = {
  id: string
  title: string
  location: string | null
  statusLabel: PortalInquiryStatus
  preferredMonthLabel: string
  createdAtLabel: string
}

export type PortalInvoiceListItem = {
  id: string
  invoiceNumber: string
  variableSymbol: string | null
  statusLabel: string
  issueDateLabel: string
  dueDateLabel: string
  totalWithVatLabel: string
  paidAtLabel: string | null
  pdfHref: string | null
  detailHref: string
  monthValue: string | null
  monthLabel: string
}

export type PortalInvoiceDetailItem = {
  id: string
  sourceJobId: string | null
  itemName: string
  description: string | null
  quantityLabel: string
  unit: string
  unitPriceWithoutVatLabel: string
  vatRateLabel: string
  vatAmountLabel: string
  totalWithVatLabel: string
}

export type PortalInvoiceDetail = {
  id: string
  invoiceNumber: string
  variableSymbol: string | null
  statusLabel: string
  issueDateLabel: string
  dueDateLabel: string
  taxableSupplyDateLabel: string
  totalWithVatLabel: string
  subtotalWithoutVatLabel: string
  vatTotalLabel: string
  paidAtLabel: string | null
  paymentMethodLabel: string
  vatPayerLabel: string
  vatNote: string | null
  note: string | null
  pdfHref: string | null
  supplierName: string
  supplierCompanyNumber: string | null
  supplierVatNumber: string | null
  supplierAddressLabel: string
  supplierBankAccountLabel: string
  customerName: string
  customerCompanyNumber: string | null
  customerVatNumber: string | null
  customerAddressLabel: string
  customerEmail: string | null
  hasQrPayment: boolean
  items: PortalInvoiceDetailItem[]
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Neuvedeno'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Neuvedeno'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatCurrency(value: number | null | undefined) {
  if (value == null) return 'Neuvedeno'
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatMonthLabel(value: string | null | undefined) {
  if (!value) return 'Neuvedeno'

  const normalized = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('cs-CZ', {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export function getMonthValueFromDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function getSnapshotString(snapshot: Record<string, unknown> | null | undefined, key: string) {
  const value = snapshot?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function formatAddressLabel(snapshot: Record<string, unknown> | null | undefined) {
  return (
    [
      getSnapshotString(snapshot, 'billingStreet'),
      getSnapshotString(snapshot, 'billingCity'),
      getSnapshotString(snapshot, 'billingPostalCode'),
    ]
      .filter(Boolean)
      .join(', ') || 'Neuvedeno'
  )
}

function formatBankAccountLabel(snapshot: Record<string, unknown> | null | undefined) {
  const iban = getSnapshotString(snapshot, 'iban')
  if (iban) return iban

  return (
    [getSnapshotString(snapshot, 'bankAccountNumber'), getSnapshotString(snapshot, 'bankCode')]
      .filter(Boolean)
      .join('/') || 'Neuvedeno'
  )
}

function formatPaymentMethodLabel(value: string | null | undefined) {
  if (value === 'bank_transfer') return 'Převodem'
  if (value === 'cash') return 'Hotově'
  if (value === 'card') return 'Kartou'
  return value?.trim() || 'Neuvedeno'
}

export function mapPortalJobStatus(input: {
  status: string | null
  timeState: string | null
  workState: string | null
}): PortalJobStatus {
  const tokens = [input.status, input.timeState, input.workState]
    .map((value) => (value ?? '').trim().toLowerCase())
    .filter(Boolean)

  const isDone = tokens.some((value) =>
    [
      'done',
      'finished',
      'completed',
      'complete',
      'hotovo',
      'closed',
    ].includes(value)
  )

  if (isDone) return 'Hotovo'

  const isActive = tokens.some((value) =>
    [
      'active',
      'in_progress',
      'working',
      'waiting_check',
      'partially_done',
      'ongoing',
    ].includes(value)
  )

  if (isActive) return 'Probíhá'

  return 'Objednáno'
}

export function mapPortalInquiryStatus(value: string | null | undefined): PortalInquiryStatus {
  const normalized = (value ?? '').trim().toLowerCase()

  if (['closed', 'done', 'resolved', 'converted'].includes(normalized)) {
    return 'Uzavřeno'
  }

  if (['quoted', 'offered', 'priced', 'naceneno'].includes(normalized)) {
    return 'Naceněno'
  }

  if (['in_progress', 'open', 'processing', 'contacted'].includes(normalized)) {
    return 'Řeší se'
  }

  return 'Přijatá'
}

export function mapPortalOfferStatus(value: string | null | undefined, validUntil?: string | null) {
  const normalized = (value ?? '').trim().toLowerCase()
  const isExpired =
    validUntil != null &&
    new Date(`${validUntil}T23:59:59`).getTime() < Date.now() &&
    normalized !== 'accepted' &&
    normalized !== 'rejected'

  if (isExpired || normalized === 'expired') return 'Expirovaná'
  if (normalized === 'accepted') return 'Schválená'
  if (normalized === 'rejected') return 'Zamítnutá'
  if (normalized === 'waiting_followup') return 'Potvrzení přijato'
  if (normalized === 'revision_requested') return 'Požadována úprava'
  if (normalized === 'viewed') return 'Zobrazená'
  if (normalized === 'sent') return 'K potvrzení'
  if (normalized === 'ready') return 'Připravená'
  return 'Rozpracovaná'
}

export function canPortalApproveOffer(quote: Pick<QuoteRow, 'status' | 'valid_until' | 'accepted_at'>) {
  const normalized = (quote.status ?? '').trim().toLowerCase()
  const isExpired =
    quote.valid_until != null &&
    new Date(`${quote.valid_until}T23:59:59`).getTime() < Date.now() &&
    normalized !== 'accepted'

  if (quote.accepted_at) return false
  if (isExpired) return false
  if (normalized === 'accepted' || normalized === 'rejected' || normalized === 'expired') return false

  return ['ready', 'sent', 'viewed', 'waiting_followup'].includes(normalized)
}

function formatJobDateLabel(job: Pick<JobRow, 'start_at' | 'end_at' | 'created_at'>) {
  if (job.start_at && job.end_at) {
    return `${formatDate(job.start_at)} - ${formatDate(job.end_at)}`
  }

  if (job.start_at) return formatDate(job.start_at)
  if (job.end_at) return formatDate(job.end_at)
  return formatDate(job.created_at)
}

function asSingleRelation<T>(value: T[] | T | null | undefined): T | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

export async function getPortalJobs(customerId: string) {
  const admin = createSupabaseAdminClient()
  const { data: jobs, error } = await admin
    .from('jobs')
    .select('id, title, address, price, status, start_at, end_at, created_at, customer_summary')
    .eq('customer_id', customerId)
    .order('start_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Nepodařilo se načíst zakázky: ${error.message}`)
  }

  const jobRows = (jobs ?? []) as JobRow[]
  const ids = jobRows.map((job) => job.id)
  const { data: states } =
    ids.length > 0
      ? await admin
          .from('jobs_with_state')
          .select('id, time_state, work_state')
          .in('id', ids)
      : { data: [] }

  const stateMap = new Map<string, JobStateRow>(
    ((states ?? []) as JobStateRow[]).map((item) => [item.id, item])
  )

  return jobRows.map((job) => {
    const state = stateMap.get(job.id) ?? null
    return {
      id: job.id,
      title: job.title?.trim() || 'Zakázka bez názvu',
      location: job.address?.trim() || null,
      dateLabel: formatJobDateLabel(job),
      workPriceLabel: formatCurrency(job.price),
      customerStatus: mapPortalJobStatus({
        status: job.status,
        timeState: state?.time_state ?? null,
        workState: state?.work_state ?? null,
      }),
      customerSummary: job.customer_summary?.trim() || null,
      updatedAtLabel: formatDateTime(job.created_at),
      monthValue:
        getMonthValueFromDate(job.start_at) ??
        getMonthValueFromDate(job.end_at) ??
        getMonthValueFromDate(job.created_at),
    } satisfies PortalJobListItem
  })
}

export async function getPortalJobDetail(customerId: string, jobId: string) {
  const admin = createSupabaseAdminClient()
  const { data: job, error } = await admin
    .from('jobs')
    .select('id, title, address, price, status, start_at, end_at, created_at, customer_summary')
    .eq('customer_id', customerId)
    .eq('id', jobId)
    .maybeSingle()

  if (error) {
    throw new Error(`Nepodařilo se načíst detail zakázky: ${error.message}`)
  }

  if (!job) {
    return null
  }

  const { data: state } = await admin
    .from('jobs_with_state')
    .select('id, time_state, work_state')
    .eq('id', jobId)
    .maybeSingle()

  const { data: photos, error: photosError } = await admin
    .from('job_photos')
    .select('id, photo_type, file_name, taken_at, storage_path, thumb_storage_path')
    .eq('job_id', jobId)
    .order('taken_at', { ascending: false })

  if (photosError) {
    throw new Error(`Nepodařilo se načíst fotografie zakázky: ${photosError.message}`)
  }

  const photoRows = (photos ?? []) as JobPhotoRow[]
  const previewPaths = photoRows
    .map((photo) => photo.thumb_storage_path ?? photo.storage_path ?? null)
    .filter((value): value is string => Boolean(value))
  const imagePaths = photoRows
    .map((photo) => photo.storage_path ?? null)
    .filter((value): value is string => Boolean(value))

  const previewSignedUrls =
    previewPaths.length > 0
      ? await admin.storage.from(JOB_PHOTO_BUCKET).createSignedUrls(previewPaths, 60 * 30)
      : { data: [], error: null }
  const imageSignedUrls =
    imagePaths.length > 0
      ? await admin.storage.from(JOB_PHOTO_BUCKET).createSignedUrls(imagePaths, 60 * 30)
      : { data: [], error: null }

  if (previewSignedUrls.error) {
    throw new Error(`Nepodařilo se vytvořit náhledy fotek: ${previewSignedUrls.error.message}`)
  }

  if (imageSignedUrls.error) {
    throw new Error(`Nepodařilo se vytvořit URL fotek: ${imageSignedUrls.error.message}`)
  }

  const previewMap = new Map<string, string | null>()
  previewPaths.forEach((path, index) => {
    previewMap.set(path, previewSignedUrls.data?.[index]?.signedUrl ?? null)
  })

  const imageMap = new Map<string, string | null>()
  imagePaths.forEach((path, index) => {
    imageMap.set(path, imageSignedUrls.data?.[index]?.signedUrl ?? null)
  })

  const normalizedPhotos: PortalPhotoItem[] = photoRows.map((photo) => {
    const previewPath = photo.thumb_storage_path ?? photo.storage_path ?? null
    const fullPath = photo.storage_path ?? null
    return {
      id: photo.id,
      fileName: photo.file_name?.trim() || 'Fotografie',
      takenAtLabel: formatDateTime(photo.taken_at),
      previewUrl: previewPath ? previewMap.get(previewPath) ?? null : null,
      imageUrl: fullPath ? imageMap.get(fullPath) ?? null : null,
      photoType: photo.photo_type === 'after' ? 'after' : 'before',
    }
  })

  const jobRow = job as JobRow
  const stateRow = (state as JobStateRow | null) ?? null

  return {
    id: jobRow.id,
    title: jobRow.title?.trim() || 'Zakázka bez názvu',
    location: jobRow.address?.trim() || null,
    periodLabel: formatJobDateLabel(jobRow),
    workPriceLabel: formatCurrency(jobRow.price),
    customerStatus: mapPortalJobStatus({
      status: jobRow.status,
      timeState: stateRow?.time_state ?? null,
      workState: stateRow?.work_state ?? null,
    }),
    customerSummary: jobRow.customer_summary?.trim() || null,
    photosBefore: normalizedPhotos.filter((photo) => photo.photoType === 'before'),
    photosAfter: normalizedPhotos.filter((photo) => photo.photoType === 'after'),
  }
}

export async function getPortalInvoices(customerId: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('invoices')
    .select('id, invoice_number, variable_symbol, status, issue_date, due_date, total_with_vat, paid_at')
    .eq('customer_id', customerId)
    .or('status.is.null,status.neq.draft')
    .order('issue_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Nepodařilo se načíst faktury: ${error.message}`)
  }

  return ((data ?? []) as InvoiceRow[]).map((invoice) => {
    const canDownloadPdf =
      Boolean(invoice.invoice_number) &&
      ['issued', 'sent', 'paid', 'overdue'].includes(invoice.status ?? '')

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number?.trim() || 'Bez čísla',
      variableSymbol: invoice.variable_symbol?.trim() || null,
      statusLabel: formatInvoiceStatus(invoice.status),
      issueDateLabel: formatDate(invoice.issue_date),
      dueDateLabel: formatDate(invoice.due_date),
      totalWithVatLabel: formatCurrency(invoice.total_with_vat),
      paidAtLabel: invoice.paid_at ? formatDateTime(invoice.paid_at) : null,
      pdfHref: canDownloadPdf ? `/api/invoices/${invoice.id}/pdf` : null,
      detailHref: `/portal/invoices/${invoice.id}`,
      monthValue: getMonthValueFromDate(invoice.issue_date),
      monthLabel: formatMonthLabel(getMonthValueFromDate(invoice.issue_date)),
    } satisfies PortalInvoiceListItem
  })
}

export async function getPortalInvoiceDetail(customerId: string, invoiceId: string) {
  const admin = createSupabaseAdminClient()
  const [invoiceResult, itemsResult] = await Promise.all([
    admin
      .from('invoices')
      .select(
        'id, invoice_number, variable_symbol, status, issue_date, due_date, taxable_supply_date, payment_method, is_vat_payer, vat_note, subtotal_without_vat, vat_total, total_with_vat, paid_at, note, customer_snapshot, supplier_snapshot'
      )
      .eq('id', invoiceId)
      .eq('customer_id', customerId)
      .or('status.is.null,status.neq.draft')
      .maybeSingle(),
    admin
      .from('invoice_items')
      .select(
        'id, source_job_id, item_name, description, quantity, unit, unit_price_without_vat, vat_rate, vat_amount, total_without_vat, total_with_vat'
      )
      .eq('invoice_id', invoiceId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (invoiceResult.error) {
    throw new Error(`Nepodařilo se načíst fakturu: ${invoiceResult.error.message}`)
  }

  if (!invoiceResult.data) {
    return null
  }

  if (itemsResult.error) {
    throw new Error(`Nepodařilo se načíst položky faktury: ${itemsResult.error.message}`)
  }

  const invoice = invoiceResult.data as InvoiceRow
  const items = (itemsResult.data ?? []) as InvoiceItemRow[]
  const canDownloadPdf =
    Boolean(invoice.invoice_number) &&
    ['issued', 'sent', 'paid', 'overdue'].includes(invoice.status ?? '')
  const supplier = invoice.supplier_snapshot ?? null
  const customer = invoice.customer_snapshot ?? null
  const qrPaymentPayload = buildQrPaymentPayload({
    iban: getSnapshotString(supplier, 'iban'),
    bankAccountNumber: getSnapshotString(supplier, 'bankAccountNumber'),
    bankCode: getSnapshotString(supplier, 'bankCode'),
    amount: invoice.total_with_vat,
    variableSymbol: invoice.variable_symbol,
    invoiceNumber: invoice.invoice_number,
  })

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number?.trim() || 'Bez čísla',
    variableSymbol: invoice.variable_symbol?.trim() || null,
    statusLabel: formatInvoiceStatus(invoice.status),
    issueDateLabel: formatDate(invoice.issue_date),
    dueDateLabel: formatDate(invoice.due_date),
    taxableSupplyDateLabel: formatDate(invoice.taxable_supply_date),
    totalWithVatLabel: formatCurrency(invoice.total_with_vat),
    subtotalWithoutVatLabel: formatCurrency(invoice.subtotal_without_vat),
    vatTotalLabel: formatCurrency(invoice.vat_total),
    paidAtLabel: invoice.paid_at ? formatDateTime(invoice.paid_at) : null,
    paymentMethodLabel: formatPaymentMethodLabel(invoice.payment_method),
    vatPayerLabel: invoice.is_vat_payer ? 'Plátce DPH' : 'Neplátce DPH',
    vatNote: invoice.vat_note?.trim() || null,
    note: invoice.note?.trim() || null,
    pdfHref: canDownloadPdf ? `/api/invoices/${invoice.id}/pdf` : null,
    supplierName: getSnapshotString(supplier, 'billingName') || getSnapshotString(supplier, 'name') || 'Neuvedeno',
    supplierCompanyNumber: getSnapshotString(supplier, 'companyNumber'),
    supplierVatNumber: getSnapshotString(supplier, 'vatNumber'),
    supplierAddressLabel: formatAddressLabel(supplier),
    supplierBankAccountLabel: formatBankAccountLabel(supplier),
    customerName: getSnapshotString(customer, 'billingName') || getSnapshotString(customer, 'name') || 'Neuvedeno',
    customerCompanyNumber: getSnapshotString(customer, 'companyNumber'),
    customerVatNumber: getSnapshotString(customer, 'vatNumber'),
    customerAddressLabel: formatAddressLabel(customer),
    customerEmail: getSnapshotString(customer, 'email'),
    hasQrPayment: Boolean(qrPaymentPayload),
    items: items.map((item) => ({
      id: item.id,
      sourceJobId: item.source_job_id,
      itemName: item.item_name,
      description: item.description?.trim() || null,
      quantityLabel: new Intl.NumberFormat('cs-CZ', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(item.quantity ?? 0),
      unit: item.unit?.trim() || 'ks',
      unitPriceWithoutVatLabel: formatCurrency(item.unit_price_without_vat),
      vatRateLabel: `${item.vat_rate ?? 0} %`,
      vatAmountLabel: formatCurrency(item.vat_amount),
      totalWithVatLabel: formatCurrency(item.total_with_vat),
    })),
  } satisfies PortalInvoiceDetail
}

export async function getPortalOffers(customerId: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('quotes')
    .select(
      'id, quote_number, title, status, quote_date, valid_until, total_price, accepted_at'
    )
    .eq('customer_id', customerId)
    .order('quote_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Nepodařilo se načíst nabídky: ${error.message}`)
  }

  return ((data ?? []) as QuoteRow[]).map((quote) => ({
    id: quote.id,
    quoteNumber: quote.quote_number,
    title: quote.title,
    statusLabel: mapPortalOfferStatus(quote.status, quote.valid_until),
    summary:
      quote.customer_summary?.trim() ||
      quote.intro_text?.trim() ||
      quote.proposed_solution?.trim() ||
      null,
    totalPriceLabel: formatCurrency(quote.total_price),
    validUntilLabel: formatDate(quote.valid_until),
    canApprove: canPortalApproveOffer(quote),
  }) satisfies PortalOfferListItem)
}

export async function getPortalOfferDetail(customerId: string, offerId: string) {
  const admin = createSupabaseAdminClient()
  const [quoteResult, itemsResult] = await Promise.all([
    admin
      .from('quotes')
      .select(
        'id, quote_number, title, status, quote_date, valid_until, total_price, created_at, updated_at, accepted_at, profiles!quotes_created_by_fkey(full_name)'
      )
      .eq('customer_id', customerId)
      .eq('id', offerId)
      .maybeSingle(),
    admin
      .from('quote_items')
      .select('id, name, description, quantity, unit, unit_price, total_price, note')
      .eq('quote_id', offerId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (quoteResult.error) {
    throw new Error(`Nepodařilo se načíst detail nabídky: ${quoteResult.error.message}`)
  }

  if (itemsResult.error) {
    throw new Error(`Nepodařilo se načíst položky nabídky: ${itemsResult.error.message}`)
  }

  if (!quoteResult.data) {
    return null
  }

  const quote = {
    contact_name: null,
    contact_email: null,
    customer_request_title: null,
    customer_request: null,
    our_solution_title: null,
    timeline_title: null,
    pricing_title: null,
    payment_terms_title: null,
    benefits_text: null,
    intro_text: null,
    proposed_solution: null,
    pricing_text: null,
    work_description: null,
    work_schedule: null,
    payment_terms: null,
    customer_summary: null,
    customer_portal_approved_by: null,
    customer_portal_approved_note: null,
    ...(quoteResult.data as Omit<
      QuoteRow,
      | 'contact_name'
      | 'contact_email'
      | 'customer_request_title'
      | 'customer_request'
      | 'our_solution_title'
      | 'timeline_title'
      | 'pricing_title'
      | 'payment_terms_title'
      | 'benefits_text'
      | 'intro_text'
      | 'proposed_solution'
      | 'pricing_text'
      | 'work_description'
      | 'work_schedule'
      | 'payment_terms'
      | 'customer_summary'
      | 'customer_portal_approved_by'
      | 'customer_portal_approved_note'
    >),
  } as QuoteRow
  const profile = asSingleRelation(quote.profiles)

  return {
    id: quote.id,
    quoteNumber: quote.quote_number,
    title: quote.title,
    statusLabel: mapPortalOfferStatus(quote.status, quote.valid_until),
    quoteDateLabel: formatDate(quote.quote_date),
    validUntil: quote.valid_until,
    validUntilLabel: formatDate(quote.valid_until),
    totalPriceLabel: formatCurrency(quote.total_price),
    contactName: quote.contact_name?.trim() || null,
    contactEmail: quote.contact_email?.trim() || null,
    customerRequestTitle: quote.customer_request_title?.trim() || null,
    customerRequest: quote.customer_request?.trim() || null,
    solutionTitle: quote.our_solution_title?.trim() || null,
    timelineTitle: quote.timeline_title?.trim() || null,
    pricingTitle: quote.pricing_title?.trim() || null,
    paymentTermsTitle: quote.payment_terms_title?.trim() || null,
    benefitsText: quote.benefits_text?.trim() || null,
    preparedByName: profile?.full_name?.trim() || null,
    preparedAt: quote.created_at,
    updatedAt: quote.updated_at,
    priceTotal: quote.total_price,
    summary:
      quote.customer_summary?.trim() ||
      quote.intro_text?.trim() ||
      quote.proposed_solution?.trim() ||
      null,
    solution: quote.proposed_solution?.trim() || null,
    workDescription: quote.work_description?.trim() || null,
    schedule: quote.work_schedule?.trim() || null,
    paymentTerms: quote.payment_terms?.trim() || null,
    pricingText: quote.pricing_text?.trim() || null,
    canApprove: canPortalApproveOffer(quote),
    approvedAtLabel: quote.accepted_at ? formatDateTime(quote.accepted_at) : null,
    approvalNote: quote.customer_portal_approved_note?.trim() || null,
    items: ((itemsResult.data ?? []) as QuoteItemRow[]).map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unit_price,
      totalPrice: item.total_price,
      totalPriceLabel: formatCurrency(item.total_price),
      note: item.note,
    })),
  }
}

export async function getPortalInquiries(customerId: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('leads')
    .select('id, subject, location_text, message, customer_note, preferred_month, status, created_at, closed_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Nepodařilo se načíst poptávky: ${error.message}`)
  }

  return ((data ?? []) as LeadRow[]).map((lead) => ({
    id: lead.id,
    title: lead.subject?.trim() || 'Poptávka bez předmětu',
    location: lead.location_text?.trim() || null,
    statusLabel: mapPortalInquiryStatus(lead.status),
    preferredMonthLabel: formatMonthLabel(lead.preferred_month),
    createdAtLabel: formatDateTime(lead.created_at),
  }) satisfies PortalInquiryListItem)
}

export async function getPortalInquiryDetail(customerId: string, inquiryId: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('leads')
    .select('id, subject, location_text, message, customer_note, preferred_month, status, created_at, closed_at')
    .eq('customer_id', customerId)
    .eq('id', inquiryId)
    .maybeSingle()

  if (error) {
    throw new Error(`Nepodařilo se načíst detail poptávky: ${error.message}`)
  }

  if (!data) {
    return null
  }

  const inquiry = data as LeadRow
  return {
    id: inquiry.id,
    title: inquiry.subject?.trim() || 'Poptávka bez předmětu',
    location: inquiry.location_text?.trim() || null,
    description: inquiry.message?.trim() || null,
    note: inquiry.customer_note?.trim() || null,
    statusLabel: mapPortalInquiryStatus(inquiry.status),
    preferredMonthLabel: formatMonthLabel(inquiry.preferred_month),
    createdAtLabel: formatDateTime(inquiry.created_at),
    closedAtLabel: inquiry.closed_at ? formatDateTime(inquiry.closed_at) : null,
  }
}
