'use server'

import { revalidatePath } from 'next/cache'
import { redirect, unstable_rethrow } from 'next/navigation'

import {
  DEFAULT_INVOICE_DUE_DAYS,
  DEFAULT_INVOICE_VAT_RATE,
  NON_VAT_PAYER_NOTE,
  addDaysToDate,
  buildCustomerSnapshot,
  buildSupplierSnapshot,
  buildVariableSymbol,
  calculateInvoiceItem,
  sumInvoiceTotals,
  toDateInputValue,
} from '@/lib/invoices'
import { sendTransactionalEmail } from '@/lib/email/sendTransactionalEmail'
import { buildInvoicePdf, type InvoicePdfItemRow, type InvoicePdfRow } from '@/lib/invoice-pdf-safe'
import { requireHubAccess } from '@/lib/require-hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type JobRow = {
  id: string
  company_id: string
  customer_id: string | null
  title: string | null
  description: string | null
  price: number | null
  status: string | null
  start_at: string | null
  end_at: string | null
}

type JobStateRow = {
  id: string
  work_state: string | null
}

type InvoiceRow = {
  id: string
  company_id: string
  customer_id: string
  invoice_number: string | null
  variable_symbol: string | null
  invoice_year: number
  due_date: string | null
  status: string | null
  pohoda_export_status?: string | null
}

type InvoiceForXmlRow = InvoiceRow & {
  variable_symbol: string | null
  issue_date: string | null
  taxable_supply_date: string | null
  due_date: string | null
  payment_method: string | null
  currency: string | null
  subtotal_without_vat: number | null
  vat_total: number | null
  total_with_vat: number | null
  customer_snapshot: Record<string, unknown>
  supplier_snapshot: Record<string, unknown>
}

type InvoiceItemForXmlRow = {
  invoice_id: string
  item_name: string
  quantity: number | null
  unit: string | null
  unit_price_without_vat: number | null
  vat_rate: number | null
  vat_amount: number | null
  total_without_vat: number | null
  total_with_vat: number | null
}

type InvoiceForEmailRow = InvoiceRow & {
  currency: string | null
  issue_date: string | null
  taxable_supply_date: string | null
  payment_method: string | null
  is_vat_payer: boolean | null
  vat_note: string | null
  subtotal_without_vat: number | null
  vat_total: number | null
  total_with_vat: number | null
  customer_snapshot: Record<string, unknown>
  supplier_snapshot: Record<string, unknown>
  note: string | null
  sent_at: string | null
}

function getFormString(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim()
}

function getFormIds(formData: FormData, key: string) {
  return Array.from(
    new Set(
      formData
        .getAll(key)
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
    )
  )
}

function parseVatRate(value: string) {
  const parsed = Number(value.replace(',', '.'))
  if (!Number.isFinite(parsed)) return DEFAULT_INVOICE_VAT_RATE
  return Math.max(0, Math.min(100, parsed))
}

function parseMoneyInput(value: string) {
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(parsed)) return 0
  return parsed
}

function getOptionalFormString(formData: FormData, key: string) {
  const value = getFormString(formData, key)
  return value || null
}

