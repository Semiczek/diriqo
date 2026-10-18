'use server'

import { revalidatePath } from 'next/cache'
import { redirect, unstable_rethrow } from 'next/navigation'

import { DEFAULT_INVOICE_VAT_RATE } from '@/lib/invoices'
import { sendTransactionalEmail } from '@/lib/email/sendTransactionalEmail'
import { buildInvoicePdf, type InvoicePdfItemRow, type InvoicePdfRow } from '@/lib/invoice-pdf-safe'
import { requireHubAccess } from '@/lib/require-hub-access'
import { deleteInvoiceDraftAtomic } from '@/lib/dal/invoices'
import { cancelInvoiceAtomic, markInvoicePaidAtomic, InvoiceSettlementError, type InvoiceSettlementResult } from '@/lib/dal/invoice-settlement'
import { createInvoiceFromJobsAtomic, InvoiceDraftError, invoiceDraftWriteError, InvoiceDraftEditError, invoiceDraftEditError, updateInvoiceDraftAtomic, refreshInvoiceSupplierAtomic, issueInvoiceRevisionAtomic } from '@/lib/dal/invoice-drafts'
import { createSupabaseServerClient } from '@/lib/supabase-server'

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

function getOptionalFormString(formData: FormData, key: string) {
  const value = getFormString(formData, key)
  return value || null
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
  // A form left open before a company switch must never write into the new company.
  if (getFormString(formData, 'companyId').toLowerCase() !== activeCompany.companyId.toLowerCase()) {
    throw new InvoiceDraftError('Aktivní firma se změnila. Znovu otevřete tvorbu faktury v požadované firmě.')
  }
  const supabase = await createSupabaseServerClient()
  const vatText = getFormString(formData, 'vatRate')
  const vatRate = vatText === '' ? 0
    : /^\d{1,3}(?:[.,]\d{1,2})?$/.test(vatText) ? Number(vatText.replace(',', '.')) : NaN
  const result = await createInvoiceFromJobsAtomic({ supabase, companyId: activeCompany.companyId }, {
    customerId: getFormString(formData, 'customerId'),
    jobIds: formData.getAll('jobIds').map((value) => String(value).trim()),
    issueDate: getFormString(formData, 'issueDate'),
    taxableSupplyDate: getFormString(formData, 'taxableSupplyDate'),
    dueDate: getFormString(formData, 'dueDate'),
    vatRate,
    note: getFormString(formData, 'note') || null,
    requestId: getFormString(formData, 'requestId'),
  })
  revalidatePath('/invoices')
  revalidatePath('/invoices/new')
  redirect(`/invoices/${result.invoiceId}`)
}

