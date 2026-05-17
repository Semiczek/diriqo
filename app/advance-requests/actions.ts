'use server'

import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type AdvanceStatus = 'approved' | 'rejected' | 'paid'

export type AdvanceRequestStatusActionResult =
  | {
      ok: true
      data: {
        approvedAt: string | null
        paidAt: string | null
        payrollMonth: string | null
      }
    }
  | {
      ok: false
      error: string
    }

type AdvanceRequestRow = {
  id: string
  company_id: string | null
  profile_id: string | null
  amount: number | string | null
  requested_amount: number | string | null
  reason: string | null
  note: string | null
  status: string | null
  approved_at: string | null
  reviewed_at: string | null
  paid_at: string | null
  payroll_month: string | null
}

function parseAmount(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) ? amount : Number.NaN
}

function monthKeyFromDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

function normalizePayrollMonthKey(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  const match = normalized.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
  if (!match) return null
  return `${match[1]}-${match[2]}-01`
}

function getPayrollMonthFromDate(date: Date) {
  if (date.getDate() >= 19) {
    return monthKeyFromDate(new Date(date.getFullYear(), date.getMonth() + 1, 1))
  }

  return monthKeyFromDate(new Date(date.getFullYear(), date.getMonth(), 1))
}

function buildWorkerAdvanceNote(item: AdvanceRequestRow) {
  const cleanNote = (item.reason || item.note || '').trim()

  if (cleanNote) {
    return `Vyplaceno z zadosti o zalohu (${item.id}) - ${cleanNote}`
  }

  return `Vyplaceno z zadosti o zalohu (${item.id})`
}

function isMissingAdvanceRequestIdColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return (
    error?.code === '42703' ||
    message.includes('advance_request_id') ||
    message.includes('no unique or exclusion constraint')
  )
}

export async function updateAdvanceRequestStatusAction(input: {
  requestId: string
  status: AdvanceStatus
  amount: number
}): Promise<AdvanceRequestStatusActionResult> {
  const access = await requireCompanyRole('company_admin', 'super_admin')

  if (!access.ok) {
    return { ok: false, error: access.error }
  }

  const requestId = input.requestId?.trim()
  const status = input.status
  const amount = parseAmount(input.amount)

  if (!requestId || !['approved', 'rejected', 'paid'].includes(status)) {
    return { ok: false, error: 'Neplatna zadost o zalohu.' }
  }

  if ((status === 'approved' || status === 'paid') && amount <= 0) {
      return { ok: false, error: 'Schválená částka musí být kladná.' }
  }

  const supabase = await createSupabaseServerClient()
  const requestResponse = await supabase
    .from('advance_requests')
    .select('id, company_id, profile_id, amount, requested_amount, reason, note, status, approved_at, reviewed_at, paid_at, payroll_month')
    .eq('id', requestId)
    .eq('company_id', access.value.companyId)
    .maybeSingle()

  if (requestResponse.error) {
    return { ok: false, error: requestResponse.error.message }
  }

  const request = requestResponse.data as AdvanceRequestRow | null

  if (!request?.id || !request.profile_id) {
    return { ok: false, error: 'Zadost nebyla nalezena.' }
  }

  if (status === 'approved' && request.status !== 'pending') {
    return { ok: false, error: 'Schvalit lze jen cekajici zadost.' }
  }

  if (status === 'rejected' && request.status !== 'pending') {
    return { ok: false, error: 'Zamitnout lze jen cekajici zadost.' }
  }

  if (status === 'paid' && request.status !== 'approved') {
    return { ok: false, error: 'Vyplatit lze jen schvalenou zadost.' }
  }

  const nowIso = new Date().toISOString()
  const payrollMonth =
    status === 'approved' || status === 'paid'
      ? normalizePayrollMonthKey(request.payroll_month) ?? getPayrollMonthFromDate(new Date(nowIso))
      : normalizePayrollMonthKey(request.payroll_month)
  const updatePayload: Record<string, unknown> = {
    status,
    amount: status === 'rejected' ? request.amount : amount,
    reviewed_at: nowIso,
    payroll_month: payrollMonth,
  }

  if (status === 'approved') {
    updatePayload.approved_at = nowIso
  }

  if (status === 'paid') {
    updatePayload.approved_at = request.approved_at || nowIso
    updatePayload.paid_at = nowIso
  }

  const updateResponse = await supabase
    .from('advance_requests')
    .update(updatePayload)
    .eq('id', request.id)
    .eq('company_id', access.value.companyId)
    .eq('status', request.status)
    .select('id')

  if (updateResponse.error) {
    return { ok: false, error: updateResponse.error.message }
  }

  if ((updateResponse.data ?? []).length === 0) {
    return { ok: false, error: 'Zadost uz byla zpracovana.' }
  }

  if (status === 'paid') {
    const issuedAt = nowIso.slice(0, 10)
    const note = buildWorkerAdvanceNote(request)
    const upsertPayload = {
      advance_request_id: request.id,
      company_id: access.value.companyId,
      profile_id: request.profile_id,
      amount,
      issued_at: issuedAt,
      note,
    }
    const upsertResponse = await supabase
      .from('worker_advances')
      .upsert(upsertPayload, { onConflict: 'advance_request_id' })

    if (upsertResponse.error && !isMissingAdvanceRequestIdColumn(upsertResponse.error)) {
      return { ok: false, error: upsertResponse.error.message }
    }

    if (upsertResponse.error && isMissingAdvanceRequestIdColumn(upsertResponse.error)) {
      const existingResponse = await supabase
        .from('worker_advances')
        .select('id')
        .eq('company_id', access.value.companyId)
        .eq('profile_id', request.profile_id)
        .eq('note', note)
        .limit(1)

      if (existingResponse.error) {
        return { ok: false, error: existingResponse.error.message }
      }

      const existingId = existingResponse.data?.[0]?.id

      if (existingId) {
        const updateExistingResponse = await supabase
          .from('worker_advances')
          .update({ amount, issued_at: issuedAt, note })
          .eq('id', existingId)
          .eq('company_id', access.value.companyId)

        if (updateExistingResponse.error) {
          return { ok: false, error: updateExistingResponse.error.message }
        }
      } else {
        const insertResponse = await supabase
          .from('worker_advances')
          .insert({
            company_id: access.value.companyId,
            profile_id: request.profile_id,
            amount,
            issued_at: issuedAt,
            note,
          })

        if (insertResponse.error) {
          return { ok: false, error: insertResponse.error.message }
        }
      }
    }
  }

  return {
    ok: true,
    data: {
      approvedAt: status === 'approved' ? nowIso : status === 'paid' ? request.approved_at || nowIso : request.approved_at,
      paidAt: status === 'paid' ? nowIso : request.paid_at,
      payrollMonth,
    },
  }
}
