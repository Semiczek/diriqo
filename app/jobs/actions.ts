'use server'

import { revalidatePath } from 'next/cache'

import { requireCompanyRoleDalContext, requireHubDalContext } from '@/lib/dal/auth'
import { getRequestLocale } from '@/lib/i18n/server'
import type { Locale } from '@/lib/i18n/config'
import { requireCompanyModule } from '@/lib/module-access'

type DailyJobInput = {
  dateKey?: string | null
  startAt?: string | null
  endAt?: string | null
}

export type CreateJobsInput = {
  parentJobId?: string | null
  customerId?: string | null
  contactId?: string | null
  title?: string | null
  description?: string | null
  address?: string | null
  price?: string | number | null
  startAt?: string | null
  endAt?: string | null
  isPaid?: boolean
  isInternal?: boolean
  isRecurringWeekly?: boolean
  repeatWeekday?: string | number | null
  repeatUntil?: string | null
  selectedDailyJobs?: DailyJobInput[]
  assignedProfileIds?: string[]
}

export type CreateJobsResult =
  | {
      ok: true
      redirectTo: string
      jobIds: string[]
    }
  | {
      ok: false
      error: string
    }

export type JobMutationResult =
  | {
      ok: true
    }
  | {
      ok: false
      error: string
    }

export type CreateParentSummaryJobResult =
  | {
      ok: true
      parentJob: {
        id: string
        customer_id: string | null
        contact_id: string | null
        title: string | null
        description: string | null
        scheduled_start: string | null
        scheduled_end: string | null
        scheduled_date: string | null
        start_at: string | null
        end_at: string | null
        address: string | null
        price: number | null
        is_paid: boolean | null
      }
    }
  | {
      ok: false
      error: string
    }

type InsertableJob = {
  company_id: string
  customer_id: string | null
  contact_id: string | null
  title: string
  description: string
  address: string
  status: string
  work_state: string
  billing_state: string
  billing_status: string
  is_internal: boolean
  price: number | null
  start_at: string | null
  end_at: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  scheduled_date: string | null
  is_paid: boolean
  parent_job_id: string | null
}

type JobActionMessages = {
  recurringRequiresDates: string
  endAfterStart: string
  repeatUntilInvalid: string
  recurrenceLimit: string
  titleRequired: string
  startEndRequired: string
  invalidPrice: string
  invalidStart: string
  invalidEnd: string
  customerRequired: string
  workerRequired: string
  dailyLimit: string
  createJobFailed: string
  createDailyJobsFailed: string
  recurrenceNoJobs: string
  createJobsFailed: string
  assignWorkersFailed: (message: string) => string
  missingJob: string
  jobNotFoundActiveCompany: string
  jobHasChildrenCannotMove: string
  mainJobTitle: string
  createParentFailed: string
  connectParentFailed: string
  detachFailed: string
  contactsDetachFailed: string
  detachCustomerFailed: string
  deleteJobFailed: string
}

