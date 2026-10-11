import 'server-only'

import { requireWorkerAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { requireCompanyModule } from '@/lib/module-access'
import { canUseMobileApp, type MobileApp } from '@/lib/mobile-access'
import type { WorkerJobCard } from '@/app/moje-prace/WorkerFlowClient'

export async function mobileContext(app: MobileApp) {
  // Resolve the selected company among all memberships first. Never silently fall
  // back to an admin membership in a different tenant to pass the manager check.
  const access = await requireWorkerAccess()
  if (!access.ok) throw new Error('Přihlaste se účtem, který má přístup do firmy.')
  if (!canUseMobileApp(access.value.role, app)) throw new Error('Diriqo Manager je dostupný manažerům a správcům firmy. Pro svůj pracovní přehled otevřete My Diriqo.')
  const licence = await requireCompanyModule(access.value.companyId, 'jobs', 'core.jobs.update')
  if (!licence.ok) throw new Error('Firma potřebuje aktivní Diriqo Core a zapnuté zakázky. Obraťte se na správce firmy.')
  return { ...access.value, supabase: await createSupabaseServerClient() }
}

type Context = Awaited<ReturnType<typeof mobileContext>>
type Job = { id: string; company_id: string; title: string | null; address: string | null; start_at: string | null; end_at: string | null; status: string | null }
type Assignment = { id: string; job_id: string; status: string | null; completed_at: string | null; work_completed_at: string | null; jobs: Job | Job[] | null }
const assignmentFields = 'id, job_id, status, completed_at, work_completed_at, jobs!inner(id, company_id, title, address, start_at, end_at, status)'

export async function readMyMobileWork() {
  const context = await mobileContext('my')
  const [assignments, shifts] = await Promise.all([
    context.supabase.from('job_assignments')
      .select(assignmentFields, { count: 'exact' })
      .eq('company_id', context.companyId).eq('profile_id', context.profileId).eq('jobs.company_id', context.companyId)
      .is('archived_at', null).order('created_at', { ascending: false }).limit(100),
    context.supabase.from('work_shifts').select('id, job_id', { count: 'exact' })
      .eq('company_id', context.companyId).eq('profile_id', context.profileId).is('ended_at', null).order('started_at').limit(100),
  ])
  if (assignments.error || shifts.error) throw new Error('Práci se nepodařilo načíst. Obnovte stránku.')
  const openByJob = new Map((shifts.data ?? []).map(shift => [shift.job_id, shift.id]))
  const assignmentRows = new Map(((assignments.data ?? []) as unknown as Assignment[]).map(row => [row.id, row]))
  const recentJobIds = new Set([...assignmentRows.values()].map(row => row.job_id))
  const olderOpenJobIds = [...openByJob.keys()].filter((id): id is string => typeof id === 'string' && !recentJobIds.has(id))
  if (olderOpenJobIds.length) {
    const runningAssignments = await context.supabase.from('job_assignments').select(assignmentFields)
      .eq('company_id', context.companyId).eq('profile_id', context.profileId).eq('jobs.company_id', context.companyId)
      .in('job_id', olderOpenJobIds).is('archived_at', null).limit(1000)
    if (runningAssignments.error) throw new Error('Rozpracované zakázky se nepodařilo načíst. Obnovte stránku.')
    for (const row of (runningAssignments.data ?? []) as unknown as Assignment[]) assignmentRows.set(row.id, row)
  }
  const jobs: WorkerJobCard[] = []
  for (const assignment of assignmentRows.values()) {
    const job = Array.isArray(assignment.jobs) ? assignment.jobs[0] : assignment.jobs
    if (!job || job.company_id !== context.companyId || job.id !== assignment.job_id) continue
    jobs.push({ assignmentId: assignment.id, jobId: job.id, title: job.title?.trim() || 'Zakázka bez názvu', address: job.address,
      startAt: job.start_at, endAt: job.end_at, status: job.status, assignmentStatus: assignment.status,
      completedAt: assignment.completed_at ?? assignment.work_completed_at, openShiftId: openByJob.get(job.id) ?? null })
  }
  jobs.sort((a, b) => Number(Boolean(b.openShiftId)) - Number(Boolean(a.openShiftId)) || Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) || (a.startAt ?? 'z').localeCompare(b.startAt ?? 'z'))
  return { context, jobs, total: assignments.count ?? jobs.length, openShiftCount: shifts.count ?? shifts.data?.length ?? 0 }
}

