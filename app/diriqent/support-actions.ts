'use server'

import { readSupportAnswer } from '@/lib/diriqent/support-server'
import type { DiriqentIdentity } from '@/lib/diriqent/access'

export async function askDiriqentSupport(expected: DiriqentIdentity, prompt: string) {
  try {
    return { ok: true as const, value: await readSupportAnswer(expected, prompt) }
  } catch {
    return { ok: false as const, error: 'Podporu se nepodařilo načíst. Zkontrolujte připojení a obnovte stránku, pokud se změnila firma nebo oprávnění.' }
  }
}