export async function createInvoiceDraftAction(
  _previousState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  try {
    await createInvoiceFromJobs(formData)
    return { error: null }
  } catch (error) {
    unstable_rethrow(error)
    return { error: error instanceof InvoiceDraftError ? error.message : invoiceDraftWriteError(null).message }
  }
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

async function getInvoiceEditContext(formData: FormData) {
  const activeCompany = await requireHubAccess()
  if (getFormString(formData, 'companyId').toLowerCase() !== activeCompany.companyId.toLowerCase()) {
    throw new InvoiceDraftEditError('Aktivní firma se změnila. Načtěte fakturu v požadované firmě.', true)
  }
  const supabase = await createSupabaseServerClient()
  return { supabase, companyId: activeCompany.companyId }
}

function getInvoiceEditIdentity(formData: FormData) {
  return {
    invoiceId: getFormString(formData, 'invoiceId'),
    expectedRevision: getFormString(formData, 'revision'),
    // Do not deduplicate or remove empty IDs: malformed sets must fail closed.
    expectedItemIds: formData.getAll('itemIds').map(value => String(value).trim()),
  }
}

export async function issueInvoice(formData: FormData) {
  const ctx = await getInvoiceEditContext(formData)
  const result = await issueInvoiceRevisionAtomic(ctx, getInvoiceEditIdentity(formData))
  revalidatePath('/invoices')
  revalidatePath(`/invoices/${result.invoiceId}`)
  revalidatePath('/jobs')
}

export async function refreshDraftInvoiceSupplierSnapshot(formData: FormData) {
  const ctx = await getInvoiceEditContext(formData)
  const result = await refreshInvoiceSupplierAtomic(ctx, getInvoiceEditIdentity(formData))
  revalidatePath(`/invoices/${result.invoiceId}`)
  revalidatePath('/invoices')
}

export async function updateDraftInvoice(formData: FormData) {
  const ctx = await getInvoiceEditContext(formData)
  const identity = getInvoiceEditIdentity(formData)
  const snapshot = (prefix: string, keys: string[]) => Object.fromEntries(keys.map(key => [
    key, getOptionalFormString(formData, `${prefix}${key[0].toUpperCase()}${key.slice(1)}`),
  ]))
  const common = ['name', 'billingName', 'companyNumber', 'vatNumber', 'billingStreet', 'billingCity', 'billingPostalCode', 'billingCountry']
  const decimal = (name: string) => getFormString(formData, name).replace(',', '.')
  const result = await updateInvoiceDraftAtomic(ctx, {
    ...identity,
    header: {
      invoiceNumber: getOptionalFormString(formData, 'invoiceNumber'),
      variableSymbol: getOptionalFormString(formData, 'variableSymbol'),
      issueDate: getFormString(formData, 'issueDate'),
      taxableSupplyDate: getFormString(formData, 'taxableSupplyDate'),
      dueDate: getFormString(formData, 'dueDate'),
      note: getOptionalFormString(formData, 'note'),
      supplier: snapshot('supplier', [...common, 'bankAccountNumber', 'bankCode', 'iban', 'swiftBic']),
      customer: snapshot('customer', [...common, 'email', 'phone']),
    },
    items: identity.expectedItemIds.map(id => ({
      id, itemName: getFormString(formData, `itemName_${id}`),
      description: getOptionalFormString(formData, `itemDescription_${id}`),
      quantity: decimal(`itemQuantity_${id}`), unit: getOptionalFormString(formData, `itemUnit_${id}`),
      unitPriceWithoutVat: decimal(`itemPrice_${id}`), vatRate: decimal(`itemVatRate_${id}`),
    })),
  })
  revalidatePath(`/invoices/${result.invoiceId}`)
  revalidatePath('/invoices')
}

export type InvoiceDraftActionState = { error: string | null; reloadRequired: boolean }

async function runInvoiceDraftAction(action: (data: FormData) => Promise<void>, formData: FormData): Promise<InvoiceDraftActionState> {
  try {
    await action(formData)
    return { error: null, reloadRequired: false }
  } catch (error) {
    unstable_rethrow(error)
    const safe = error instanceof InvoiceDraftEditError || error instanceof InvoiceSettlementError ? error : invoiceDraftEditError(null)
    return { error: safe.message, reloadRequired: safe.reloadRequired }
  }
}

export async function updateInvoiceDraftAction(_state: InvoiceDraftActionState, formData: FormData) {
  return runInvoiceDraftAction(updateDraftInvoice, formData)
}

export async function refreshInvoiceSupplierAction(_state: InvoiceDraftActionState, formData: FormData) {
  return runInvoiceDraftAction(refreshDraftInvoiceSupplierSnapshot, formData)
}

export async function issueInvoiceRevisionAction(_state: InvoiceDraftActionState, formData: FormData) {
  return runInvoiceDraftAction(issueInvoice, formData)
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
    .in('status', ['issued', 'sent'])
    .select('id')
    .maybeSingle()

  if (response.error || !response.data?.id) {
    throw new Error('Stav faktury se změnil nebo se změnu nepodařilo potvrdit. Načtěte aktuální fakturu.')
  }

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
    if (!['issued', 'sent', 'overdue', 'paid'].includes(emailInvoice.status ?? '')) {
      throw new Error('E-mailem lze odeslat jen vystavenou fakturu. Načtěte její aktuální stav.')
    }
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
    try {
      // Decide from the current row, not the pre-send snapshot: payment may have won.
      let updateResponse = await supabase
        .from('invoices')
        .update({ status: 'sent', sent_at: sentAt })
        .eq('id', emailInvoice.id)
        .eq('company_id', activeCompany.companyId)
        .eq('status', 'issued')
        .select('id')
        .maybeSingle()

      if (!updateResponse.error && !updateResponse.data) {
        updateResponse = await supabase
          .from('invoices')
          .update({ sent_at: sentAt })
          .eq('id', emailInvoice.id)
          .eq('company_id', activeCompany.companyId)
          .in('status', ['issued', 'sent', 'paid', 'overdue'])
          .select('id')
          .maybeSingle()
      }
      if (updateResponse.error || !updateResponse.data?.id) throw new Error('INVOICE_EMAIL_BOOKKEEPING_UNCONFIRMED')
    } catch {
      // This also covers a lost database response after the mail provider accepted the email.
      throw new Error('E-mail byl odeslán, ale stav faktury se nepodařilo potvrdit. Načtěte aktuální fakturu; e-mail znovu neodesílejte.')
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

function revalidateInvoiceSettlement(result: InvoiceSettlementResult) {
  revalidatePath('/invoices')
  revalidatePath(`/invoices/${result.invoiceId}`)
  revalidatePath('/jobs')
  for (const jobId of result.jobIds) revalidatePath(`/jobs/${jobId}`)
}

export async function markInvoicePaid(formData: FormData) {
  const ctx = await getInvoiceEditContext(formData)
  const result = await markInvoicePaidAtomic(ctx, {
    invoiceId: getFormString(formData, 'invoiceId'),
    expectedRevision: getFormString(formData, 'revision'),
  })
  revalidateInvoiceSettlement(result)
}

export async function cancelInvoice(formData: FormData) {
  const ctx = await getInvoiceEditContext(formData)
  const result = await cancelInvoiceAtomic(ctx, {
    invoiceId: getFormString(formData, 'invoiceId'),
    expectedRevision: getFormString(formData, 'revision'),
  })
  revalidateInvoiceSettlement(result)
}

export async function markInvoicePaidAction(_state: InvoiceDraftActionState, formData: FormData) {
  return runInvoiceDraftAction(markInvoicePaid, formData)
}

export async function cancelInvoiceAction(_state: InvoiceDraftActionState, formData: FormData) {
  return runInvoiceDraftAction(cancelInvoice, formData)
}

export async function deleteInvoicePermanently(formData: FormData) {
  const invoiceId = getFormString(formData, 'invoiceId')
  const activeCompany = await requireHubAccess()
  const supabase = await createSupabaseServerClient()
  await deleteInvoiceDraftAtomic({ supabase, companyId: activeCompany.companyId }, invoiceId)

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
