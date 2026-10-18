import 'server-only'
import type { SupabaseServerClient } from './auth'

type ReadError = { message: string; code?: string }
type PageQuery<T> = { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: ReadError | null }> }
type CompanyTable = 'company_members' | 'work_logs' | 'work_shifts' | 'payroll_items' | 'payroll_payments' | 'absence_requests' | 'advance_requests' | 'jobs'
type PayrollRow = Record<string, unknown>
// Keep the dynamic-column reader's public type bounded. Exposing PostgREST's
// recursive select-parser generics at every callsite is unnecessary for dynamic
// projections; callers already validate/cast their rows.
type PayrollQuery = PageQuery<PayrollRow> & {
  eq: (column: string, value: unknown) => PayrollQuery
  in: (column: string, values: unknown[]) => PayrollQuery
  is: (column: string, value: null | boolean) => PayrollQuery
  gte: (column: string, value: string) => PayrollQuery
  lt: (column: string, value: string) => PayrollQuery
  order: (column: string, options?: { ascending: boolean }) => PayrollQuery
  maybeSingle: () => PromiseLike<{ data: PayrollRow | null; error: ReadError | null }>
}

/** RLS allows all memberships; the current company is an additional required boundary. */
export function companyPayrollQuery(db: SupabaseServerClient, companyId: string, table: CompanyTable, columns: string): PayrollQuery {
  if (!companyId) throw new Error('Chybí aktivní firma.')
  return db.from(table).select(columns).eq('company_id', companyId) as unknown as PayrollQuery
}

/** Callers supply stable ordering ending in a unique key; never return partial financial totals. */
export async function readPayrollRows<T>(query: PageQuery<T>): Promise<{ data: T[]; error: ReadError | null }> {
  const data: T[] = []
  const pageSize = 500
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const page = await query.range(offset, offset + pageSize - 1)
    if (page.error) return { data: [], error: page.error }
    if (!page.data) return { data: [], error: { message: 'Mzdové podklady nemají potvrzený výsledek.' } }
    data.push(...page.data)
    if (page.data.length < pageSize) return { data, error: null }
  }
  return { data: [], error: { message: 'Mzdové podklady překračují bezpečný rozsah. Zúžte období.' } }
}

export async function readPayrollAssignments(db: SupabaseServerClient, companyId: string, profileIds: string[], columns: string): Promise<{ assignments: { data: unknown[]; error: ReadError | null }; summaries: { data: unknown[]; error: ReadError | null } }> {
  if (!companyId || !columns.includes('jobs!inner')) throw new Error('Chybí vazba přiřazení na aktivní firmu.')
  const assignments: Record<string, unknown>[] = []
  const summaries: Record<string, unknown>[] = []
  // Bound both PostgREST URLs and the result size. The view has no company_id;
  // it may only be queried using IDs of assignments owned by the current company.
  for (let index = 0; index < profileIds.length; index += 200) {
    const result = await readPayrollRows(db.from('job_assignments').select(columns)
      .eq('jobs.company_id', companyId).in('profile_id', profileIds.slice(index, index + 200))
      .is('archived_at', null).order('id'))
    if (result.error) return { assignments: result, summaries: { data: [], error: result.error } }
    assignments.push(...result.data as unknown as Record<string, unknown>[])
  }
  for (let index = 0; index < assignments.length; index += 200) {
    const ids = assignments.slice(index, index + 200).map(row => String(row.id))
    const result = await readPayrollRows(db.from('worker_job_assignment_summary')
      .select('assignment_id, job_id, profile_id, labor_hours_total, effective_hourly_rate, labor_cost_total')
      .in('assignment_id', ids).order('assignment_id'))
    if (result.error) return { assignments: { data: [], error: result.error }, summaries: result }
    summaries.push(...result.data as unknown as Record<string, unknown>[])
  }
  return { assignments: { data: assignments, error: null }, summaries: { data: summaries, error: null } }
}

export async function readActivePayrollMember(db: SupabaseServerClient, companyId: string, profileId: string): Promise<{
  data: { company_id: string; profile_id: string } | null; error: ReadError | null
}> {
  const result = await companyPayrollQuery(db, companyId, 'company_members', 'company_id, profile_id')
    .eq('profile_id', profileId).eq('is_active', true).maybeSingle()
  if (result.error || !result.data) return { data: null, error: result.error }
  if (result.data.company_id !== companyId || result.data.profile_id !== profileId) {
    return { data: null, error: { message: 'Pracovník nepatří do aktivní firmy.' } }
  }
  return { data: { company_id: companyId, profile_id: profileId }, error: null }
}
