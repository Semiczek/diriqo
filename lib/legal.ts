import 'server-only'

import type { User } from '@supabase/supabase-js'

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { resolveLocale, type Locale } from '@/lib/i18n/config'
import {
  getLegalDocument,
  getLegalDocuments,
  REQUIRED_LEGAL_ACCEPTANCE_TYPES,
  type LegalDocumentDefinition,
  type LegalDocumentType,
} from '@/lib/legal-documents'

export type LegalVersionSnapshot = {
  type: LegalDocumentType
  version: string
  title: string
  locale: Locale
  publishedAt: string
  isActive: boolean
  requiresAcceptance: boolean
}

export type UserLegalAcceptance = {
  id: string
  userId: string
  documentType: LegalDocumentType
  version: string
  acceptedAt: string
  ipAddress: string | null
  userAgent: string | null
}

type LegalDocumentVersionRow = {
  type: string
  version: string
  title: string
  locale: string | null
  published_at: string | null
  is_active: boolean | null
}

type UserLegalAcceptanceRow = {
  id: string
  user_id: string
  document_type: string
  version: string
  accepted_at: string
  ip_address: string | null
  user_agent: string | null
}

type LegalAcceptanceMetadata = {
  accepted_at?: unknown
  locale?: unknown
  documents?: unknown
}

export function getClientIpFromHeaders(headers: Headers) {
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (
    forwardedFor ||
    headers.get('x-real-ip')?.trim() ||
    headers.get('cf-connecting-ip')?.trim() ||
    null
  )
}

export async function isLegalAcceptanceStorageAvailable() {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('user_legal_acceptances')
    .select('id', { head: true })
    .limit(1)

  return !error
}

function isLegalDocumentType(value: string | null | undefined): value is LegalDocumentType {
  return value === 'terms' || value === 'privacy' || value === 'cookies' || value === 'dpa' || value === 'security'
}

function fallbackSnapshot(document: LegalDocumentDefinition): LegalVersionSnapshot {
  return {
    type: document.type,
    version: document.version,
    title: document.title,
    locale: document.locale,
    publishedAt: document.publishedAt,
    isActive: true,
    requiresAcceptance: document.requiresAcceptance,
  }
}

function mapVersionRow(row: LegalDocumentVersionRow, fallback: LegalDocumentDefinition): LegalVersionSnapshot {
  return {
    type: isLegalDocumentType(row.type) ? row.type : fallback.type,
    version: row.version || fallback.version,
    title: row.title || fallback.title,
    locale: resolveLocale(row.locale),
    publishedAt: row.published_at ?? fallback.publishedAt,
    isActive: row.is_active !== false,
    requiresAcceptance: fallback.requiresAcceptance,
  }
}

function mapAcceptanceRow(row: UserLegalAcceptanceRow): UserLegalAcceptance | null {
  if (!isLegalDocumentType(row.document_type)) return null

  return {
    id: row.id,
    userId: row.user_id,
    documentType: row.document_type,
    version: row.version,
    acceptedAt: row.accepted_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  }
}

function getMetadataAcceptance(user: Pick<User, 'user_metadata'>): LegalAcceptanceMetadata | null {
  const value = user.user_metadata?.legal_acceptance
  return value && typeof value === 'object' ? (value as LegalAcceptanceMetadata) : null
}

function getMetadataDocumentVersions(metadata: LegalAcceptanceMetadata | null) {
  if (!metadata?.documents || typeof metadata.documents !== 'object') {
    return new Map<LegalDocumentType, string>()
  }

  const versions = new Map<LegalDocumentType, string>()
  for (const [type, version] of Object.entries(metadata.documents as Record<string, unknown>)) {
    if (isLegalDocumentType(type) && typeof version === 'string' && version.trim()) {
      versions.set(type, version.trim())
    }
  }

  return versions
}

export async function getCurrentLegalVersion(
  type: LegalDocumentType = 'terms',
  locale: Locale = 'cs'
): Promise<LegalVersionSnapshot> {
  const fallback = getLegalDocument(type, locale)
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('legal_document_versions')
    .select('type, version, title, locale, published_at, is_active')
    .eq('type', type)
    .eq('locale', locale)
    .eq('is_active', true)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) {
    return fallbackSnapshot(fallback)
  }

  return mapVersionRow(data as LegalDocumentVersionRow, fallback)
}

