import 'server-only'

import type { InvoiceStatus } from '@/lib/invoices'
import type { QuoteStatus } from '@/lib/quote-status'
import type { BillingStateResolved, WorkState } from '@/lib/job-status'

export type CalculationStatus = 'draft' | 'ready' | 'approved' | 'archived'
export type JobFlowStatus = 'planned' | 'in_progress' | 'waiting_check' | 'done'

export const calculationStatuses: CalculationStatus[] = ['draft', 'ready', 'approved', 'archived']

export const quoteFlowStatuses: QuoteStatus[] = [
  'draft',
  'ready',
  'sent',
  'viewed',
  'waiting_followup',
  'revision_requested',
  'accepted',
  'rejected',
  'expired',
]

export const jobFlowStatuses: JobFlowStatus[] = ['planned', 'in_progress', 'waiting_check', 'done']

export const jobWorkFlowStates: WorkState[] = [
  'not_started',
  'in_progress',
  'partially_done',
  'done',
]

export const jobBillingFlowStates: BillingStateResolved[] = [
  'waiting_for_invoice',
  'due',
  'overdue',
  'paid',
]

export const invoiceFlowStatuses: InvoiceStatus[] = [
  'draft',
  'issued',
  'sent',
  'paid',
  'overdue',
  'cancelled',
]

export function canAcceptQuote(status: string | null | undefined, acceptedAt?: string | null) {
  const normalized = String(status ?? '').trim().toLowerCase()
  if (acceptedAt) return true
  return normalized !== 'accepted' && normalized !== 'rejected' && normalized !== 'expired'
}

export function canCreateJobFromQuote(status: string | null | undefined) {
  const normalized = String(status ?? '').trim().toLowerCase()
  return normalized !== 'rejected' && normalized !== 'expired'
}

export function canIssueInvoice(status: string | null | undefined) {
  return status === 'draft'
}
