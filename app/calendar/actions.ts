'use server'

import { revalidatePath } from 'next/cache'
import { DalAuthError, requireHubDalContext, type DalContext } from '@/lib/dal/auth'
import {
  calendarError, CalendarError, createCalendarEvent, deleteCalendarEvent,
  readCalendarEditor, readCalendarList, readCalendarSnapshot, updateCalendarEvent,
} from '@/lib/dal/calendar'
import type {
  CalendarDeleteInput, CalendarEditorData, CalendarFailure, CalendarListData,
  CalendarResult, CalendarUpdateInput, CalendarWriteInput, CalendarWriteSuccess,
} from '@/lib/calendar/types'

export type CreateCalendarEventResult = CalendarWriteSuccess | CalendarFailure
export type UpdateCalendarEventResult = CalendarWriteSuccess | CalendarFailure
export type CalendarMutationResult = { ok: true } | CalendarFailure

async function context(): Promise<DalContext> {
  const ctx = await requireHubDalContext()
  if (ctx.role !== 'super_admin' && ctx.role !== 'company_admin') {
    throw calendarError({ message: 'CALENDAR_FORBIDDEN' })
  }
  return ctx
}
function failure(error: unknown): CalendarFailure {
  const known = error instanceof DalAuthError
    ? calendarError({ message: 'CALENDAR_FORBIDDEN' }) : calendarError(error)
  return { ok: false, error: known.message, code: known.code }
}
function sameCompany(ctx: DalContext, companyId: unknown) {
  if (typeof companyId !== 'string' || companyId.toLowerCase() !== ctx.companyId.toLowerCase()) {
    throw calendarError({ message: 'CALENDAR_FORBIDDEN' })
  }
}
function revalidate(eventId: string) {
  revalidatePath('/calendar')
  revalidatePath(`/calendar/events/${eventId}`)
}

export async function readCalendarListAction(): Promise<CalendarResult<CalendarListData>> {
  try { return { ok: true, data: await readCalendarList(await context()) } }
  catch (error) { return failure(error) }
}

export async function readCalendarEditorAction(input: { eventId?: string } = {}): Promise<CalendarResult<CalendarEditorData>> {
  try {
    if (!input || (input.eventId !== undefined && typeof input.eventId !== 'string')) {
      throw calendarError({ message: 'CALENDAR_INPUT_INVALID' })
    }
    return { ok: true, data: await readCalendarEditor(await context(), input.eventId) }
  } catch (error) { return failure(error) }
}

export async function createCalendarEventAction(input: CalendarWriteInput): Promise<CreateCalendarEventResult> {
  try {
    const ctx = await context()
    sameCompany(ctx, input?.companyId)
    const saved = await createCalendarEvent(ctx, input)
    revalidate(saved.event.id)
    return { ok: true, eventId: saved.event.id, event: saved.event, assignedProfileIds: saved.assigned_profile_ids }
  } catch (error) { return failure(error) }
}

export async function updateCalendarEventAction(input: CalendarUpdateInput): Promise<UpdateCalendarEventResult> {
  let ctx: DalContext | undefined
  try {
    ctx = await context()
    sameCompany(ctx, input?.companyId)
    const saved = await updateCalendarEvent(ctx, input)
    revalidate(saved.event.id)
    return { ok: true, eventId: saved.event.id, event: saved.event, assignedProfileIds: saved.assigned_profile_ids }
  } catch (error) {
    const result = failure(error)
    // Read only after a definite stale response, under fresh authentication/RLS.
    // The caller's draft and base revision remain unchanged until explicit reload.
    if (ctx && error instanceof CalendarError && error.code === 'conflict' && input?.eventId) {
      try { result.current = await readCalendarSnapshot(ctx, input.eventId) } catch { /* Do not disclose an inaccessible snapshot. */ }
    }
    return result
  }
}

export async function deleteCalendarEventAction(input: CalendarDeleteInput): Promise<CalendarMutationResult> {
  let ctx: DalContext | undefined
  try {
    ctx = await context()
    sameCompany(ctx, input?.companyId)
    await deleteCalendarEvent(ctx, input)
    revalidate(input.eventId)
    return { ok: true }
  } catch (error) {
    const result = failure(error)
    if (ctx && error instanceof CalendarError && error.code === 'conflict' && input?.eventId) {
      try { result.current = await readCalendarSnapshot(ctx, input.eventId) } catch { /* Membership can be revoked between calls. */ }
    }
    return result
  }
}