function parseDateInput(value: string, fallback: Date) {
  if (!value) return fallback
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function xmlTag(name: string, value: unknown) {
  return `<${name}>${escapeXml(value)}</${name}>`
}

function getSnapshotValue(snapshot: Record<string, unknown>, key: string) {
  const value = snapshot[key]
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : ''
}

function getSnapshotString(snapshot: Record<string, unknown>, key: string) {
  const value = snapshot[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function generatePohodaXmlContent(
  invoices: InvoiceForXmlRow[],
  itemsByInvoiceId: Map<string, InvoiceItemForXmlRow[]>
) {
  const invoiceXml = invoices
    .map((invoice) => {
      const customer = invoice.customer_snapshot ?? {}
      const supplier = invoice.supplier_snapshot ?? {}
      const items = itemsByInvoiceId.get(invoice.id) ?? []

      return [
        '  <invoice>',
        `    ${xmlTag('number', invoice.invoice_number)}`,
        `    ${xmlTag('variableSymbol', invoice.variable_symbol)}`,
        `    ${xmlTag('issueDate', invoice.issue_date)}`,
        `    ${xmlTag('taxableSupplyDate', invoice.taxable_supply_date)}`,
        `    ${xmlTag('dueDate', invoice.due_date)}`,
        `    ${xmlTag('currency', invoice.currency ?? 'CZK')}`,
        `    ${xmlTag('paymentMethod', invoice.payment_method ?? 'bank_transfer')}`,
        '    <supplier>',
        `      ${xmlTag('name', getSnapshotValue(supplier, 'billingName') || getSnapshotValue(supplier, 'name'))}`,
        `      ${xmlTag('ico', getSnapshotValue(supplier, 'companyNumber'))}`,
        `      ${xmlTag('dic', getSnapshotValue(supplier, 'vatNumber'))}`,
        `      ${xmlTag('isVatPayer', getSnapshotValue(supplier, 'isVatPayer') || 'false')}`,
        `      ${xmlTag('vatNote', getSnapshotValue(supplier, 'vatNote'))}`,
        `      ${xmlTag('street', getSnapshotValue(supplier, 'billingStreet'))}`,
        `      ${xmlTag('city', getSnapshotValue(supplier, 'billingCity'))}`,
        `      ${xmlTag('postalCode', getSnapshotValue(supplier, 'billingPostalCode'))}`,
        `      ${xmlTag('country', getSnapshotValue(supplier, 'billingCountry'))}`,
        `      ${xmlTag('bankAccount', getSnapshotValue(supplier, 'bankAccountNumber'))}`,
        `      ${xmlTag('bankCode', getSnapshotValue(supplier, 'bankCode'))}`,
        `      ${xmlTag('iban', getSnapshotValue(supplier, 'iban'))}`,
        `      ${xmlTag('swift', getSnapshotValue(supplier, 'swiftBic'))}`,
        '    </supplier>',
        '    <customer>',
        `      ${xmlTag('name', getSnapshotValue(customer, 'billingName') || getSnapshotValue(customer, 'name'))}`,
        `      ${xmlTag('ico', getSnapshotValue(customer, 'companyNumber'))}`,
        `      ${xmlTag('dic', getSnapshotValue(customer, 'vatNumber'))}`,
        `      ${xmlTag('street', getSnapshotValue(customer, 'billingStreet'))}`,
        `      ${xmlTag('city', getSnapshotValue(customer, 'billingCity'))}`,
        `      ${xmlTag('postalCode', getSnapshotValue(customer, 'billingPostalCode'))}`,
        `      ${xmlTag('country', getSnapshotValue(customer, 'billingCountry'))}`,
        '    </customer>',
        '    <items>',
        ...items.map((item) =>
          [
            '      <item>',
            `        ${xmlTag('name', item.item_name)}`,
            `        ${xmlTag('quantity', item.quantity ?? 1)}`,
            `        ${xmlTag('unit', item.unit ?? 'ks')}`,
            `        ${xmlTag('unitPriceWithoutVat', item.unit_price_without_vat ?? 0)}`,
            `        ${xmlTag('vatRate', item.vat_rate ?? DEFAULT_INVOICE_VAT_RATE)}`,
            `        ${xmlTag('vatAmount', item.vat_amount ?? 0)}`,
            `        ${xmlTag('totalWithoutVat', item.total_without_vat ?? 0)}`,
            `        ${xmlTag('totalWithVat', item.total_with_vat ?? 0)}`,
            '      </item>',
          ].join('\n')
        ),
        '    </items>',
        `    ${xmlTag('subtotalWithoutVat', invoice.subtotal_without_vat ?? 0)}`,
        `    ${xmlTag('vatTotal', invoice.vat_total ?? 0)}`,
        `    ${xmlTag('totalWithVat', invoice.total_with_vat ?? 0)}`,
        '  </invoice>',
      ].join('\n')
    })
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<pohodaInvoiceExport format="diriqo-draft">',
    invoiceXml,
    '</pohodaInvoiceExport>',
  ].join('\n')
}

export async function createInvoiceFromJobs(formData: FormData) {
  const activeCompany = await requireHubAccess()
  const supabase = await createSupabaseServerClient()
  const customerId = getFormString(formData, 'customerId')
  const jobIds = getFormIds(formData, 'jobIds')
  const note = getFormString(formData, 'note') || null

  if (!customerId) {
    throw new Error('Vyberte zákazníka.')
  }

  if (jobIds.length === 0) {
    throw new Error('Vyberte alespoň jednu zakázku.')
  }

  const now = new Date()
  const issueDate = parseDateInput(getFormString(formData, 'issueDate'), now)
  const taxableSupplyDate = parseDateInput(getFormString(formData, 'taxableSupplyDate'), issueDate)
  const dueDate = parseDateInput(
    getFormString(formData, 'dueDate'),
    addDaysToDate(issueDate, DEFAULT_INVOICE_DUE_DAYS)
  )
  const invoiceYear = issueDate.getFullYear()

  const [companyResponse, customerResponse, jobsResponse, statesResponse, activeLinksResponse] =
    await Promise.all([
      supabase
        .from('companies')
        .select(
          'id, name, billing_name, company_number, vat_number, billing_street, billing_city, billing_postal_code, billing_country, bank_account_number, bank_code, iban, swift_bic'
        )
        .eq('id', activeCompany.companyId)
        .maybeSingle(),
      supabase
        .from('customers')
        .select(
          'id, name, email, phone, billing_name, billing_street, billing_city, billing_postal_code, billing_country, company_number, vat_number'
        )
        .eq('id', customerId)
        .eq('company_id', activeCompany.companyId)
        .maybeSingle(),
      supabase
        .from('jobs')
        .select('id, company_id, customer_id, title, description, price, status, start_at, end_at')
        .eq('company_id', activeCompany.companyId)
        .eq('customer_id', customerId)
        .in('id', jobIds),
      supabase.from('jobs_with_state').select('id, work_state').in('id', jobIds),
      supabase
        .from('invoice_jobs')
        .select('job_id')
        .eq('company_id', activeCompany.companyId)
        .eq('is_active', true)
        .in('job_id', jobIds),
    ])

  if (companyResponse.error || !companyResponse.data) {
    throw new Error(companyResponse.error?.message ?? 'Nepodařilo se načíst fakturační údaje firmy.')
  }

  if (customerResponse.error || !customerResponse.data) {
    throw new Error(customerResponse.error?.message ?? 'Zákazník nebyl nalezen v aktivní firmě.')
  }

  if (jobsResponse.error) {
    throw new Error(jobsResponse.error.message)
  }

  if (statesResponse.error) {
    throw new Error(statesResponse.error.message)
  }

  if (activeLinksResponse.error) {
    throw new Error(activeLinksResponse.error.message)
  }

  const jobs = (jobsResponse.data ?? []) as JobRow[]
  if (jobs.length !== jobIds.length) {
    throw new Error('Některé vybrané zakázky nepatří vybranému zákazníkovi nebo aktivní firmě.')
  }

  const alreadyInvoiced = new Set(
    ((activeLinksResponse.data ?? []) as Array<{ job_id: string }>).map((item) => item.job_id)
  )

  if (alreadyInvoiced.size > 0) {
    throw new Error('Některé vybrané zakázky už jsou na aktivní faktuře.')
  }

  const stateByJobId = new Map(
    ((statesResponse.data ?? []) as JobStateRow[]).map((state) => [state.id, state.work_state])
  )
  const invalidJob = jobs.find((job) => {
    const workState = stateByJobId.get(job.id)
    return workState !== 'done' && job.status !== 'done'
  })

  if (invalidJob) {
    throw new Error(`Zakázka "${invalidJob.title ?? invalidJob.id}" ještě není hotová.`)
  }

  const jobsWithoutPrice = jobs.filter((job) => Number(job.price ?? 0) <= 0)
  if (jobsWithoutPrice.length > 0) {
    throw new Error('Všechny fakturované zakázky musí mít vyplněnou cenu.')
  }

  const supplierSnapshot = buildSupplierSnapshot(companyResponse.data)
  const isVatPayer = supplierSnapshot.isVatPayer
  const vatRate = isVatPayer ? parseVatRate(getFormString(formData, 'vatRate')) : 0
  const invoiceNote = [note, isVatPayer ? null : NON_VAT_PAYER_NOTE]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n')
    .trim() || null

  const itemCalculations = jobs.map((job) => ({
    job,
    calculation: calculateInvoiceItem(job.price, vatRate),
  }))
  const totals = sumInvoiceTotals(itemCalculations.map((item) => item.calculation))

  const invoiceResponse = await supabase
    .from('invoices')
    .insert({
      company_id: activeCompany.companyId,
      customer_id: customerId,
      invoice_year: invoiceYear,
      status: 'draft',
      currency: 'CZK',
      issue_date: toDateInputValue(issueDate),
      taxable_supply_date: toDateInputValue(taxableSupplyDate),
      due_date: toDateInputValue(dueDate),
      payment_method: 'bank_transfer',
      is_vat_payer: isVatPayer,
      vat_note: isVatPayer ? null : NON_VAT_PAYER_NOTE,
      subtotal_without_vat: totals.subtotalWithoutVat,
      vat_total: totals.vatTotal,
      total_with_vat: totals.totalWithVat,
      customer_snapshot: buildCustomerSnapshot(customerResponse.data),
      supplier_snapshot: supplierSnapshot,
      note: invoiceNote,
      created_by: activeCompany.profileId,
    })
    .select('id')
    .single()

  if (invoiceResponse.error || !invoiceResponse.data?.id) {
    throw new Error(invoiceResponse.error?.message ?? 'Fakturu se nepodařilo vytvořit.')
  }

  const invoiceId = invoiceResponse.data.id as string
  const sortedItems = itemCalculations.sort((left, right) => {
    const leftDate = left.job.end_at ?? left.job.start_at ?? ''
    const rightDate = right.job.end_at ?? right.job.start_at ?? ''
    return leftDate.localeCompare(rightDate)
  })

  const itemsPayload = sortedItems.map(({ job, calculation }, index) => ({
    invoice_id: invoiceId,
    sort_order: index + 1,
    source_job_id: job.id,
    item_name: job.title?.trim() || `Zakázka ${index + 1}`,
    description: job.description ?? null,
    quantity: 1,
    unit: 'ks',
    unit_price_without_vat: calculation.unitPriceWithoutVat,
    vat_rate: calculation.vatRate,
    vat_amount: calculation.vatTotal,
    total_without_vat: calculation.subtotalWithoutVat,
    total_with_vat: calculation.totalWithVat,
    source_snapshot: {
      jobId: job.id,
      title: job.title,
      description: job.description,
      price: job.price,
      startAt: job.start_at,
      endAt: job.end_at,
    },
  }))

  const invoiceJobsPayload = jobs.map((job) => ({
    invoice_id: invoiceId,
    job_id: job.id,
    company_id: activeCompany.companyId,
    customer_id: customerId,
  }))

  const [itemsInsertResponse, invoiceJobsInsertResponse] = await Promise.all([
    supabase.from('invoice_items').insert(itemsPayload),
    supabase.from('invoice_jobs').insert(invoiceJobsPayload),
  ])

  if (itemsInsertResponse.error) {
    throw new Error(itemsInsertResponse.error.message)
  }

  if (invoiceJobsInsertResponse.error) {
    throw new Error(invoiceJobsInsertResponse.error.message)
  }

  revalidatePath('/invoices')
  redirect(`/invoices/${invoiceId}`)
}

async function getInvoiceForAction(invoiceId: string) {
  const activeCompany = await requireHubAccess()
  const supabase = await createSupabaseServerClient()
  const response = await supabase
    .from('invoices')
    .select('id, company_id, customer_id, invoice_number, variable_symbol, invoice_year, due_date, status, pohoda_export_status')
    .eq('id', invoiceId)
    .eq('company_id', activeCompany.companyId)
    .maybeSingle()

  if (response.error) {
    throw new Error(response.error.message)
  }

  if (!response.data) {
    throw new Error('Faktura nebyla nalezena.')
  }

  return {
    activeCompany,
    supabase,
    invoice: response.data as InvoiceRow,
  }
}

export async function issueInvoice(formData: FormData) {
  const invoiceId = getFormString(formData, 'invoiceId')
  const { activeCompany, supabase, invoice } = await getInvoiceForAction(invoiceId)

  if (invoice.status !== 'draft') {
    throw new Error('Vystavit lze jen fakturu ve stavu koncept.')
  }

  let invoiceNumber = invoice.invoice_number?.trim() || null
  if (!invoiceNumber) {
    const numberResponse = await supabase.rpc('next_invoice_number', {
    target_company_id: activeCompany.companyId,
    target_year: invoice.invoice_year,
  })

  if (numberResponse.error || !numberResponse.data) {
    throw new Error(numberResponse.error?.message ?? 'Nepodařilo se přidělit číslo faktury.')
  }

    invoiceNumber = String(numberResponse.data)
  }
  const issuedAt = new Date().toISOString()
  const linkedJobsResponse = await supabase
    .from('invoice_jobs')
    .select('job_id')
    .eq('invoice_id', invoice.id)
    .eq('company_id', activeCompany.companyId)
    .eq('is_active', true)
  if (linkedJobsResponse.error) throw new Error(linkedJobsResponse.error.message)

  const linkedJobIds = (linkedJobsResponse.data ?? []).map((item) => item.job_id)
  const [updateResponse, jobsResponse] = await Promise.all([
    supabase
      .from('invoices')
      .update({
        status: 'issued',
        invoice_number: invoiceNumber,
        variable_symbol: invoice.variable_symbol || buildVariableSymbol(invoiceNumber),
        issued_at: issuedAt,
      })
      .eq('id', invoice.id)
      .eq('company_id', activeCompany.companyId),
    linkedJobIds.length > 0
      ? supabase
          .from('jobs')
          .update({
            billing_status: 'due',
            invoiced_at: issuedAt,
            due_date: invoice.due_date,
            is_paid: false,
          })
          .eq('company_id', activeCompany.companyId)
          .in('id', linkedJobIds)
      : Promise.resolve({ error: null }),
  ])

  if (updateResponse.error) {
    throw new Error(updateResponse.error.message)
  }
  if (jobsResponse.error) throw new Error(jobsResponse.error.message)

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoice.id}`)
}

export async function refreshDraftInvoiceSupplierSnapshot(formData: FormData) {
  const invoiceId = getFormString(formData, 'invoiceId')
  const { activeCompany, supabase, invoice } = await getInvoiceForAction(invoiceId)

  if (invoice.status !== 'draft') {
    throw new Error('Údaje dodavatele lze obnovit jen u konceptu faktury.')
  }

  const companyResponse = await supabase
    .from('companies')
    .select(
      'id, name, billing_name, company_number, vat_number, billing_street, billing_city, billing_postal_code, billing_country, bank_account_number, bank_code, iban, swift_bic'
    )
    .eq('id', activeCompany.companyId)
    .maybeSingle()

  if (companyResponse.error || !companyResponse.data) {
    throw new Error(companyResponse.error?.message ?? 'Nepodařilo se načíst údaje firmy z Můj účet.')
  }

  const supplierSnapshot = buildSupplierSnapshot(companyResponse.data)
  const response = await supabase
    .from('invoices')
    .update({
      supplier_snapshot: supplierSnapshot,
      is_vat_payer: supplierSnapshot.isVatPayer,
      vat_note: supplierSnapshot.vatNote,
      note: supplierSnapshot.isVatPayer ? null : NON_VAT_PAYER_NOTE,
    })
    .eq('id', invoice.id)
    .eq('company_id', activeCompany.companyId)
    .eq('status', 'draft')

  if (response.error) {
    throw new Error(response.error.message)
  }

  revalidatePath(`/invoices/${invoice.id}`)
}

export async function updateDraftInvoice(formData: FormData) {
  const invoiceId = getFormString(formData, 'invoiceId')
  const { activeCompany, supabase, invoice } = await getInvoiceForAction(invoiceId)

  if (invoice.status !== 'draft') {
    throw new Error('Upravovat lze jen koncept faktury.')
  }

  const supplierVatNumber = getOptionalFormString(formData, 'supplierVatNumber')
  const isVatPayer = Boolean(supplierVatNumber)
  const vatNote = isVatPayer ? null : NON_VAT_PAYER_NOTE
  const invoiceNumber = getOptionalFormString(formData, 'invoiceNumber')
  const variableSymbolInput = getOptionalFormString(formData, 'variableSymbol')
  const variableSymbol = variableSymbolInput || (invoiceNumber ? buildVariableSymbol(invoiceNumber) : null)

  if (invoiceNumber) {
    const duplicateResponse = await supabase
      .from('invoices')
      .select('id')
      .eq('company_id', activeCompany.companyId)
      .eq('invoice_number', invoiceNumber)
      .neq('id', invoice.id)
      .limit(1)

    if (duplicateResponse.error) {
      throw new Error(duplicateResponse.error.message)
    }

    if ((duplicateResponse.data ?? []).length > 0) {
    throw new Error('Toto číslo faktury už v aktivní firmě existuje.')
    }
  }

  const supplierSnapshot = {
    id: activeCompany.companyId,
    name: getOptionalFormString(formData, 'supplierName'),
    billingName: getOptionalFormString(formData, 'supplierBillingName') ?? getOptionalFormString(formData, 'supplierName'),
    companyNumber: getOptionalFormString(formData, 'supplierCompanyNumber'),
    vatNumber: supplierVatNumber,
    billingStreet: getOptionalFormString(formData, 'supplierBillingStreet'),
    billingCity: getOptionalFormString(formData, 'supplierBillingCity'),
    billingPostalCode: getOptionalFormString(formData, 'supplierBillingPostalCode'),
    billingCountry: getOptionalFormString(formData, 'supplierBillingCountry'),
    bankAccountNumber: getOptionalFormString(formData, 'supplierBankAccountNumber'),
    bankCode: getOptionalFormString(formData, 'supplierBankCode'),
    iban: getOptionalFormString(formData, 'supplierIban'),
    swiftBic: getOptionalFormString(formData, 'supplierSwiftBic'),
    isVatPayer,
    vatNote,
  }
  const customerSnapshot = {
    id: invoice.customer_id,
    name: getOptionalFormString(formData, 'customerName'),
    email: getOptionalFormString(formData, 'customerEmail'),
    phone: getOptionalFormString(formData, 'customerPhone'),
    billingName: getOptionalFormString(formData, 'customerBillingName') ?? getOptionalFormString(formData, 'customerName'),
    billingStreet: getOptionalFormString(formData, 'customerBillingStreet'),
    billingCity: getOptionalFormString(formData, 'customerBillingCity'),
    billingPostalCode: getOptionalFormString(formData, 'customerBillingPostalCode'),
    billingCountry: getOptionalFormString(formData, 'customerBillingCountry'),
    companyNumber: getOptionalFormString(formData, 'customerCompanyNumber'),
    vatNumber: getOptionalFormString(formData, 'customerVatNumber'),
  }

  const itemIds = getFormIds(formData, 'itemIds')
  if (itemIds.length === 0) {
    throw new Error('Faktura musí mít alespoň jednu položku.')
  }

  const itemPayloads = itemIds.map((itemId, index) => {
    const itemName = getFormString(formData, `itemName_${itemId}`)
    if (!itemName) {
      throw new Error('Každá položka musí mít název.')
    }

    const quantity = parseMoneyInput(getFormString(formData, `itemQuantity_${itemId}`)) || 1
    const unitPriceWithoutVat = parseMoneyInput(getFormString(formData, `itemPrice_${itemId}`))
    const vatRate = isVatPayer ? parseVatRate(getFormString(formData, `itemVatRate_${itemId}`)) : 0
    const calculation = calculateInvoiceItem(unitPriceWithoutVat * quantity, vatRate)

    return {
      id: itemId,
      sort_order: index + 1,
      item_name: itemName,
      description: getOptionalFormString(formData, `itemDescription_${itemId}`),
      quantity,
      unit: getOptionalFormString(formData, `itemUnit_${itemId}`) ?? 'ks',
      unit_price_without_vat: unitPriceWithoutVat,
      vat_rate: calculation.vatRate,
      vat_amount: calculation.vatTotal,
      total_without_vat: calculation.subtotalWithoutVat,
      total_with_vat: calculation.totalWithVat,
    }
  })
  const totals = sumInvoiceTotals(
    itemPayloads.map((item) => ({
      subtotalWithoutVat: item.total_without_vat,
      vatTotal: item.vat_amount,
      totalWithVat: item.total_with_vat,
    }))
  )
  const now = new Date()
  const issueDate = parseDateInput(getFormString(formData, 'issueDate'), now)
  const taxableSupplyDate = parseDateInput(getFormString(formData, 'taxableSupplyDate'), issueDate)
  const dueDate = parseDateInput(
    getFormString(formData, 'dueDate'),
    addDaysToDate(issueDate, DEFAULT_INVOICE_DUE_DAYS)
  )
  const noteInput = getOptionalFormString(formData, 'note')
  const note = [noteInput, vatNote].filter((value): value is string => Boolean(value)).join('\n') || null

  const invoiceResponse = await supabase
    .from('invoices')
    .update({
      invoice_number: invoiceNumber,
      variable_symbol: variableSymbol,
      invoice_year: issueDate.getFullYear(),
      issue_date: toDateInputValue(issueDate),
      taxable_supply_date: toDateInputValue(taxableSupplyDate),
      due_date: toDateInputValue(dueDate),
      is_vat_payer: isVatPayer,
      vat_note: vatNote,
      supplier_snapshot: supplierSnapshot,
      customer_snapshot: customerSnapshot,
      subtotal_without_vat: totals.subtotalWithoutVat,
      vat_total: totals.vatTotal,
      total_with_vat: totals.totalWithVat,
      note,
    })
    .eq('id', invoice.id)
    .eq('company_id', activeCompany.companyId)
    .eq('status', 'draft')

  if (invoiceResponse.error) {
    throw new Error(invoiceResponse.error.message)
  }

  for (const item of itemPayloads) {
    const response = await supabase
      .from('invoice_items')
      .update({
        sort_order: item.sort_order,
        item_name: item.item_name,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price_without_vat: item.unit_price_without_vat,
        vat_rate: item.vat_rate,
        vat_amount: item.vat_amount,
        total_without_vat: item.total_without_vat,
        total_with_vat: item.total_with_vat,
      })
      .eq('id', item.id)
      .eq('invoice_id', invoice.id)

    if (response.error) {
      throw new Error(response.error.message)
    }
  }

  revalidatePath(`/invoices/${invoice.id}`)
  revalidatePath('/invoices')
}

export async function markInvoiceSent(formData: FormData) {
  const invoiceId = getFormString(formData, 'invoiceId')
  const { activeCompany, supabase, invoice } = await getInvoiceForAction(invoiceId)

  if (!['issued', 'sent'].includes(invoice.status ?? '')) {
    throw new Error('Jako odeslanou lze označit jen vystavenou fakturu.')
  }

  const response = await supabase
    .from('invoices')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    .eq('id', invoice.id)
    .eq('company_id', activeCompany.companyId)

  if (response.error) throw new Error(response.error.message)

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoice.id}`)
}