function getJobActionMessages(locale: Locale): JobActionMessages {
  if (locale === 'en') {
    return {
      recurringRequiresDates: 'Recurrence requires a start, end, and repeat-until date.',
      endAfterStart: 'The job end must be later than the start.',
      repeatUntilInvalid: 'The repeat-until date is not valid.',
      recurrenceLimit: 'Recurring jobs can create at most 370 jobs at once.',
      titleRequired: 'Enter the job title.',
      startEndRequired: 'Enter both job start and job end.',
      invalidPrice: 'Job price must be a valid non-negative number.',
      invalidStart: 'Job start is not valid.',
      invalidEnd: 'Job end is not valid.',
      customerRequired: 'Select a customer first. Without a customer, create only an internal job.',
      workerRequired: 'Select at least one worker first.',
      dailyLimit: 'You can create at most 370 daily jobs at once.',
      createJobFailed: 'The job could not be created.',
      createDailyJobsFailed: 'Daily jobs could not be created.',
      recurrenceNoJobs: 'The recurrence did not create any jobs.',
      createJobsFailed: 'Jobs could not be created.',
      assignWorkersFailed: (message) => `The job could not be created because workers could not be assigned: ${message}`,
      missingJob: 'Missing job.',
      jobNotFoundActiveCompany: 'The job was not found in the active company.',
      jobHasChildrenCannotMove: 'This job already has linked parts and cannot be placed under another main job.',
      mainJobTitle: 'Main job',
      createParentFailed: 'The main job could not be created.',
      connectParentFailed: 'The job could not be connected to the main job.',
      detachFailed: 'The job could not be detached.',
      contactsDetachFailed: 'Job contacts could not be removed.',
      detachCustomerFailed: 'The customer could not be detached.',
      deleteJobFailed: 'The job could not be deleted.',
    }
  }

  if (locale === 'de') {
    return {
      recurringRequiresDates: 'Wiederholung erfordert Start, Ende und ein Wiederholen-bis-Datum.',
      endAfterStart: 'Das Auftragsende muss nach dem Beginn liegen.',
      repeatUntilInvalid: 'Das Wiederholen-bis-Datum ist nicht gültig.',
      recurrenceLimit: 'Eine Wiederholung kann höchstens 370 Aufträge auf einmal erstellen.',
      titleRequired: 'Gib den Auftragstitel ein.',
      startEndRequired: 'Gib Beginn und Ende des Auftrags ein.',
      invalidPrice: 'Der Auftragspreis muss eine gültige nicht negative Zahl sein.',
      invalidStart: 'Der Auftragsbeginn ist nicht gültig.',
      invalidEnd: 'Das Auftragsende ist nicht gültig.',
      customerRequired: 'Wähle zuerst einen Kunden aus. Ohne Kunden erstelle nur einen internen Auftrag.',
      workerRequired: 'Wähle zuerst mindestens einen Mitarbeiter aus.',
      dailyLimit: 'Du kannst höchstens 370 Tagesaufträge auf einmal erstellen.',
      createJobFailed: 'Der Auftrag konnte nicht erstellt werden.',
      createDailyJobsFailed: 'Tagesaufträge konnten nicht erstellt werden.',
      recurrenceNoJobs: 'Die Wiederholung hat keine Aufträge erstellt.',
      createJobsFailed: 'Aufträge konnten nicht erstellt werden.',
      assignWorkersFailed: (message) => `Der Auftrag konnte nicht erstellt werden, weil Mitarbeiter nicht zugewiesen werden konnten: ${message}`,
      missingJob: 'Auftrag fehlt.',
      jobNotFoundActiveCompany: 'Der Auftrag wurde in der aktiven Firma nicht gefunden.',
      jobHasChildrenCannotMove: 'Dieser Auftrag hat bereits verknüpfte Teile und kann keinem anderen Hauptauftrag untergeordnet werden.',
      mainJobTitle: 'Hauptauftrag',
      createParentFailed: 'Der Hauptauftrag konnte nicht erstellt werden.',
      connectParentFailed: 'Der Auftrag konnte nicht mit dem Hauptauftrag verbunden werden.',
      detachFailed: 'Der Auftrag konnte nicht getrennt werden.',
      contactsDetachFailed: 'Auftragskontakte konnten nicht entfernt werden.',
      detachCustomerFailed: 'Der Kunde konnte nicht entfernt werden.',
      deleteJobFailed: 'Der Auftrag konnte nicht gelöscht werden.',
    }
  }

  return {
    recurringRequiresDates: 'Opakování vyžaduje začátek, konec a datum opakování do.',
    endAfterStart: 'Konec zakázky musí být po začátku.',
    repeatUntilInvalid: 'Datum opakování do není platné.',
    recurrenceLimit: 'Opakování může vytvořit maximálně 370 zakázek najednou.',
    titleRequired: 'Zadejte název zakázky.',
    startEndRequired: 'Zadejte začátek i konec zakázky.',
    invalidPrice: 'Cena zakázky musí být platné nezáporné číslo.',
    invalidStart: 'Začátek zakázky není platný.',
    invalidEnd: 'Konec zakázky není platný.',
    customerRequired: 'Nejdřív vyberte zákazníka. Bez zákazníka vytvořte pouze interní zakázku.',
    workerRequired: 'Nejdřív vyberte alespoň jednoho pracovníka.',
    dailyLimit: 'Lze vytvořit maximálně 370 denních zakázek najednou.',
    createJobFailed: 'Zakázku se nepodařilo vytvořit.',
    createDailyJobsFailed: 'Denní zakázky se nepodařilo vytvořit.',
    recurrenceNoJobs: 'Opakování nevytvořilo žádnou zakázku.',
    createJobsFailed: 'Zakázky se nepodařilo vytvořit.',
    assignWorkersFailed: (message) =>
      `Zakázku se nepodařilo vytvořit, protože pracovníky se nepodařilo přiřadit: ${message}`,
    missingJob: 'Chybí zakázka.',
    jobNotFoundActiveCompany: 'Zakázka nebyla nalezena v aktivní firmě.',
    jobHasChildrenCannotMove: 'Zakázka už má navázané části. Nelze ji vložit pod další hlavní zakázku.',
    mainJobTitle: 'Hlavní zakázka',
    createParentFailed: 'Hlavní zakázku se nepodařilo vytvořit.',
    connectParentFailed: 'Zakázku se nepodařilo připojit k hlavní zakázce.',
    detachFailed: 'Zakázku se nepodařilo odpojit.',
    contactsDetachFailed: 'Kontakty zakázky se nepodařilo odebrat.',
    detachCustomerFailed: 'Zákazníka se nepodařilo odebrat.',
    deleteJobFailed: 'Zakázku se nepodařilo smazat.',
  }
}

function cleanString(value: unknown) {
  return String(value ?? '').trim()
}

function cleanOptionalId(value: unknown) {
  const cleaned = cleanString(value)
  return cleaned || null
}

function toOptionalNumber(value: unknown) {
  const normalizedValue = typeof value === 'string' ? value.trim() : value
  if (normalizedValue === null || normalizedValue === undefined || normalizedValue === '') return null
  const numberValue = Number(normalizedValue)
  return Number.isFinite(numberValue) ? numberValue : null
}

function parseDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function getScheduleDateKey(value: string | null) {
  if (!value) return null
  const directDate = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (directDate) return directDate[1]

  const parsedDate = parseDate(value)
  return parsedDate ? parsedDate.toISOString().slice(0, 10) : null
}

function buildScheduleFields(startAt: string | null, endAt: string | null) {
  return {
    start_at: startAt,
    end_at: endAt,
    scheduled_start: startAt,
    scheduled_end: endAt,
    scheduled_date: getScheduleDateKey(startAt),
  }
}

function getNextOccurrenceOnWeekday(date: Date, weekday: number) {
  const next = new Date(date)
  const diff = (weekday - next.getDay() + 7) % 7
  next.setDate(next.getDate() + diff)
  return next
}

function normalizeAssignedProfileIds(value: string[] | undefined) {
  return [...new Set((value ?? []).map(cleanOptionalId).filter((id): id is string => Boolean(id)))]
}

async function deleteCreatedJobs(input: {
  supabase: Awaited<ReturnType<typeof requireHubDalContext>>['supabase']
  companyId: string
  jobIds: string[]
}) {
  const jobIds = [...new Set(input.jobIds.filter(Boolean))]
  if (jobIds.length === 0) return

  await input.supabase.from('job_assignments').delete().eq('company_id', input.companyId).in('job_id', jobIds)
  await input.supabase.from('jobs').delete().eq('company_id', input.companyId).in('parent_job_id', jobIds)
  await input.supabase.from('jobs').delete().eq('company_id', input.companyId).in('id', jobIds)
}

async function verifyCustomerScope(input: {
  supabase: Awaited<ReturnType<typeof requireHubDalContext>>['supabase']
  companyId: string
  customerId: string | null
  contactId: string | null
}) {
  if (!input.customerId && input.contactId) {
    return 'Kontakt lze přiřadit jen k vybranému zákazníkovi.'
  }

  if (input.customerId) {
    const customerResponse = await input.supabase
      .from('customers')
      .select('id')
      .eq('id', input.customerId)
      .eq('company_id', input.companyId)
      .maybeSingle()

    if (customerResponse.error || !customerResponse.data?.id) {
      return 'Vybraný zákazník nepatří do aktivní firmy.'
    }
  }

  if (input.contactId) {
    const contactResponse = await input.supabase
      .from('customer_contacts')
      .select('id, customer_id')
      .eq('id', input.contactId)
      .maybeSingle()

    const contact = contactResponse.data as { id?: string | null; customer_id?: string | null } | null
    if (contactResponse.error || !contact?.id || contact.customer_id !== input.customerId) {
      return 'Vybraný kontakt nepatří k vybranému zákazníkovi.'
    }
  }

  return null
}

async function verifyAssignedProfiles(input: {
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
    return 'Nepodařilo se ověřit přiřazené pracovníky.'
  }

  const allowedProfileIds = new Set(
    ((membersResponse.data ?? []) as { profile_id?: string | null }[])
      .map((row) => row.profile_id)
      .filter((id): id is string => Boolean(id))
  )

  if (input.profileIds.some((profileId) => !allowedProfileIds.has(profileId))) {
    return 'Některý z pracovníků nepatří do aktivní firmy.'
  }

  return null
}

function buildRecurringJobs(input: {
  baseJob: Omit<
    InsertableJob,
    | 'price'
    | 'start_at'
    | 'end_at'
    | 'scheduled_start'
    | 'scheduled_end'
    | 'scheduled_date'
    | 'is_paid'
    | 'parent_job_id'
  >
  price: number
  isPaid: boolean
  startAt: string | null
  endAt: string | null
  repeatWeekday: number
  repeatUntil: string | null
  messages: JobActionMessages
}) {
  const parsedStartAt = parseDate(input.startAt)
  const parsedEndAt = parseDate(input.endAt)

  if (!parsedStartAt || !parsedEndAt || !input.repeatUntil) {
    return { error: input.messages.recurringRequiresDates, jobs: [] }
  }

  const durationMs = parsedEndAt.getTime() - parsedStartAt.getTime()
  if (durationMs <= 0) {
    return { error: input.messages.endAfterStart, jobs: [] }
  }

  const repeatUntilDate = new Date(`${input.repeatUntil}T23:59:59`)
  if (Number.isNaN(repeatUntilDate.getTime())) {
    return { error: input.messages.repeatUntilInvalid, jobs: [] }
  }

  const firstOccurrenceStart = getNextOccurrenceOnWeekday(parsedStartAt, input.repeatWeekday)
  firstOccurrenceStart.setHours(
    parsedStartAt.getHours(),
    parsedStartAt.getMinutes(),
    parsedStartAt.getSeconds(),
    parsedStartAt.getMilliseconds()
  )

  const jobs: InsertableJob[] = []
  let occurrenceStart = new Date(firstOccurrenceStart)

  while (occurrenceStart <= repeatUntilDate) {
    if (jobs.length >= 370) {
      return { error: input.messages.recurrenceLimit, jobs: [] }
    }

    const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs)
    const occurrenceStartIso = occurrenceStart.toISOString()
    const occurrenceEndIso = occurrenceEnd.toISOString()
    jobs.push({
      ...input.baseJob,
      price: input.price,
      ...buildScheduleFields(occurrenceStartIso, occurrenceEndIso),
      is_paid: input.isPaid,
      parent_job_id: null,
    })
    occurrenceStart = new Date(occurrenceStart)
    occurrenceStart.setDate(occurrenceStart.getDate() + 7)
  }

  return { error: null, jobs }
}

