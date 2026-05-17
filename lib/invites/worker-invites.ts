import type { SupabaseClient } from '@supabase/supabase-js'

import { getWorkerInviteExpiry, hashInviteToken, isInviteExpired } from './token'
import { normalizePhoneForStorage } from './whatsapp'

export type WorkerInviteStatus = 'pending' | 'used' | 'revoked' | 'expired'

type WorkerInviteRow = {
  id: string
  company_id: string
  worker_profile_id: string | null
  phone: string
  token_hash: string
  status: WorkerInviteStatus
  expires_at: string
  used_at: string | null
  revoked_at: string | null
  created_by: string
  created_at: string
  updated_at: string
  profiles?: {
    id?: string | null
    full_name?: string | null
    phone?: string | null
    worker_status?: string | null
    activated_at?: string | null
    last_seen_at?: string | null
    device_registered_at?: string | null
  } | null
  companies?: {
    id?: string | null
    name?: string | null
  } | null
}

export type SafeInviteValidation =
  | {
      ok: true
      inviteId: string
      companyName: string | null
      workerName: string | null
      phoneMasked: string
      status: 'pending'
      expiresAt: string
    }
  | {
      ok: false
      status: 'expired' | 'revoked' | 'used' | 'invalid'
    }

export function maskInvitePhone(phone: string) {
  const digits = phone.replace(/[^\d]/g, '')
  if (digits.length <= 4) return '••••'
  return `${'•'.repeat(Math.max(2, digits.length - 4))}${digits.slice(-4)}`
}

function mapInvalidStatus(status: WorkerInviteStatus) {
  if (status === 'expired') return 'expired'
  if (status === 'revoked') return 'revoked'
  if (status === 'used') return 'used'
  return 'invalid'
}

export function evaluateInviteRow(row: WorkerInviteRow | null, now = new Date()): SafeInviteValidation {
  if (!row) {
    return { ok: false, status: 'invalid' }
  }

  if (row.status !== 'pending') {
    return { ok: false, status: mapInvalidStatus(row.status) }
  }

  if (isInviteExpired(row.expires_at, now)) {
    return { ok: false, status: 'expired' }
  }

  return {
    ok: true,
    inviteId: row.id,
    companyName: row.companies?.name ?? null,
    workerName: row.profiles?.full_name ?? null,
    phoneMasked: maskInvitePhone(row.phone),
    status: 'pending',
    expiresAt: row.expires_at,
  }
}

export async function getInviteByToken(supabase: SupabaseClient, token: string) {
  const tokenHash = hashInviteToken(token)
  const { data, error } = await supabase
    .from('worker_invites')
    .select(`
      id,
      company_id,
      worker_profile_id,
      phone,
      token_hash,
      status,
      expires_at,
      used_at,
      revoked_at,
      created_by,
      created_at,
      updated_at,
      profiles:worker_profile_id (
        id,
        full_name,
        phone,
        worker_status,
        activated_at,
        last_seen_at,
        device_registered_at
      ),
      companies:company_id (
        id,
        name
      )
    `)
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data as WorkerInviteRow | null
}

export async function revokePendingWorkerInvites(
  supabase: SupabaseClient,
  companyId: string,
  workerProfileId: string
) {
  const { error } = await supabase
    .from('worker_invites')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('worker_profile_id', workerProfileId)
    .eq('status', 'pending')

  if (error) {
    throw error
  }
}

export async function createWorkerInviteRecord({
  supabase,
  companyId,
  workerProfileId,
  phone,
  contactFallback,
  createdBy,
  token,
}: {
  supabase: SupabaseClient
  companyId: string
  workerProfileId: string
  phone: string | null
  contactFallback?: string | null
  createdBy: string
  token: string
}) {
  const normalizedPhone = phone?.trim() ? normalizePhoneForStorage(phone) : ''
  const inviteContact = normalizedPhone || contactFallback?.trim() || 'email'
  const { data, error } = await supabase
    .from('worker_invites')
    .insert({
      company_id: companyId,
      worker_profile_id: workerProfileId,
      phone: inviteContact,
      token_hash: hashInviteToken(token),
      status: 'pending',
      expires_at: getWorkerInviteExpiry().toISOString(),
      created_by: createdBy,
    })
    .select('id, expires_at')
    .single()

  if (error) {
    throw error
  }

  return data as { id: string; expires_at: string }
}