export async function sendInvoiceByEmail(formData: FormData) {
  const invoiceId = getFormString(formData, 'invoiceId')
  const customSubject = getFormString(formData, 'subject')
  const customMessage = getFormString(formData, 'message')
  const { activeCompany, supabase, invoice } = await getInvoiceForAction(invoiceId)
  const detailPath = `/invoices/${invoice.id}`

  if (!['issued', 'sent', 'overdue', 'paid'].includes(invoice.status ?? '')) {
    redirect(`${detailPath}?mailError=${encodeURIComponent('E-mailem lze odeslat jen vystavenou fakturu.')}`)
  }

  try {
    const [invoiceResponse, itemsResponse] = await Promise.all([
      supabase
        .from('invoices')
        .select(
          'id, company_id, customer_id, invoice_number, variable_symbol, status, currency, issue_date, taxable_supply_date, due_date, payment_method, is_vat_payer, vat_note, subtotal_without_vat, vat_total, total_with_vat, customer_snapshot, supplier_snapshot, note, sent_at'
        )
        .eq('id', invoice.id)
        .eq('company_id', activeCompany.companyId)
        .maybeSingle(),
      supabase
        .from('invoice_items')
        .select('item_name, quantity, unit, total_without_vat, vat_rate, vat_amount, total_with_vat')
        .eq('invoice_id', invoice.id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
    ])

    if (invoiceResponse.error || !invoiceResponse.data) {
      throw new Error(invoiceResponse.error?.message ?? 'Faktura nebyla nalezena.')
    }

    if (itemsResponse.error) {
      throw new Error(itemsResponse.error.message)
    }

    const emailInvoice = invoiceResponse.data as InvoiceForEmailRow
    const toEmail = getSnapshotString(emailInvoice.customer_snapshot, 'email')
    const toName =
      getSnapshotString(emailInvoice.customer_snapshot, 'billingName') ||
      getSnapshotString(emailInvoice.customer_snapshot, 'name')

    if (!toEmail) {
      throw new Error('Faktura nemá v customer snapshotu vyplněný e-mail odběratele.')
    }

    if (!emailInvoice.invoice_number?.trim()) {
      throw new Error('Faktura musí mít číslo, aby šla odeslat e-mailem.')
    }

    const pdf = buildInvoicePdf(
      emailInvoice as InvoicePdfRow,
      (itemsResponse.data ?? []) as InvoicePdfItemRow[]
    )
    const fileNumber = emailInvoice.invoice_number.replace(/[^\w-]/g, '') || emailInvoice.id
    const supplierName =
      getSnapshotString(emailInvoice.supplier_snapshot, 'billingName') ||
      getSnapshotString(emailInvoice.supplier_snapshot, 'name') ||
      'Diriqo'

    const defaultSubject = `Faktura ${emailInvoice.invoice_number}`
    const subject = customSubject || defaultSubject
    const defaultHtml = `
      <p>Dobrý den,</p>
      <p>v příloze zasíláme fakturu <strong>${emailInvoice.invoice_number}</strong>.</p>
      <p>Částka k úhradě: <strong>${emailInvoice.total_with_vat ?? 0} Kč</strong></p>
      <p>Datum splatnosti: <strong>${emailInvoice.due_date ?? '-'}</strong></p>
      <p>S pozdravem<br />${supplierName}</p>
    `
    const defaultText = [
      'Dobrý den,',
      '',
      `v příloze zasíláme fakturu ${emailInvoice.invoice_number}.`,
      `Částka k úhradě: ${emailInvoice.total_with_vat ?? 0} Kč`,
      `Datum splatnosti: ${emailInvoice.due_date ?? '-'}`,
      '',
      'S pozdravem',
      supplierName,
    ].join('\n')
    const text = customMessage || defaultText
    const html = customMessage
      ? text
          .split(/\r?\n\r?\n/)
          .map((paragraph) => `<p>${paragraph.replace(/\r?\n/g, '<br />')}</p>`)
          .join('')
      : defaultHtml

    await sendTransactionalEmail(
      {
        companyId: activeCompany.companyId,
        relatedEntityType: 'customer',
        relatedEntityId: emailInvoice.customer_id,
        customerId: emailInvoice.customer_id,
        contactId: null,
        messageType: 'invoice',
        toEmail: toEmail.toLowerCase(),
        toName,
        subject,
        html,
        text,
        attachments: [
          {
            filename: `faktura-${fileNumber}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
        triggeredByUserId: activeCompany.profileId,
        triggeredAutomatically: false,
      },
      supabase,
    )

    const sentAt = new Date().toISOString()
    const invoiceEmailUpdate: {
      sent_at: string
      status?: 'sent'
    } = {
      sent_at: sentAt,
    }

    if (emailInvoice.status === 'issued') {
      invoiceEmailUpdate.status = 'sent'
    }

    const updateResponse = await supabase
      .from('invoices')
      .update(invoiceEmailUpdate)
      .eq('id', emailInvoice.id)
      .eq('company_id', activeCompany.companyId)

    if (updateResponse.error) {
      throw new Error(updateResponse.error.message)
    }

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${emailInvoice.id}`)
    redirect(`${detailPath}?mail=sent`)
  } catch (error) {
    unstable_rethrow(error)
    const message = error instanceof Error ? error.message : 'Nepodařilo se odeslat fakturu e-mailem.'
    console.error('[INVOICE_EMAIL_SEND]', { invoiceId: invoice.id, message, error })
    redirect(`${detailPath}?mailError=${encodeURIComponent(message)}`)
  }
}

export async function markInvoicePaid(formData: FormData) {
  const invoiceId = getFormString(formData, 'invoiceId')
  const { activeCompany, supabase, invoice } = await getInvoiceForAction(invoiceId)

  if (!['issued', 'sent', 'overdue', 'paid'].includes(invoice.status ?? '')) {
    throw new Error('Jako zaplacenou lze označit jen vystavenou fakturu.')
  }

  const paidAt = new Date().toISOString()
  const linkedJobsResponse = await supabase
    .from('invoice_jobs')
    .select('job_id')
    .eq('invoice_id', invoice.id)
    .eq('company_id', activeCompany.companyId)
    .eq('is_active', true)
  if (linkedJobsResponse.error) throw new Error(linkedJobsResponse.error.message)

  const linkedJobIds = (linkedJobsResponse.data ?? []).map((item) => item.job_id)
  const [response, jobsResponse] = await Promise.all([
    supabase
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: paidAt,
      })
      .eq('id', invoice.id)
      .eq('company_id', activeCompany.companyId),
    linkedJobIds.length > 0
      ? supabase
          .from('jobs')
          .update({
            billing_status: 'paid',
            paid_at: paidAt,
            is_paid: true,
          })
          .eq('company_id', activeCompany.companyId)
          .in('id', linkedJobIds)
      : Promise.resolve({ error: null }),
  ])

  if (response.error) throw new Error(response.error.message)
  if (jobsResponse.error) throw new Error(jobsResponse.error.message)

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoice.id}`)
}

export async function cancelInvoice(formData: FormData) {
  const invoiceId = getFormString(formData, 'invoiceId')
  const { activeCompany, supabase, invoice } = await getInvoiceForAction(invoiceId)

  if (invoice.status === 'paid') {
    throw new Error('Zaplacenou fakturu nelze zrušit bez opravného dokladu.')
  }

  if (invoice.pohoda_export_status === 'exported') {
    throw new Error('Exportovanou fakturu nelze běžně zrušit. Bude potřeba storno/dobropis workflow.')
  }

  const linkedJobsResponse = await supabase
    .from('invoice_jobs')
    .select('job_id')
    .eq('invoice_id', invoice.id)
    .eq('company_id', activeCompany.companyId)
    .eq('is_active', true)
  if (linkedJobsResponse.error) throw new Error(linkedJobsResponse.error.message)

  const linkedJobIds = (linkedJobsResponse.data ?? []).map((item) => item.job_id)
  const shouldResetLinkedJobs = invoice.status !== 'draft'
  const [invoiceResponse, linksResponse, jobsResponse] = await Promise.all([
    supabase
      .from('invoices')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', invoice.id)
      .eq('company_id', activeCompany.companyId),
    supabase
      .from('invoice_jobs')
      .update({ is_active: false })
      .eq('invoice_id', invoice.id)
      .eq('company_id', activeCompany.companyId),
    shouldResetLinkedJobs && linkedJobIds.length > 0
      ? supabase
          .from('jobs')
          .update({
            billing_status: 'waiting_for_invoice',
            invoiced_at: null,
            due_date: null,
            paid_at: null,
            is_paid: false,
          })
          .eq('company_id', activeCompany.companyId)
          .in('id', linkedJobIds)
      : Promise.resolve({ error: null }),
  ])

  if (invoiceResponse.error) throw new Error(invoiceResponse.error.message)
  if (linksResponse.error) throw new Error(linksResponse.error.message)
  if (jobsResponse.error) throw new Error(jobsResponse.error.message)

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoice.id}`)
}