export async function createJobsAction(input: CreateJobsInput): Promise<CreateJobsResult> {
  const messages = getJobActionMessages(await getRequestLocale())

  try {
    const context = await requireHubDalContext()
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'jobs')

    if (!moduleAccess.ok) {
      return { ok: false, error: moduleAccess.error }
    }

    const title = cleanString(input.title)
    if (!title) {
      return { ok: false, error: messages.titleRequired }
    }

    const parentJobId = cleanOptionalId(input.parentJobId)
    const customerId = cleanOptionalId(input.customerId)
    const contactId = cleanOptionalId(input.contactId)
    const rawPrice = cleanString(input.price)
    const parsedPrice = toOptionalNumber(input.price)
    const price = parsedPrice ?? 0
    const startAt = cleanOptionalId(input.startAt)
    const endAt = cleanOptionalId(input.endAt)
    const parsedStartAt = parseDate(startAt)
    const parsedEndAt = parseDate(endAt)
    const normalizedStartAt = parsedStartAt?.toISOString() ?? startAt
    const normalizedEndAt = parsedEndAt?.toISOString() ?? endAt

    if (!startAt || !endAt) {
      return { ok: false, error: messages.startEndRequired }
    }

    if (!parentJobId && rawPrice && (parsedPrice === null || parsedPrice < 0)) {
      return { ok: false, error: messages.invalidPrice }
    }

    if (startAt && !parsedStartAt) {
      return { ok: false, error: messages.invalidStart }
    }

    if (endAt && !parsedEndAt) {
      return { ok: false, error: messages.invalidEnd }
    }

    if (parsedStartAt && parsedEndAt && parsedEndAt <= parsedStartAt) {
      return { ok: false, error: messages.endAfterStart }
    }

    let effectiveCustomerId = customerId
    let effectiveContactId = contactId
    let effectiveIsInternal = Boolean(input.isInternal)
    let effectivePrice: number | null = price
    let effectiveIsPaid = Boolean(input.isPaid)

    if (parentJobId) {
      const parentResponse = await supabase
        .from('jobs')
        .select('id, parent_job_id, customer_id, contact_id, is_internal')
        .eq('id', parentJobId)
        .eq('company_id', companyId)
        .maybeSingle()

      if (parentResponse.error || !parentResponse.data?.id) {
        return { ok: false, error: messages.jobNotFoundActiveCompany }
      }

      if (parentResponse.data.parent_job_id) {
        return { ok: false, error: 'Dcera se dÃ¡ pÅ™idat jen pod hlavnÃ­ zakÃ¡zku.' }
      }

      effectiveCustomerId = parentResponse.data.customer_id ?? null
      effectiveContactId = parentResponse.data.contact_id ?? null
      effectiveIsInternal = parentResponse.data.is_internal === true
      effectivePrice = null
      effectiveIsPaid = false
    }

    if (!effectiveCustomerId && !effectiveIsInternal) {
      return { ok: false, error: messages.customerRequired }
    }

    const customerError = await verifyCustomerScope({
      supabase,
      companyId,
      customerId: effectiveCustomerId,
      contactId: effectiveContactId,
    })

    if (customerError) {
      return { ok: false, error: customerError }
    }

    const assignedProfileIds = normalizeAssignedProfileIds(input.assignedProfileIds)

    if (assignedProfileIds.length === 0) {
      return { ok: false, error: messages.workerRequired }
    }

    const assignedProfilesError = await verifyAssignedProfiles({
      supabase,
      companyId,
      profileIds: assignedProfileIds,
    })

    if (assignedProfilesError) {
      return { ok: false, error: assignedProfilesError }
    }

    const baseJob = {
      company_id: companyId,
      customer_id: effectiveCustomerId,
      contact_id: effectiveContactId,
      title,
      description: cleanString(input.description),
      address: cleanString(input.address),
      status: 'planned',
      work_state: 'not_started',
      billing_state: effectiveIsPaid ? 'paid' : 'waiting_for_invoice',
      billing_status: effectiveIsPaid ? 'paid' : 'waiting_for_invoice',
      is_internal: effectiveIsInternal,
    }

    const selectedDailyJobs = (input.selectedDailyJobs ?? []).filter(
      (day) => cleanOptionalId(day.startAt) && cleanOptionalId(day.endAt)
    )

    let jobs: Array<{ id: string; parent_job_id: string | null }> | null = null

    if (parentJobId) {
      const { data, error } = await supabase
        .from('jobs')
        .insert({
          ...baseJob,
          price: effectivePrice,
          ...buildScheduleFields(normalizedStartAt, normalizedEndAt),
          is_paid: effectiveIsPaid,
          parent_job_id: parentJobId,
        })
        .select('id, parent_job_id')

      if (error || !data) {
        return { ok: false, error: error?.message ?? messages.createJobFailed }
      }
      jobs = data as Array<{ id: string; parent_job_id: string | null }>
    } else if (selectedDailyJobs.length > 0) {
      if (selectedDailyJobs.length > 370) {
        return { ok: false, error: messages.dailyLimit }
      }

      const { data: parentJob, error: parentError } = await supabase
        .from('jobs')
        .insert({
          ...baseJob,
          price: effectivePrice,
          ...buildScheduleFields(normalizedStartAt, normalizedEndAt),
          is_paid: effectiveIsPaid,
          parent_job_id: null,
        })
        .select('id, parent_job_id')
        .single()

      if (parentError || !parentJob?.id) {
        return { ok: false, error: parentError?.message ?? messages.createJobFailed }
      }

      const childJobs = selectedDailyJobs.map((day) => {
        const childStartAt = cleanOptionalId(day.startAt)
        const childEndAt = cleanOptionalId(day.endAt)
        const normalizedChildStartAt = parseDate(childStartAt)?.toISOString() ?? childStartAt
        const normalizedChildEndAt = parseDate(childEndAt)?.toISOString() ?? childEndAt

        return {
          ...baseJob,
            price: null,
          ...buildScheduleFields(normalizedChildStartAt, normalizedChildEndAt),
          is_paid: false,
          parent_job_id: parentJob.id,
        }
      })

      const { data: createdChildJobs, error: childError } = await supabase
        .from('jobs')
        .insert(childJobs)
        .select('id, parent_job_id')

      if (childError || !createdChildJobs) {
        await supabase.from('jobs').delete().eq('id', parentJob.id).eq('company_id', companyId)
        return { ok: false, error: childError?.message ?? messages.createDailyJobsFailed }
      }

      jobs = [parentJob, ...createdChildJobs] as Array<{ id: string; parent_job_id: string | null }>
    } else if (input.isRecurringWeekly) {
      const recurring = buildRecurringJobs({
        baseJob,
        price: effectivePrice ?? 0,
          isPaid: effectiveIsPaid,
        startAt,
        endAt,
        repeatWeekday: Number(input.repeatWeekday ?? 1),
        repeatUntil: cleanOptionalId(input.repeatUntil),
        messages,
      })

      if (recurring.error) {
        return { ok: false, error: recurring.error }
      }

      if (recurring.jobs.length === 0) {
        return { ok: false, error: messages.recurrenceNoJobs }
      }

      const { data, error } = await supabase.from('jobs').insert(recurring.jobs).select('id, parent_job_id')
      if (error || !data) {
        return { ok: false, error: error?.message ?? messages.createJobsFailed }
      }
      jobs = data as Array<{ id: string; parent_job_id: string | null }>
    } else {
      const { data, error } = await supabase
        .from('jobs')
        .insert({
          ...baseJob,
            price: effectivePrice,
          ...buildScheduleFields(normalizedStartAt, normalizedEndAt),
            is_paid: effectiveIsPaid,
          parent_job_id: null,
        })
        .select('id, parent_job_id')

      if (error || !data) {
        return { ok: false, error: error?.message ?? messages.createJobFailed }
      }
      jobs = data as Array<{ id: string; parent_job_id: string | null }>
    }

    if (!jobs || jobs.length === 0) {
      return { ok: false, error: messages.createJobFailed }
    }

    const jobsForAssignments = selectedDailyJobs.length > 0 ? jobs.filter((job) => job.parent_job_id) : jobs

    if (assignedProfileIds.length > 0 && jobsForAssignments.length > 0) {
      const assignments = jobsForAssignments.flatMap((job) =>
        assignedProfileIds.map((profileId) => ({
          company_id: companyId,
          job_id: job.id,
          profile_id: profileId,
          role_label: 'worker',
        }))
      )

      const { error } = await supabase.from('job_assignments').insert(assignments)

      if (error) {
        await deleteCreatedJobs({
          supabase,
          companyId,
          jobIds: jobs.map((job) => job.id),
        })

        return { ok: false, error: messages.assignWorkersFailed(error.message) }
      }
    }

    revalidatePath('/jobs')
    revalidatePath('/')
    revalidatePath('/calendar')
    if (effectiveCustomerId) {
      revalidatePath(`/customers/${effectiveCustomerId}`)
    }
    for (const job of jobs) {
      revalidatePath(`/jobs/${job.id}`)
    }

    const redirectTo =
      selectedDailyJobs.length > 0 || jobs.length === 1 ? `/jobs/${jobs[0].id}` : '/jobs'

    return {
      ok: true,
      redirectTo,
      jobIds: jobs.map((job) => job.id),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : messages.createJobFailed,
    }
  }
}

