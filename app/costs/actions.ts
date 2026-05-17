'use server'

import { revalidatePath } from 'next/cache'
import { redirect, unstable_rethrow } from 'next/navigation'

import { expenseSources, normalizeCurrency, normalizeRecurrence } from '@/lib/costs'
import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type CostTab = 'overview' | 'fixed' | 'job' | 'one_time'

const tabs: CostTab[] = ['overview', 'fixed', 'job', 'one_time']

function readString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function readNullableString(formData: FormData, key: string) {
  const value = readString(formData, key)
  return value || null
}

function readAmount(formData: FormData) {
  const raw = readString(formData, 'amount').replace(',', '.')
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Částka musí být číslo větší nebo rovno 0.')
  }
  return amount
}

function readDate(formData: FormData, key: string, fallback: string) {
  const value = readString(formData, key)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function readDueDay(formData: FormData) {
  const raw = readString(formData, 'due_day')
  if (!raw) return null
  const value = Number.parseInt(raw, 10)
  if (!Number.isInteger(value) || value < 1 || value > 31) {
    throw new Error('Den splatnosti musí být mezi 1 a 31.')
  }
  return value
}

function readTab(formData: FormData, fallback: CostTab): CostTab {
  const value = readString(formData, 'tab')
  return tabs.includes(value as CostTab) ? (value as CostTab) : fallback
}

function readMonth(formData: FormData) {
  const value = readString(formData, 'month')
  return /^\d{4}-\d{2}$/.test(value) ? value : ''
}

function buildCostsPath(formData: FormData, fallbackTab: CostTab, params?: Record<string, string>) {
  const search = new URLSearchParams()
  const tab = readTab(formData, fallbackTab)
  const month = readMonth(formData)

  if (tab !== 'overview') search.set('tab', tab)
  if (month) search.set('month', month)

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) search.set(key, value)
  }

  const query = search.toString()
  return query ? `/costs?${query}` : '/costs'
}

function redirectWithError(formData: FormData, fallbackTab: CostTab, error: unknown): never {
  const message = error instanceof Error ? error.message : 'Akci se nepodařilo dokončit.'
  redirect(buildCostsPath(formData, fallbackTab, { error: message }))
}

function redirectWithNotice(formData: FormData, fallbackTab: CostTab, notice: string): never {
  revalidatePath('/costs')
  redirect(buildCostsPath(formData, fallbackTab, { notice }))
}

async function requireCostsAccess() {
  const access = await requireCompanyRole('company_admin', 'super_admin')

  if (!access.ok) {
    throw new Error(access.error)
  }

  const supabase = await createSupabaseServerClient()

  return {
    supabase,
    companyId: access.value.companyId,
    profileId: access.value.profileId,
  }
}

async function assertJobBelongsToCompany(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, companyId: string, jobId: string | null) {
  if (!jobId) return null

  const { data, error } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data?.id) throw new Error('Vybraná zakázka nepatří do aktivní firmy.')

  return data.id as string
}

function readFixedCostPayload(formData: FormData, profileId: string, companyId: string) {
  const name = readString(formData, 'name')
  const category = readString(formData, 'category')
  const amount = readAmount(formData)
  const today = todayDate()
  const startDate = readDate(formData, 'start_date', today)
  const endDate = readNullableString(formData, 'end_date')

  if (!name) throw new Error('Vyplňte název fixního nákladu.')
  if (!category) throw new Error('Vyberte kategorii.')
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('Datum konce není ve správném formátu.')
  }

  return {
    company_id: companyId,
    name,
    category,
    amount,
    currency: normalizeCurrency(readString(formData, 'currency')),
    due_day: readDueDay(formData),
    recurrence: normalizeRecurrence(readString(formData, 'recurrence')),
    start_date: startDate,
    end_date: endDate,
    is_active: formData.get('is_active') === 'on',
    note: readNullableString(formData, 'note'),
    created_by: profileId,
  }
}

function normalizeExpenseSource(value: string) {
  const normalized = value.trim().toLowerCase()
  return expenseSources.includes(normalized as (typeof expenseSources)[number])
    ? normalized
    : 'manual'
}

async function readExpensePayload(formData: FormData, profileId: string, companyId: string, supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const name = readString(formData, 'name')
  const category = readString(formData, 'category')
  const amount = readAmount(formData)
  const jobId = readNullableString(formData, 'job_id')

  if (!name) throw new Error('Vyplňte název nákladu.')
  if (!category) throw new Error('Vyberte kategorii.')

  return {
    company_id: companyId,
    job_id: await assertJobBelongsToCompany(supabase, companyId, jobId),
    worker_id: null,
    name,
    category,
    amount,
    currency: normalizeCurrency(readString(formData, 'currency')),
    expense_date: readDate(formData, 'expense_date', todayDate()),
    source: normalizeExpenseSource(readString(formData, 'source')),
    note: readNullableString(formData, 'note'),
    created_by: profileId,
  }
}