export async function deleteInvoicePermanently(formData: FormData) {
  const invoiceId = getFormString(formData, 'invoiceId')
  const { activeCompany, supabase, invoice } = await getInvoiceForAction(invoiceId)

  if (invoice.pohoda_export_status === 'exported') {
    throw new Error('Exportovanou fakturu nejde smazat natrvalo. Nejdřív je potřeba účetní storno postup.')
  }

  const linkedJobsResponse = await supabase
    .from('invoice_jobs')
    .select('job_id')
    .eq('invoice_id', invoice.id)
    .eq('company_id', activeCompany.companyId)
    .eq('is_active', true)
  if (linkedJobsResponse.error) throw new Error(linkedJobsResponse.error.message)

  const linkedJobIds = (linkedJobsResponse.data ?? []).map((item) => item.job_id)
  if (invoice.status !== 'draft' && linkedJobIds.length > 0) {
    const jobsResponse = await supabase
      .from('jobs')
      .update({
        billing_status: 'waiting_for_invoice',
        invoiced_at: null,
        due_date: null,
        paid_at: null,
        is_paid: false,
      })
      .eq('company_id', activeCompany.companyId)
      .in('id', linkedJobIds)

    if (jobsResponse.error) throw new Error(jobsResponse.error.message)
  }

  const [exportLinksResponse, invoiceJobsResponse, itemsResponse] = await Promise.all([
    supabase
      .from('pohoda_export_invoices')
      .delete()
      .eq('invoice_id', invoice.id)
      .eq('company_id', activeCompany.companyId),
    supabase
      .from('invoice_jobs')
      .delete()
      .eq('invoice_id', invoice.id)
      .eq('company_id', activeCompany.companyId),
    supabase.from('invoice_items').delete().eq('invoice_id', invoice.id),
  ])

  if (exportLinksResponse.error) throw new Error(exportLinksResponse.error.message)
  if (invoiceJobsResponse.error) throw new Error(invoiceJobsResponse.error.message)
  if (itemsResponse.error) throw new Error(itemsResponse.error.message)

  const invoiceResponse = await supabase
    .from('invoices')
    .delete()
    .eq('id', invoice.id)
    .eq('company_id', activeCompany.companyId)

  if (invoiceResponse.error) throw new Error(invoiceResponse.error.message)

  revalidatePath('/invoices')
  redirect('/invoices')
}

