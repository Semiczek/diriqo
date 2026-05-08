import 'server-only'

import { randomBytes } from 'crypto'

import type { DalContext, SupabaseServerClient } from '@/lib/dal/auth'
import { TenantScopeError } from '@/lib/dal/companies'
import { canAcceptQuote, canCreateJobFromQuote, canIssueInvoice } from '@/lib/flow-status'

type CalculationItemRow = {
  sort_order: number | null
  name: string | null
  description: string | null
  quantity: number | string | null
  unit: string | null
  unit_price: number | string | null
  vat_rate: number | string | null
  total_price: number | string | null
  note: string | null
}

type FlowContext = {
  supabase: Pick<SupabaseServerClient, 'from'>
  companyId: string
  profileId?: string | null
}

function nowIso() {
  return new Date().toISOString()
}

function buildShareToken() {
  return randomBytes(24).toString('hex')
}

function buildShareTokenExpiresAt() {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)
  return expiresAt.toISOString()
}

function buildQuoteNumber() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const suffix = randomBytes(2).toString('hex').toUpperCase()
  return `CN-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}-${suffix}`
}

function toMoney(value: unknown) {
  const numberValue = Number(value ?? 0)
  if (!Number.isFinite(numberValue)) return 0
  return Math.round(numberValue * 100) / 100
}

async function findExistingJobForQuote(ctx: FlowContext, quoteId: string) {
  const { data, error } = await ctx.supabase
    .from('jobs')
    .select('id')
    .eq('company_id', ctx.companyId)
    .eq('source_quote_id', quoteId)
    .is('parent_job_id', null)
    .maybeSingle()

  if (error) throw error
  return data?.id ?? null
}

