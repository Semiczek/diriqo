import 'server-only'

import { type ActiveCompanyContext } from '@/lib/active-company'
import { hasHubAccessRole, normalizeCompanyRole } from '@/lib/hub-access'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const JOB_PHOTO_BUCKET = 'job-photos'
export const MAX_JOB_PHOTO_UPLOAD_BYTES = 50 * 1024 * 1024

export type JobPhotoCategory = 'before' | 'after' | 'progress' | 'issue' | 'document'

const JOB_PHOTO_CATEGORIES: JobPhotoCategory[] = ['before', 'after', 'progress', 'issue', 'document']
const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

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

export async function verifyJobPhotoAccess(jobId: string, activeCompany: ActiveCompanyContext) {
  const supabase = createSupabaseAdminClient()
  const jobResponse = await supabase
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('company_id', activeCompany.companyId)
    .maybeSingle()

  if (jobResponse.error) {
    throw new Error(`Nepodarilo se overit zakazku: ${jobResponse.error.message}`)
  }

  if (!jobResponse.data?.id) {
    return false
  }

  const role = normalizeCompanyRole(activeCompany.role)
  if (hasHubAccessRole(role) || role === 'manager') {
    return true
  }

  const assignmentResponse = await supabase
    .from('job_assignments')
    .select('id')
    .eq('job_id', jobId)
    .eq('profile_id', activeCompany.profileId)
    .is('archived_at', null)
    .limit(1)

  if (assignmentResponse.error) {
    throw new Error(`Nepodarilo se overit prirazeni: ${assignmentResponse.error.message}`)
  }

  return (assignmentResponse.data ?? []).length > 0
}
