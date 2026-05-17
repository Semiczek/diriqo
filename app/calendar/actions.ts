'use server'

import { revalidatePath } from 'next/cache'

import { requireHubDalContext } from '@/lib/dal/auth'
import { requireCompanyModule } from '@/lib/module-access'

export type CreateCalendarEventResult =
  | {
      ok: true
      eventId: string
    }
  | {
      ok: false
      error: string
    }

export type UpdateCalendarEventResult =
  | {
      ok: true
      event: {
        id: string
        title: string
        description: string | null
        start_at: string
        end_at: string
        company_id: string
        job_id: string | null
      }
    }
  | {
      ok: false
      error: string
    }

export type CalendarMutationResult =
  | {
      ok: true
    }
  | {
      ok: false
      error: string
    }

function cleanOptionalId(value: unknown) {
  const cleaned = String(value ?? '').trim()
  return cleaned || null
}

function cleanString(value: unknown) {
  return String(value ?? '').trim()
}

function parseDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeProfileIds(value: string[] | undefined) {
  return [...new Set((value ?? []).map(cleanOptionalId).filter((id): id is string => Boolean(id)))]
}

export async function createCalendarEventAction(input: {
  title?: string | null
  description?: string | null
  startAt?: string | null
  endAt?: string | null
  jobId?: string | null
  companyId?: string | null
  selectedProfileIds?: string[]
}): Promise<CreateCalendarEventResult> {
  try {
    const context = await requireHubDalContext()
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'calendar')

    if (!moduleAccess.ok) {
      return { ok: false, error: moduleAccess.error }
    }

    const title = cleanString(input.title)
    const requestedCompanyId = cleanOptionalId(input.companyId)
    const jobId = cleanOptionalId(input.jobId)
    const start = parseDate(cleanOptionalId(input.startAt))
    const end = parseDate(cleanOptionalId(input.endAt))

    if (!title) {
      return { ok: false, error: 'Zadejte název události.' }
    }

    if (requestedCompanyId && requestedCompanyId !== companyId) {
      return { ok: false, error: 'Událost lze vytvořit jen v aktivní firmě.' }
    }

    if (!start || !end) {
      return { ok: false, error: 'Vyplňte platný začátek a konec události.' }
    }

    if (end <= start) {
      return { ok: false, error: 'Konec události musí být po začátku.' }
    }

    if (jobId) {
      const jobResponse = await supabase
        .from('jobs')
        .select('id')
        .eq('id', jobId)
        .eq('company_id', companyId)
        .maybeSingle()

      if (jobResponse.error || !jobResponse.data?.id) {
        return { ok: false, error: 'Vybraná zakázka nepatří do aktivní firmy.' }
      }
    }

    const selectedProfileIds = normalizeProfileIds(input.selectedProfileIds)

    if (selectedProfileIds.length > 0) {
      const membersResponse = await supabase
        .from('company_members')
        .select('profile_id')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .in('profile_id', selectedProfileIds)

      if (membersResponse.error) {
        return { ok: false, error: 'Nepodařilo se ověřit pracovníky.' }
      }

      const allowedProfileIds = new Set(
        ((membersResponse.data ?? []) as { profile_id?: string | null }[])
          .map((row) => row.profile_id)
          .filter((id): id is string => Boolean(id))
      )

      if (selectedProfileIds.some((profileId) => !allowedProfileIds.has(profileId))) {
          return { ok: false, error: 'Některý pracovník nepatří do aktivní firmy.' }
      }
    }

    const eventResponse = await supabase
      .from('calendar_events')
      .insert([
        {
          title,
          description: cleanOptionalId(input.description),
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          job_id: jobId,
          company_id: companyId,
        },
      ])
      .select('id')
      .single()

    if (eventResponse.error || !eventResponse.data?.id) {
      return { ok: false, error: eventResponse.error?.message || 'Událost se nepodařilo vytvořit.' }
    }

    if (selectedProfileIds.length > 0) {
      const assignments = selectedProfileIds.map((profileId) => ({
        event_id: eventResponse.data.id,
        profile_id: profileId,
      }))

      const assignResponse = await supabase.from('calendar_event_assignments').insert(assignments)

      if (assignResponse.error) {
        return {
          ok: false,
          error: `Událost vznikla, ale pracovníky se nepodařilo přiřadit: ${assignResponse.error.message}`,
        }
      }
    }

    revalidatePath('/calendar')

    return {
      ok: true,
      eventId: eventResponse.data.id,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Událost se nepodařilo vytvořit.',
    }
  }
}

async function verifyCalendarProfiles(input: {
  supabase: Awaited<ReturnType<typeof requireHubDalContext>>['supabase']
  companyId: string
  profileIds: string[]
}) {
  if (input.profileIds.length === 0) return null

  const membersResponse = await input.supabase
    .from('company_members')
    .select('profile_id')
    .eq('company_id', input.companyId)
    .eq('is_active', true)
    .in('profile_id', input.profileIds)

  if (membersResponse.error) {
    return 'Nepodařilo se ověřit pracovníky.'
  }

  const allowedProfileIds = new Set(
    ((membersResponse.data ?? []) as { profile_id?: string | null }[])
      .map((row) => row.profile_id)
      .filter((id): id is string => Boolean(id))
  )

  if (input.profileIds.some((profileId) => !allowedProfileIds.has(profileId))) {
      return 'Některý pracovník nepatří do aktivní firmy.'
  }

  return null
}