export async function getCurrentLegalVersions(locale: Locale = 'cs') {
  const fallbackDocuments = getLegalDocuments(locale)
  const fallbackByType = new Map(fallbackDocuments.map((document) => [document.type, document]))
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('legal_document_versions')
    .select('type, version, title, locale, published_at, is_active')
    .eq('locale', locale)
    .eq('is_active', true)
    .order('type', { ascending: true })
    .order('published_at', { ascending: false, nullsFirst: false })

  if (error || !data?.length) {
    return fallbackDocuments.map(fallbackSnapshot)
  }

  const byType = new Map<LegalDocumentType, LegalVersionSnapshot>()
  for (const row of data as LegalDocumentVersionRow[]) {
    if (!isLegalDocumentType(row.type) || byType.has(row.type)) continue
    byType.set(row.type, mapVersionRow(row, fallbackByType.get(row.type) ?? getLegalDocument(row.type, locale)))
  }

  for (const document of fallbackDocuments) {
    if (!byType.has(document.type)) {
      byType.set(document.type, fallbackSnapshot(document))
    }
  }

  return fallbackDocuments.map((document) => byType.get(document.type) ?? fallbackSnapshot(document))
}

export async function getUserLegalAcceptance(
  userId: string,
  documentType: LegalDocumentType,
  version?: string
) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('user_legal_acceptances')
    .select('id, user_id, document_type, version, accepted_at, ip_address, user_agent')
    .eq('user_id', userId)
    .eq('document_type', documentType)
    .order('accepted_at', { ascending: false })
    .limit(1)

  if (version) {
    query = query.eq('version', version)
  }

  const { data, error } = await query.maybeSingle()
  if (error || !data) return null

  return mapAcceptanceRow(data as UserLegalAcceptanceRow)
}

export async function getPendingLegalDocuments(userId: string, locale: Locale = 'cs') {
  const storageAvailable = await isLegalAcceptanceStorageAvailable()
  if (!storageAvailable) return []

  const versions = await getCurrentLegalVersions(locale)
  const requiredVersions = versions.filter((version) =>
    REQUIRED_LEGAL_ACCEPTANCE_TYPES.includes(version.type)
  )
  const pending: LegalVersionSnapshot[] = []

  for (const version of requiredVersions) {
    const acceptance = await getUserLegalAcceptance(userId, version.type, version.version)
    if (!acceptance) pending.push(version)
  }

  return pending
}

export async function hasAcceptedLatestTerms(userId: string, locale: Locale = 'cs') {
  const currentTerms = await getCurrentLegalVersion('terms', locale)
  const acceptance = await getUserLegalAcceptance(userId, 'terms', currentTerms.version)
  return Boolean(acceptance)
}

export async function requireLegalAcceptance(userId: string, locale: Locale = 'cs') {
  const pending = await getPendingLegalDocuments(userId, locale)

  return {
    ok: pending.length === 0,
    pending,
  }
}

export async function recordLegalAcceptance(input: {
  userId: string
  documentType: LegalDocumentType
  version: string
  acceptedAt?: string
  ipAddress?: string | null
  userAgent?: string | null
}) {
  const acceptedAt = input.acceptedAt ?? new Date().toISOString()
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('user_legal_acceptances')
    .upsert(
      {
        user_id: input.userId,
        document_type: input.documentType,
        version: input.version,
        accepted_at: acceptedAt,
        ip_address: input.ipAddress ?? null,
        user_agent: input.userAgent?.slice(0, 1000) ?? null,
      },
      { onConflict: 'user_id,document_type,version', ignoreDuplicates: true }
    )

  return !error
}

export async function recordCurrentLegalAcceptancesForUser(input: {
  userId: string
  locale?: Locale
  documentTypes?: LegalDocumentType[]
  acceptedAt?: string
  ipAddress?: string | null
  userAgent?: string | null
}) {
  const locale = input.locale ?? 'cs'
  const versions = await getCurrentLegalVersions(locale)
  const requestedTypes = new Set(input.documentTypes ?? REQUIRED_LEGAL_ACCEPTANCE_TYPES)
  const results: Array<{ type: LegalDocumentType; version: string; stored: boolean }> = []

  for (const version of versions) {
    if (!requestedTypes.has(version.type)) continue

    const stored = await recordLegalAcceptance({
      userId: input.userId,
      documentType: version.type,
      version: version.version,
      acceptedAt: input.acceptedAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    })

    results.push({
      type: version.type,
      version: version.version,
      stored,
    })
  }

  return results
}

export async function ensureUserLegalAcceptancesFromMetadata(input: {
  user: Pick<User, 'id' | 'user_metadata'>
  ipAddress?: string | null
  userAgent?: string | null
}) {
  const metadata = getMetadataAcceptance(input.user)
  const documentVersions = getMetadataDocumentVersions(metadata)
  if (documentVersions.size === 0) return []

  const acceptedAt =
    typeof metadata?.accepted_at === 'string' && metadata.accepted_at
      ? metadata.accepted_at
      : new Date().toISOString()
  const results: Array<{ type: LegalDocumentType; version: string; stored: boolean }> = []

  for (const [documentType, version] of documentVersions) {
    if (!REQUIRED_LEGAL_ACCEPTANCE_TYPES.includes(documentType)) continue

    const stored = await recordLegalAcceptance({
      userId: input.user.id,
      documentType,
      version,
      acceptedAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    })

    results.push({ type: documentType, version, stored })
  }

  return results
}
