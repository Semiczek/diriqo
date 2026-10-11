'use server'

import { revalidatePath } from 'next/cache'
import { validateDraft } from '@/lib/smart-quotes/domain'
import { quoteContext, quoteError } from '@/lib/smart-quotes/server'

export type QuoteCommand = 'save' | 'publish' | 'share' | 'approve' | 'convert' | 'template_save' | 'template_archive' | 'library_save' | 'library_archive'
export type CommandResult = { ok: true; id?: string; token?: string; version?: number; jobId?: string } | { ok: false; error: string }

export async function runQuoteCommand(expectedCompanyId: string, command: QuoteCommand, payload: Record<string, unknown>): Promise<CommandResult> {
  try {
    if (!['save','publish','share','approve','convert','template_save','template_archive','library_save','library_archive'].includes(command)) throw new Error('Neplatná operace.')
    const ctx = await quoteContext(expectedCompanyId)
    const input = { ...payload }
    if (['save','template_save','library_save'].includes(command)) input.draft = validateDraft(payload.draft)
    const { data, error } = await ctx.supabase.rpc('smart_quotes_command', { target_company_id: ctx.companyId, command, payload: input })
    if (error) throw new Error(error.message)
    revalidatePath('/smart-quotes', 'layout')
    return { ok: true, ...data }
  } catch (error) { return { ok: false, error: quoteError(error) } }
}