export async function createParentSummaryJobAction(input: {
  jobId?: string | null
  customerId?: string | null
  contactId?: string | null
  title?: string | null
  description?: string | null
  address?: string | null
  price?: string | number | null
  isInternal?: boolean
  startAt?: string | null
  endAt?: string | null
  isPaid?: boolean
  status?: string | null
}): Promise<CreateParentSummaryJobResult> {
  const messages = getJobActionMessages(await getRequestLocale())

  try {
    const context = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'jobs')
    const jobId = cleanString(input.jobId)

    if (!moduleAccess.ok) return { ok: false, error: moduleAccess.error }
    if (!jobId) return { ok: false, error: messages.missingJob }

    const currentJobResponse = await supabase
      .from('jobs')
      .select('id, parent_job_id')
      .eq('id', jobId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (currentJobResponse.error || !currentJobResponse.data?.id) {
      return { ok: false, error: messages.jobNotFoundActiveCompany }
    }

    const childResponse = await supabase
      .from('jobs')
      .select('id')
      .eq('company_id', companyId)
      .eq('parent_job_id', jobId)
      .limit(1)

    if (childResponse.error) return { ok: false, error: childResponse.error.message }
    if ((childResponse.data ?? []).length > 0) {
      return { ok: false, error: messages.jobHasChildrenCannotMove }
    }

    const customerId = cleanOptionalId(input.customerId)
    const contactId = cleanOptionalId(input.contactId)
    const customerError = await verifyCustomerScope({ supabase, companyId, customerId, contactId })
    if (customerError) return { ok: false, error: customerError }

    const startAt = parseDate(cleanOptionalId(input.startAt))?.toISOString() ?? cleanOptionalId(input.startAt)
    const endAt = parseDate(cleanOptionalId(input.endAt))?.toISOString() ?? cleanOptionalId(input.endAt)
    const rawPrice = cleanString(input.price)
    const parsedPrice = toOptionalNumber(input.price)
    const price = parsedPrice ?? 0

    if (rawPrice && (parsedPrice === null || parsedPrice < 0)) {
      return { ok: false, error: messages.invalidPrice }
    }

    const parentResponse = await supabase
      .from('jobs')
      .insert({
        company_id: companyId,
        customer_id: customerId,
        contact_id: contactId,
        title: cleanString(input.title) || messages.mainJobTitle,
        description: cleanOptionalId(input.description),
        address: cleanOptionalId(input.address),
        price,
        is_internal: Boolean(input.isInternal),
        status: cleanOptionalId(input.status) ?? 'future',
        is_paid: Boolean(input.isPaid),
        parent_job_id: null,
        work_state: 'not_started',
        billing_state: Boolean(input.isPaid) ? 'paid' : 'waiting_for_invoice',
        billing_status: Boolean(input.isPaid) ? 'paid' : 'waiting_for_invoice',
        ...buildScheduleFields(startAt, endAt),
      })
      .select('id, customer_id, contact_id, title, description, scheduled_start, scheduled_end, scheduled_date, start_at, end_at, address, price, is_paid')
      .single()

    if (parentResponse.error || !parentResponse.data?.id) {
      return { ok: false, error: parentResponse.error?.message ?? messages.createParentFailed }
    }

    const linkResponse = await supabase
      .from('jobs')
      .update({
        parent_job_id: parentResponse.data.id,
        price: 0,
        is_paid: false,
      })
      .eq('id', jobId)
      .eq('company_id', companyId)

    if (linkResponse.error) {
      await supabase.from('jobs').delete().eq('id', parentResponse.data.id).eq('company_id', companyId)
      return { ok: false, error: linkResponse.error.message || messages.connectParentFailed }
    }

    revalidatePath('/jobs')
    revalidatePath(`/jobs/${jobId}`)
    revalidatePath(`/jobs/${parentResponse.data.id}`)

    return {
      ok: true,
      parentJob: parentResponse.data as CreateParentSummaryJobResult extends { ok: true; parentJob: infer T }
        ? T
        : never,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : messages.createParentFailed,
    }
  }
}