export async function createFixedCost(formData: FormData) {
  try {
    const { supabase, companyId, profileId } = await requireCostsAccess()
    const payload = readFixedCostPayload(formData, profileId, companyId)
    const { error } = await supabase.from('fixed_costs').insert(payload)

    if (error) throw new Error(error.message)
    redirectWithNotice(formData, 'fixed', 'Fixní náklad byl uložen.')
  } catch (error) {
    unstable_rethrow(error)
    redirectWithError(formData, 'fixed', error)
  }
}

export async function updateFixedCost(formData: FormData) {
  try {
    const id = readString(formData, 'id')
    if (!id) throw new Error('Chybí ID fixního nákladu.')

    const { supabase, companyId, profileId } = await requireCostsAccess()
    const payload = readFixedCostPayload(formData, profileId, companyId)
    const { data, error } = await supabase
      .from('fixed_costs')
      .update({
        name: payload.name,
        category: payload.category,
        amount: payload.amount,
        currency: payload.currency,
        due_day: payload.due_day,
        recurrence: payload.recurrence,
        start_date: payload.start_date,
        end_date: payload.end_date,
        is_active: payload.is_active,
        note: payload.note,
      })
      .eq('id', id)
      .eq('company_id', companyId)
      .select('id')

    if (error) throw new Error(error.message)
    if ((data ?? []).length === 0) throw new Error('Fixní náklad nebyl nalezen.')

    redirectWithNotice(formData, 'fixed', 'Fixní náklad byl upraven.')
  } catch (error) {
    unstable_rethrow(error)
    redirectWithError(formData, 'fixed', error)
  }
}

export async function deleteFixedCost(formData: FormData) {
  try {
    const id = readString(formData, 'id')
    if (!id) throw new Error('Chybí ID fixního nákladu.')

    const { supabase, companyId } = await requireCostsAccess()
    const { data, error } = await supabase
      .from('fixed_costs')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId)
      .select('id')

    if (error) throw new Error(error.message)
    if ((data ?? []).length === 0) throw new Error('Fixní náklad nebyl nalezen.')

    redirectWithNotice(formData, 'fixed', 'Fixní náklad byl smazán.')
  } catch (error) {
    unstable_rethrow(error)
    redirectWithError(formData, 'fixed', error)
  }
}

export async function createExpense(formData: FormData) {
  try {
    const { supabase, companyId, profileId } = await requireCostsAccess()
    const payload = await readExpensePayload(formData, profileId, companyId, supabase)
    const { error } = await supabase.from('expenses').insert(payload)

    if (error) throw new Error(error.message)
    redirectWithNotice(formData, payload.job_id ? 'job' : 'one_time', 'Náklad byl uložen.')
  } catch (error) {
    unstable_rethrow(error)
    redirectWithError(formData, 'overview', error)
  }
}

export async function updateExpense(formData: FormData) {
  try {
    const id = readString(formData, 'id')
    if (!id) throw new Error('Chybí ID nákladu.')

    const { supabase, companyId, profileId } = await requireCostsAccess()
    const payload = await readExpensePayload(formData, profileId, companyId, supabase)
    const { data, error } = await supabase
      .from('expenses')
      .update({
        job_id: payload.job_id,
        worker_id: payload.worker_id,
        name: payload.name,
        category: payload.category,
        amount: payload.amount,
        currency: payload.currency,
        expense_date: payload.expense_date,
        source: payload.source,
        note: payload.note,
      })
      .eq('id', id)
      .eq('company_id', companyId)
      .select('id')

    if (error) throw new Error(error.message)
    if ((data ?? []).length === 0) throw new Error('Náklad nebyl nalezen.')

    redirectWithNotice(formData, payload.job_id ? 'job' : 'one_time', 'Náklad byl upraven.')
  } catch (error) {
    unstable_rethrow(error)
    redirectWithError(formData, 'overview', error)
  }
}

export async function deleteExpense(formData: FormData) {
  try {
    const id = readString(formData, 'id')
    if (!id) throw new Error('Chybí ID nákladu.')

    const { supabase, companyId } = await requireCostsAccess()
    const { data, error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId)
      .select('id')

    if (error) throw new Error(error.message)
    if ((data ?? []).length === 0) throw new Error('Náklad nebyl nalezen.')

    redirectWithNotice(formData, 'overview', 'Náklad byl smazán.')
  } catch (error) {
    unstable_rethrow(error)
    redirectWithError(formData, 'overview', error)
  }
}
