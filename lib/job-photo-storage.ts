import 'server-only'

import { type ActiveCompanyContext } from '@/lib/active-company'
import { hasHubAccessRole, normalizeCompanyRole } from '@/lib/hub-access'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const JOB_PHOTO_BUCKET = 'job-photos'
export const MAX_JOB_PHOTO_UPLOAD_BYTES = 50 * 1024 * 1024

export type JobPhotoCategory = 'before' | 'after' | 'progress' | 'issue' | 'document'

const JOB_PHOTO_CATEGORIES: JobPhotoCategory[] = ['before', 'after', 'progress', 'issue', 'document']
const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

type JobPhotoJobScopeRow = {
  id: string
  parent_job_id: string | null
}

type JobPhotoAssignmentScopeRow = {
  job_id: string | null
}

function uniqueValues(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

export function normalizeJobPhotoCategory(value: unknown): JobPhotoCategory {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'proof') return 'document'
  return JOB_PHOTO_CATEGORIES.includes(normalized as JobPhotoCategory)
    ? (normalized as JobPhotoCategory)
    : 'before'
}

export function hasJobPhotoAdminAccess(activeCompany: ActiveCompanyContext) {
  return hasHubAccessRole(normalizeCompanyRole(activeCompany.role))
}

export function isSupportedJobPhotoMimeType(value: unknown) {
  return typeof value === 'string' && SUPPORTED_IMAGE_MIME_TYPES.includes(value)
}

export function getSafeJobPhotoExtension(fileName: string, mimeType: string) {
  const extension = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''

  if (extension) {
    return extension.slice(0, 12)
  }

  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/heic') return 'heic'
  if (mimeType === 'image/heif') return 'heif'

  return 'jpg'
}

export function buildJobPhotoStoragePath(input: {
  companyId: string
  jobId: string
  category: JobPhotoCategory
  fileName: string
  mimeType: string
  photoId?: string
}) {
  const extension = getSafeJobPhotoExtension(input.fileName, input.mimeType)
  const photoId = input.photoId ?? crypto.randomUUID()
  return `${input.jobId}/${input.category}/${photoId}.${extension}`
}

export function isExpectedJobPhotoStoragePath(input: {
  storagePath: string
  companyId: string
  jobId: string
  category: JobPhotoCategory
}) {
  const parts = input.storagePath.split('/')
  return (
    parts.length === 3 &&
    parts[0] === input.jobId &&
    parts[1] === input.category &&
    Boolean(parts[2]?.trim())
  )
}

export async function resolveJobPhotoAccessScope(jobId: string, activeCompany: ActiveCompanyContext) {
  const cleanJobId = String(jobId ?? '').trim()
  if (!cleanJobId) {
    return { hasAccess: false, rootJobId: null, jobIds: [] }
  }

  const supabase = createSupabaseAdminClient()
  const jobResponse = await supabase
    .from('jobs')
    .select('id, parent_job_id')
    .eq('id', cleanJobId)
    .eq('company_id', activeCompany.companyId)
    .maybeSingle()

  if (jobResponse.error) {
    throw new Error(`Nepodařilo se ověřit zakázku: ${jobResponse.error.message}`)
  }

  const job = jobResponse.data as JobPhotoJobScopeRow | null

  if (!job?.id) {
    return { hasAccess: false, rootJobId: null, jobIds: [] }
  }

  const rootJobId = job.parent_job_id ?? job.id
  const groupJobsResponse = await supabase
    .from('jobs')
    .select('id, parent_job_id')
    .eq('company_id', activeCompany.companyId)
    .or(`id.eq.${rootJobId},parent_job_id.eq.${rootJobId}`)

  if (groupJobsResponse.error) {
    throw new Error(`Nepodařilo se načíst skupinu zakázek: ${groupJobsResponse.error.message}`)
  }

  const groupJobIds = uniqueValues([
    job.id,
    rootJobId,
    ...(((groupJobsResponse.data ?? []) as JobPhotoJobScopeRow[]).map((groupJob) => groupJob.id)),
  ])
  const role = normalizeCompanyRole(activeCompany.role)
  if (hasHubAccessRole(role) || role === 'manager') {
    return { hasAccess: true, rootJobId, jobIds: groupJobIds }
  }

  const assignmentResponse = await supabase
    .from('job_assignments')
    .select('job_id')
    .eq('company_id', activeCompany.companyId)
    .in('job_id', groupJobIds)
    .eq('profile_id', activeCompany.profileId)
    .is('archived_at', null)

  if (assignmentResponse.error) {
    throw new Error(`Nepodařilo se ověřit přiřazení: ${assignmentResponse.error.message}`)
  }

  const assignedGroupJobIds = uniqueValues(
    ((assignmentResponse.data ?? []) as JobPhotoAssignmentScopeRow[]).map((assignment) => assignment.job_id)
  )

  return {
    hasAccess: assignedGroupJobIds.length > 0,
    rootJobId,
    jobIds: assignedGroupJobIds.length > 0 ? groupJobIds : [],
  }
}

export async function verifyJobPhotoAccess(jobId: string, activeCompany: ActiveCompanyContext) {
  const scope = await resolveJobPhotoAccessScope(jobId, activeCompany)
  return scope.hasAccess
}