export async function detachJobFromParentAction(input: {
  jobId?: string | null
}): Promise<JobMutationResult> {
  const messages = getJobActionMessages(await getRequestLocale())

  try {
    const context = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const { supabase, companyId } = context
    const jobId = cleanString(input.jobId)

    if (!jobId) return { ok: false, error: messages.missingJob }

    const response = await supabase
      .from('jobs')
      .update({ parent_job_id: null })
      .eq('id', jobId)
      .eq('company_id', companyId)

    if (response.error) {
      return { ok: false, error: response.error.message || messages.detachFailed }
    }

    revalidatePath('/jobs')
    revalidatePath(`/jobs/${jobId}`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : messages.detachFailed,
    }
  }
}

export async function attachJobToParentAction(input: {
  childJobId?: string | null
  parentJobId?: string | null
}): Promise<JobMutationResult> {
  try {
    const context = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'jobs')
    const childJobId = cleanString(input.childJobId)
    const parentJobId = cleanString(input.parentJobId)

    if (!moduleAccess.ok) return { ok: false, error: moduleAccess.error }
    if (!childJobId || !parentJobId) return { ok: false, error: 'ChybÃ­ zakÃ¡zka.' }
    if (childJobId === parentJobId) {
      return { ok: false, error: 'ZakÃ¡zku nejde pÅ™esunout pod sebe samu.' }
    }

    const jobsResponse = await supabase
      .from('jobs')
      .select('id, parent_job_id, customer_id, contact_id')
      .eq('company_id', companyId)
      .in('id', [childJobId, parentJobId])

    if (jobsResponse.error) return { ok: false, error: jobsResponse.error.message }

    const jobsById = new Map(
      ((jobsResponse.data ?? []) as Array<{
        id: string
        parent_job_id: string | null
        customer_id: string | null
        contact_id: string | null
      }>).map((job) => [job.id, job])
    )
    const childJob = jobsById.get(childJobId)
    const parentJob = jobsById.get(parentJobId)

    if (!childJob || !parentJob) return { ok: false, error: 'ZakÃ¡zka nebyla nalezena.' }
    if (childJob.parent_job_id) {
      return { ok: false, error: 'Tato zakÃ¡zka uÅ¾ je pod hlavnÃ­ zakÃ¡zkou. NejdÅ™Ã­v ji odpojte.' }
    }
    if (parentJob.parent_job_id) {
      return { ok: false, error: 'CÃ­lovÃ¡ zakÃ¡zka uÅ¾ je dcerou jinÃ© zakÃ¡zky.' }
    }
    if (childJob.customer_id && parentJob.customer_id && childJob.customer_id !== parentJob.customer_id) {
      return { ok: false, error: 'ZakÃ¡zky s rozdÃ­lnÃ½m zÃ¡kaznÃ­kem nejde seskupit.' }
    }

    const childChildrenResponse = await supabase
      .from('jobs')
      .select('id')
      .eq('company_id', companyId)
      .eq('parent_job_id', childJobId)
      .limit(1)

    if (childChildrenResponse.error) return { ok: false, error: childChildrenResponse.error.message }
    if ((childChildrenResponse.data ?? []).length > 0) {
      return { ok: false, error: 'Tato zakÃ¡zka uÅ¾ mÃ¡ dcery a nejde pÅ™esunout pod jinou zakÃ¡zku.' }
    }

    const updateResponse = await supabase
      .from('jobs')
      .update({
        parent_job_id: parentJobId,
        price: null,
        is_paid: false,
        customer_id: parentJob.customer_id ?? childJob.customer_id,
        contact_id: parentJob.contact_id ?? childJob.contact_id,
      })
      .eq('id', childJobId)
      .eq('company_id', companyId)

    if (updateResponse.error) return { ok: false, error: updateResponse.error.message }

    revalidatePath('/jobs')
    revalidatePath(`/jobs/${childJobId}`)
    revalidatePath(`/jobs/${parentJobId}`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'ZakÃ¡zku se nepodaÅ™ilo pÅ™ipojit k hlavnÃ­ zakÃ¡zce.',
    }
  }
}