export async function updateCalendarEventAction(input: {
  eventId?: string | null
  title?: string | null
  description?: string | null
  startAt?: string | null
  endAt?: string | null
  jobId?: string | null
  companyId?: string | null
  selectedProfileIds?: string[]
}): Promise<UpdateCalendarEventResult> {
  try {
    const context = await requireHubDalContext()
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'calendar')

    if (!moduleAccess.ok) {
      return { ok: false, error: moduleAccess.error }
    }

    const eventId = cleanOptionalId(input.eventId)
    const title = cleanString(input.title)
    const requestedCompanyId = cleanOptionalId(input.companyId)
    const jobId = cleanOptionalId(input.jobId)
    const start = parseDate(cleanOptionalId(input.startAt))
    const end = parseDate(cleanOptionalId(input.endAt))

    if (!eventId) return { ok: false, error: 'Chybí událost.' }
    if (!title) return { ok: false, error: 'Zadejte název události.' }
    if (requestedCompanyId && requestedCompanyId !== companyId) {
      return { ok: false, error: 'Událost lze upravit jen v aktivní firmě.' }
    }
    if (!start || !end) return { ok: false, error: 'Vyplňte platný začátek a konec události.' }
    if (end <= start) return { ok: false, error: 'Konec události musí být po začátku.' }

    const eventResponse = await supabase
      .from('calendar_events')
      .select('id')
      .eq('id', eventId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (eventResponse.error || !eventResponse.data?.id) {
      return { ok: false, error: 'Událost nebyla nalezena v aktivní firmě.' }
    }

    if (jobId) {
      const jobResponse = await supabase
        .from('jobs')
        .select('id')
        .eq('id', jobId)
        .eq('company_id', companyId)
        .maybeSingle()

      if (jobResponse.error || !jobResponse.data?.id) {
        return { ok: false, error: 'Vybraná zakázka nepatří do aktivní firmy.' }
      }
    }

    const selectedProfileIds = normalizeProfileIds(input.selectedProfileIds)
    const profileError = await verifyCalendarProfiles({ supabase, companyId, profileIds: selectedProfileIds })

    if (profileError) {
      return { ok: false, error: profileError }
    }

    const startIso = start.toISOString()
    const endIso = end.toISOString()
    const updatedEvent = {
      title,
      description: cleanOptionalId(input.description),
      start_at: startIso,
      end_at: endIso,
      company_id: companyId,
      job_id: jobId,
    }

    const updateResponse = await supabase
      .from('calendar_events')
      .update(updatedEvent)
      .eq('id', eventId)
      .eq('company_id', companyId)

    if (updateResponse.error) {
      return { ok: false, error: updateResponse.error.message || 'Událost se nepodařilo uložit.' }
    }

    const deleteAssignmentsResponse = await supabase
      .from('calendar_event_assignments')
      .delete()
      .or(`event_id.eq.${eventId},calendar_event_id.eq.${eventId}`)

    if (deleteAssignmentsResponse.error) {
      return { ok: false, error: deleteAssignmentsResponse.error.message || 'Pracovníky se nepodařilo aktualizovat.' }
    }

    if (selectedProfileIds.length > 0) {
      const rows = selectedProfileIds.map((profileId) => ({
        event_id: eventId,
        profile_id: profileId,
      }))

      const insertAssignmentsResponse = await supabase.from('calendar_event_assignments').insert(rows)

      if (insertAssignmentsResponse.error) {
        return { ok: false, error: insertAssignmentsResponse.error.message || 'Pracovníky se nepodařilo přiřadit.' }
      }
    }

    revalidatePath('/calendar')
    revalidatePath(`/calendar/events/${eventId}`)

    return {
      ok: true,
      event: {
        id: eventId,
        ...updatedEvent,
      },
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Událost se nepodařilo uložit.',
    }
  }
}

export async function deleteCalendarEventAction(eventIdInput: string): Promise<CalendarMutationResult> {
  try {
    const context = await requireHubDalContext()
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'calendar')
    const eventId = cleanOptionalId(eventIdInput)

    if (!moduleAccess.ok) return { ok: false, error: moduleAccess.error }
    if (!eventId) return { ok: false, error: 'Chybí událost.' }

    const eventResponse = await supabase
      .from('calendar_events')
      .select('id')
      .eq('id', eventId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (eventResponse.error || !eventResponse.data?.id) {
      return { ok: false, error: 'Událost nebyla nalezena v aktivní firmě.' }
    }

    const assignmentsResponse = await supabase
      .from('calendar_event_assignments')
      .delete()
      .or(`event_id.eq.${eventId},calendar_event_id.eq.${eventId}`)

    if (assignmentsResponse.error) {
      return { ok: false, error: assignmentsResponse.error.message || 'Přiřazení se nepodařilo smazat.' }
    }

    const deleteResponse = await supabase
      .from('calendar_events')
      .delete()
      .eq('id', eventId)
      .eq('company_id', companyId)

    if (deleteResponse.error) {
      return { ok: false, error: deleteResponse.error.message || 'Událost se nepodařilo smazat.' }
    }

    revalidatePath('/calendar')
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Událost se nepodařilo smazat.',
    }
  }
}