export async function createQuoteFromCalculation(ctx: DalContext, calculationId: string) {
  const existingQuote = await ctx.supabase
    .from('quotes')
    .select('id')
    .eq('company_id', ctx.companyId)
    .eq('source_calculation_id', calculationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingQuote.error) throw existingQuote.error
  if (existingQuote.data?.id) return { quoteId: existingQuote.data.id, created: false }

  const { data: calculation, error: calculationError } = await ctx.supabase
    .from('calculations')
    .select('id, customer_id, title, subtotal_price, total_price, currency')
    .eq('id', calculationId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  if (calculationError || !calculation?.id) {
    throw new TenantScopeError('Kalkulace nepatri do aktivni firmy.')
  }

  if (!calculation.customer_id) {
    throw new Error('Kalkulace nema zakaznika pro vytvoreni nabidky.')
  }

  const { data: items, error: itemsError } = await ctx.supabase
    .from('calculation_items')
    .select('sort_order, name, description, quantity, unit, unit_price, vat_rate, total_price, note')
    .eq('calculation_id', calculationId)
    .eq('item_type', 'customer')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (itemsError) throw itemsError

  const customerItems = ((items ?? []) as CalculationItemRow[]).filter(
    (item) => item.name?.trim() && toMoney(item.total_price) > 0,
  )

  if (customerItems.length === 0) {
    throw new Error('Kalkulace nema zadne zakaznicke polozky pro vytvoreni nabidky.')
  }

  const { data: quote, error: quoteError } = await ctx.supabase
    .from('quotes')
    .insert({
      company_id: ctx.companyId,
      customer_id: calculation.customer_id,
      source_calculation_id: calculationId,
      quote_number: buildQuoteNumber(),
      share_token: buildShareToken(),
      share_token_scope: 'quote_public_offer',
      share_token_expires_at: buildShareTokenExpiresAt(),
      share_token_revoked_at: null,
      title: calculation.title,
      status: 'draft',
      quote_date: new Date().toISOString().slice(0, 10),
      subtotal_price: toMoney(calculation.subtotal_price ?? calculation.total_price),
      total_price: toMoney(calculation.total_price ?? calculation.subtotal_price),
      currency: calculation.currency ?? 'CZK',
      created_by: ctx.profileId,
    })
    .select('id')
    .single()

  if (quoteError || !quote?.id) throw quoteError ?? new Error('Nabidku se nepodarilo vytvorit.')

  const quoteItems = customerItems.map((item) => ({
    company_id: ctx.companyId,
    quote_id: quote.id,
    sort_order: item.sort_order ?? 0,
    name: item.name?.trim() || 'Polozka',
    description: item.description ?? null,
    quantity: Number(item.quantity ?? 0),
    unit: item.unit ?? null,
    unit_price: toMoney(item.unit_price),
    vat_rate: Number(item.vat_rate ?? 0),
    total_price: toMoney(item.total_price),
    note: item.note ?? null,
  }))

  const { error: quoteItemsError } = await ctx.supabase.from('quote_items').insert(quoteItems)
  if (quoteItemsError) throw quoteItemsError

  return { quoteId: quote.id, created: true }
}

export async function approveQuote(ctx: FlowContext, quoteId: string) {
  const { data: quote, error: quoteError } = await ctx.supabase
    .from('quotes')
    .select('id, status, accepted_at')
    .eq('id', quoteId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  if (quoteError || !quote?.id) throw new TenantScopeError('Nabidka nepatri do aktivni firmy.')

  if (quote.accepted_at || quote.status === 'accepted') {
    return { accepted: false, alreadyAccepted: true }
  }

  if (!canAcceptQuote(quote.status, quote.accepted_at)) {
    throw new Error('Tuto nabidku uz neni mozne schvalit.')
  }

  const { data: updated, error: updateError } = await ctx.supabase
    .from('quotes')
    .update({
      status: 'accepted',
      accepted_at: nowIso(),
    })
    .eq('id', quoteId)
    .eq('company_id', ctx.companyId)
    .is('accepted_at', null)
    .select('id')

  if (updateError) throw updateError

  return { accepted: Boolean(updated?.length), alreadyAccepted: false }
}

export async function acceptPublicOffer(ctx: FlowContext & { visitorId?: string | null }, quoteId: string) {
  const result = await approveQuote(ctx, quoteId)

  if (result.accepted) {
    await ctx.supabase.from('offer_events').insert({
      company_id: ctx.companyId,
      quote_id: quoteId,
      event_type: 'portal_offer_approved',
      visitor_id: ctx.visitorId ?? null,
    })
  }

  return result
}

export async function createJobFromQuote(
  ctx: DalContext,
  input: {
    quoteId: string
    title: string
    description: string | null
    address: string | null
    startAt: string
    endAt: string
    splitDays?: {
      label: string
      startAt: string
      endAt: string
    }[]
  },
) {
  const existingJobId = await findExistingJobForQuote(ctx, input.quoteId)
  if (existingJobId) return { jobId: existingJobId, created: false }

  const { data: quote, error: quoteError } = await ctx.supabase
    .from('quotes')
    .select('id, customer_id, title, status, accepted_at, total_price')
    .eq('id', input.quoteId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  if (quoteError || !quote?.id) throw new TenantScopeError('Nabidka nepatri do aktivni firmy.')
  if (!canCreateJobFromQuote(quote.status)) throw new Error('Z teto nabidky uz nelze vytvorit zakazku.')

  const baseJob = {
    company_id: ctx.companyId,
    customer_id: quote.customer_id,
    title: input.title || quote.title || 'Zakazka z cenove nabidky',
    description: input.description,
    address: input.address,
    status: 'planned',
    work_state: 'not_started',
    billing_status: 'waiting_for_invoice',
    billing_state: 'waiting_for_invoice',
    is_paid: false,
  }

  const splitDays = input.splitDays ?? []
  const shouldSplit = splitDays.length > 1

  try {
    if (shouldSplit) {
      const { data: parentJob, error: parentError } = await ctx.supabase
        .from('jobs')
        .insert({
          ...baseJob,
          price: toMoney(quote.total_price),
          start_at: input.startAt,
          end_at: input.endAt,
          parent_job_id: null,
          source_quote_id: input.quoteId,
        })
        .select('id')
        .single()

      if (parentError || !parentJob?.id) throw parentError ?? new Error('Zakazku se nepodarilo vytvorit.')

      const childJobs = splitDays.map((day) => ({
        ...baseJob,
        title: `${baseJob.title} - ${day.label}`,
        price: null,
        start_at: day.startAt,
        end_at: day.endAt,
        parent_job_id: parentJob.id,
        source_quote_id: null,
      }))

      const { error: childError } = await ctx.supabase.from('jobs').insert(childJobs)
      if (childError) throw childError

      await approveQuote(ctx, input.quoteId)
      return { jobId: parentJob.id, created: true }
    }

    const { data: jobs, error: insertError } = await ctx.supabase
      .from('jobs')
      .insert({
        ...baseJob,
        price: toMoney(quote.total_price),
        start_at: input.startAt,
        end_at: input.endAt,
        parent_job_id: null,
        source_quote_id: input.quoteId,
      })
      .select('id')

    if (insertError || !jobs?.[0]?.id) throw insertError ?? new Error('Zakazku se nepodarilo vytvorit.')

    await approveQuote(ctx, input.quoteId)
    return { jobId: jobs[0].id, created: true }
  } catch (error) {
    const existingAfterRace = await findExistingJobForQuote(ctx, input.quoteId)
    if (existingAfterRace) return { jobId: existingAfterRace, created: false }
    throw error
  }
}

export async function markJobCompleted(ctx: FlowContext, jobId: string) {
  const { error } = await ctx.supabase
    .from('jobs')
    .update({
      status: 'done',
      work_state: 'done',
    })
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)

  if (error) throw error
}

export async function markReadyForInvoice(ctx: FlowContext, jobId: string) {
  const { error } = await ctx.supabase
    .from('jobs')
    .update({
      billing_status: 'waiting_for_invoice',
      billing_state: 'waiting_for_invoice',
    })
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)

  if (error) throw error
}

export async function issueInvoice(ctx: FlowContext, invoiceId: string) {
  const { data: invoice, error: invoiceError } = await ctx.supabase
    .from('invoices')
    .select('id, status')
    .eq('id', invoiceId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  if (invoiceError || !invoice?.id) throw new TenantScopeError('Faktura nepatri do aktivni firmy.')
  if (!canIssueInvoice(invoice.status)) return { issued: false, alreadyIssued: true }

  const { error } = await ctx.supabase
    .from('invoices')
    .update({
      status: 'issued',
      issued_at: nowIso(),
    })
    .eq('id', invoiceId)
    .eq('company_id', ctx.companyId)
    .eq('status', 'draft')

  if (error) throw error
  return { issued: true, alreadyIssued: false }
}
