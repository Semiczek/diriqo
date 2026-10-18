import 'server-only'
import { requireCompanyRoleDalContext } from '@/lib/dal/auth'
import { matchesDiriqentIdentity, type DiriqentIdentity } from './access'
import { answerSupport } from './support'

export async function supportContext() {
  return requireCompanyRoleDalContext('super_admin', 'company_admin', 'manager', 'worker')
}

export async function readSupportAnswer(expected: DiriqentIdentity, prompt: unknown) {
  if (!expected || typeof expected !== 'object' || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) {
    throw new Error('Vyplňte otázku do 2 000 znaků.')
  }
  const current = await supportContext()
  if (!matchesDiriqentIdentity(expected, current)) {
    throw new Error('Firma nebo oprávnění se změnily. Obnovte Diriqenta.')
  }
  // This path must never reserve credits, read business records, or call an AI provider.
  return answerSupport(prompt, current.role)
}