export async function createJobGroupFromDropAction(input: {
  draggedJobId?: string | null
  targetJobId?: string | null
}): Promise<JobMutationResult> {
  try {
    const context = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'jobs')
    const draggedJobId = cleanString(input.draggedJobId)
    const targetJobId = cleanString(input.targetJobId)

    if (!moduleAccess.ok) return { ok: false, error: moduleAccess.error }
    if (!draggedJobId || !targetJobId) return { ok: false, error: 'Chybi zakazka.' }
    if (draggedJobId === targetJobId) {
      return { ok: false, error: 'Zakazku nejde seskupit samu se sebou.' }
    }

    const jobsResponse = await supabase
      .from('jobs')
      .select('id, parent_job_id, customer_id, contact_id, title, description, address, status, is_internal, start_at, end_at, scheduled_start, scheduled_end, scheduled_date')
      .eq('company_id', companyId)
      .in('id', [draggedJobId, targetJobId])

    if (jobsResponse.error) return { ok: false, error: jobsResponse.error.message }

    const jobsById = new Map(
      ((jobsResponse.data ?? []) as Array<{
        id: string
        parent_job_id: string | null
        customer_id: string | null
        contact_id: string | null
        title: string | null
        description: string | null
        address: string | null
        status: string | null
        is_internal: boolean | null
        start_at: string | null
        end_at: string | null
        scheduled_start: string | null
        scheduled_end: string | null
        scheduled_date: string | null
      }>).map((job) => [job.id, job])
    )
    const draggedJob = jobsById.get(draggedJobId)
    const targetJob = jobsById.get(targetJobId)

    if (!draggedJob || !targetJob) return { ok: false, error: 'Zakazka nebyla nalezena.' }
    if (draggedJob.parent_job_id || targetJob.parent_job_id) {
      return { ok: false, error: 'Zakazka uz je ve skupine. Nejdriv ji odpojte.' }
    }
    if (draggedJob.customer_id && targetJob.customer_id && draggedJob.customer_id !== targetJob.customer_id) {
      return { ok: false, error: 'Zakazky s rozdilnym zakaznikem nejde seskupit.' }
    }

    const childrenResponse = await supabase
      .from('jobs')
      .select('id')
      .eq('company_id', companyId)
      .in('parent_job_id', [draggedJobId, targetJobId])
      .limit(1)

    if (childrenResponse.error) return { ok: false, error: childrenResponse.error.message }
    if ((childrenResponse.data ?? []).length > 0) {
      return { ok: false, error: 'Zakazka uz ma dcery a nejde ji vlozit do nove skupiny.' }
    }

    const groupStartAt = [draggedJob.start_at, targetJob.start_at].filter(Boolean).sort()[0] ?? null
    const groupEndAt = [draggedJob.end_at, targetJob.end_at].filter(Boolean).sort().at(-1) ?? null
    const scheduleFields = buildScheduleFields(groupStartAt, groupEndAt)

    const parentResponse = await supabase
      .from('jobs')
      .insert({
        company_id: companyId,
        customer_id: targetJob.customer_id ?? draggedJob.customer_id,
        contact_id: targetJob.contact_id ?? draggedJob.contact_id,
        title: 'Skupina zakazek',
        description: targetJob.description ?? draggedJob.description ?? '',
        address: targetJob.address ?? draggedJob.address ?? '',
        status: targetJob.status ?? draggedJob.status ?? 'future',
        is_internal: Boolean(targetJob.is_internal ?? draggedJob.is_internal),
        price: null,
        is_paid: false,
        parent_job_id: null,
        work_state: 'not_started',
        billing_state: 'waiting_for_invoice',
        billing_status: 'waiting_for_invoice',
        scheduled_start: scheduleFields.scheduled_start,
        scheduled_end: scheduleFields.scheduled_end,
        scheduled_date: scheduleFields.scheduled_date,
        start_at: scheduleFields.start_at,
        end_at: scheduleFields.end_at,
      })
      .select('id')
      .single()

    if (parentResponse.error || !parentResponse.data?.id) {
      return { ok: false, error: parentResponse.error?.message ?? 'Matku se nepodarilo vytvorit.' }
    }

    const parentJobId = parentResponse.data.id
    const updateResponse = await supabase
      .from('jobs')
      .update({
        parent_job_id: parentJobId,
      })
      .eq('company_id', companyId)
      .in('id', [draggedJobId, targetJobId])

    if (updateResponse.error) {
      await supabase.from('jobs').delete().eq('id', parentJobId).eq('company_id', companyId)
      return { ok: false, error: updateResponse.error.message }
    }

    revalidatePath('/jobs')
    revalidatePath(`/jobs/${draggedJobId}`)
    revalidatePath(`/jobs/${targetJobId}`)
    revalidatePath(`/jobs/${parentJobId}`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Skupinu zakazek se nepodarilo vytvorit.',
    }
  }
}