export type OwnOpenShift = { id: string; job_id: string | null; started_at: string | null; title: string }

/** Settlement only: no history, other employees, prices or new-operation licence. */
export async function readMyOpenShifts() {
  const access = await requireWorkerAccess()
  if (!access.ok) throw new Error('Přihlaste se účtem, který má přístup do firmy.')
  const context = access.value
  const admin = createSupabaseAdminClient()
  const shifts = await admin.from('work_shifts').select('id, job_id, started_at', { count: 'exact' })
    .eq('company_id', context.companyId).eq('profile_id', context.profileId).is('ended_at', null).order('started_at').limit(100)
  if (shifts.error) throw new Error('Rozpracované směny se nepodařilo načíst. Obnovte stránku.')
  const jobIds = [...new Set((shifts.data ?? []).map(row => row.job_id))].filter((id): id is string => typeof id === 'string')
  const titles = new Map<string, string>()
  if (jobIds.length) {
    const jobs = await admin.from('jobs').select('id, title').eq('company_id', context.companyId).in('id', jobIds)
    if (jobs.error) throw new Error('Názvy rozpracovaných zakázek se nepodařilo načíst.')
    for (const job of jobs.data ?? []) titles.set(job.id, job.title?.trim() || 'Zakázka bez názvu')
  }
  return { context, shifts: (shifts.data ?? []).map(row => ({ id: String(row.id), job_id: row.job_id as string | null,
    started_at: row.started_at as string | null, title: titles.get(row.job_id) ?? 'Rozpracovaná směna' })) satisfies OwnOpenShift[], total: shifts.count ?? 0 }
}

export type ManagerJob = Omit<Job, 'company_id' | 'end_at'>
export type ManagerShift = { id: string; profile_id: string; job_id: string | null; started_at: string | null }
export type TeamMember = { id: string; profile_id: string; role: string | null }

export async function readManagerMobileOverview() {
  const context = await mobileContext('manager')
  // A narrow read projection for the explicitly authorized manager role. Core
  // admin pages/writes and their RLS remain unchanged. No finance is selected.
  const admin = createSupabaseAdminClient()
  const [jobs, members, shifts, navigation] = await Promise.all([
    admin.from('jobs').select('id, title, address, start_at, status', { count: 'exact' })
      .eq('company_id', context.companyId).order('created_at', { ascending: false }).limit(100),
    admin.from('company_members').select('id, profile_id, role', { count: 'exact' })
      .eq('company_id', context.companyId).eq('is_active', true).order('id').limit(100),
    admin.from('work_shifts').select('id, profile_id, job_id, started_at', { count: 'exact' })
      .eq('company_id', context.companyId).is('ended_at', null).order('started_at', { ascending: true }).limit(100),
    context.supabase.rpc('module_navigation', { company: context.companyId }),
  ])
  if (jobs.error || members.error || shifts.error) throw new Error('Firemní přehled se nepodařilo načíst. Obnovte stránku.')
  const profileIds = [...new Set([...(members.data ?? []).map(row => row.profile_id), ...(shifts.data ?? []).map(row => row.profile_id)])].filter(Boolean)
  const names = new Map<string, string>()
  if (profileIds.length) {
    const profiles = await admin.from('profiles').select('id, full_name').in('id', profileIds)
    if (profiles.error) throw new Error('Tým se nepodařilo načíst. Obnovte stránku.')
    for (const profile of profiles.data ?? []) names.set(profile.id, profile.full_name?.trim() || 'Člen týmu')
  }
  return { context, jobs: (jobs.data ?? []) as ManagerJob[], members: (members.data ?? []) as TeamMember[],
    shifts: (shifts.data ?? []) as ManagerShift[], names,
    jobCount: jobs.count ?? 0, memberCount: members.count ?? 0, shiftCount: shifts.count ?? 0,
    products: navigation.error || !Array.isArray(navigation.data) ? [] as string[] : navigation.data.filter((item): item is string => typeof item === 'string') }
}

export function publicMobileContext(context: Omit<Context, 'supabase'>) {
  return { companyId: context.companyId, companyName: context.companyName, profileName: context.profileName,
    role: context.role, companyMemberships: context.companyMemberships }
}