export async function exportInvoicesToPohoda(formData: FormData) {
  const activeCompany = await requireHubAccess()
  const supabase = await createSupabaseServerClient()
  const invoiceIds = getFormIds(formData, 'invoiceIds')

  if (invoiceIds.length === 0) {
    throw new Error('Vyberte alespoň jednu fakturu k exportu.')
  }

  const invoicesResponse = await supabase
    .from('invoices')
    .select(
      'id, company_id, customer_id, invoice_number, invoice_year, variable_symbol, issue_date, taxable_supply_date, due_date, payment_method, currency, subtotal_without_vat, vat_total, total_with_vat, customer_snapshot, supplier_snapshot, status, pohoda_export_status'
    )
    .eq('company_id', activeCompany.companyId)
    .in('id', invoiceIds)

  if (invoicesResponse.error) throw new Error(invoicesResponse.error.message)

  const invoices = (invoicesResponse.data ?? []) as InvoiceForXmlRow[]
  if (invoices.length !== invoiceIds.length) {
    throw new Error('Některé faktury nebyly nalezeny v aktivní firmě.')
  }

  const invalidInvoice = invoices.find(
    (invoice) =>
      !invoice.invoice_number ||
      !['issued', 'sent', 'paid', 'overdue'].includes(invoice.status ?? '')
  )

  if (invalidInvoice) {
    throw new Error('Exportovat lze jen vystavené faktury s přiděleným číslem.')
  }

  const itemsResponse = await supabase
    .from('invoice_items')
    .select(
      'invoice_id, item_name, quantity, unit, unit_price_without_vat, vat_rate, vat_amount, total_without_vat, total_with_vat'
    )
    .in('invoice_id', invoiceIds)
    .order('sort_order', { ascending: true })

  if (itemsResponse.error) throw new Error(itemsResponse.error.message)

  const itemsByInvoiceId = new Map<string, InvoiceItemForXmlRow[]>()
  for (const item of (itemsResponse.data ?? []) as InvoiceItemForXmlRow[]) {
    const list = itemsByInvoiceId.get(item.invoice_id) ?? []
    list.push(item)
    itemsByInvoiceId.set(item.invoice_id, list)
  }

  const xmlContent = generatePohodaXmlContent(invoices, itemsByInvoiceId)
  const exportResponse = await supabase
    .from('pohoda_exports')
    .insert({
      company_id: activeCompany.companyId,
      export_type: 'issued_invoices',
      status: 'generated',
      xml_content: xmlContent,
      invoice_count: invoices.length,
      created_by: activeCompany.profileId,
      exported_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (exportResponse.error || !exportResponse.data?.id) {
    throw new Error(exportResponse.error?.message ?? 'Nepodařilo se vytvořit export do Pohody.')
  }

  const exportId = exportResponse.data.id as string
  const [linkResponse, invoiceUpdateResponse] = await Promise.all([
    supabase.from('pohoda_export_invoices').insert(
      invoices.map((invoice) => ({
        export_id: exportId,
        invoice_id: invoice.id,
        company_id: activeCompany.companyId,
        status: 'exported',
      }))
    ),
    supabase
      .from('invoices')
      .update({
        pohoda_export_status: 'exported',
        pohoda_exported_at: new Date().toISOString(),
        pohoda_last_error: null,
        pohoda_last_export_id: exportId,
      })
      .eq('company_id', activeCompany.companyId)
      .in('id', invoiceIds),
  ])

  if (linkResponse.error) throw new Error(linkResponse.error.message)
  if (invoiceUpdateResponse.error) throw new Error(invoiceUpdateResponse.error.message)

  revalidatePath('/invoices')
  redirect(`/api/pohoda-exports/${exportId}/download`)
}