export async function detachCustomerFromJobAction(jobIdInput: string): Promise<JobMutationResult> {
  const messages = getJobActionMessages(await getRequestLocale())

  try {
    const context = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const { supabase, companyId } = context
    const jobId = cleanString(jobIdInput)

    if (!jobId) return { ok: false, error: messages.missingJob }

    const jobResponse = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (jobResponse.error || !jobResponse.data?.id) {
      return { ok: false, error: messages.jobNotFoundActiveCompany }
    }

    const contactsResponse = await supabase
      .from('job_customer_contacts')
      .delete()
      .eq('job_id', jobId)
      .eq('company_id', companyId)

    if (contactsResponse.error) {
      return { ok: false, error: contactsResponse.error.message || messages.contactsDetachFailed }
    }

    const response = await supabase
      .from('jobs')
      .update({
        customer_id: null,
        contact_id: null,
      })
      .eq('id', jobId)
      .eq('company_id', companyId)

    if (response.error) {
      return { ok: false, error: response.error.message || messages.detachCustomerFailed }
    }

    revalidatePath('/jobs')
    revalidatePath(`/jobs/${jobId}`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : messages.detachCustomerFailed,
    }
  }
}

export async function deleteJobSafelyAction(jobIdInput: string): Promise<JobMutationResult> {
  const messages = getJobActionMessages(await getRequestLocale())

  try {
    const context = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const { supabase, companyId } = context
    const jobId = cleanString(jobIdInput)

    if (!jobId) return { ok: false, error: messages.missingJob }

    const jobResponse = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (jobResponse.error || !jobResponse.data?.id) {
      return { ok: false, error: messages.jobNotFoundActiveCompany }
    }

    const response = await supabase.rpc('delete_job_safe', { p_job_id: jobId })

    if (response.error) {
      return { ok: false, error: response.error.message || messages.deleteJobFailed }
    }

    revalidatePath('/jobs')
    revalidatePath('/')
    revalidatePath('/calendar')

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : messages.deleteJobFailed,
    }
  }
}
