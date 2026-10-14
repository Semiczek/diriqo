'use server'
import { revalidatePath } from 'next/cache'
import { aiError } from '@/lib/diriqent/server'
import { prepareAdvancedWork, runApprovedWork, WorkStartUncertainError, type WorkApproval } from '@/lib/diriqent/work-server'

export async function prepareWork(input: unknown) {
  try { return { ok: true as const, ...await prepareAdvancedWork(input) } }
  catch (error) { return { ok: false as const, error: aiError(error) } }
}
export async function runWork(input: WorkApproval) {
  let started = false
  try {
    const value = await runApprovedWork(input)
    started = true
    revalidatePath('/diriqent')
    return { ok: true as const, value }
  } catch (error) { return { ok: false as const, error: aiError(error), mayHaveStarted: started || error instanceof WorkStartUncertainError } }
}
