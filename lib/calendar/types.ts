export type CalendarEvent = {
  id: string
  company_id: string
  title: string
  description: string | null
  start_at: string | null
  end_at: string | null
  job_id: string | null
  /** Opaque PostgreSQL bigint; one atomic edit may advance it more than once. */
  revision: string
}

export type CalendarSnapshot = { event: CalendarEvent; assigned_profile_ids: string[] }
export type CalendarErrorCode = 'conflict' | 'forbidden' | 'validation' | 'unavailable' | 'not_found' | 'unknown'
export type CalendarFailure = { ok: false; error: string; code: CalendarErrorCode; current?: CalendarSnapshot }
export type CalendarResult<T> = { ok: true; data: T } | CalendarFailure
export type CalendarWriteInput = {
  title?: string | null; description?: string | null
  startAt?: string | null; endAt?: string | null
  jobId?: string | null; companyId?: string | null; selectedProfileIds?: string[]
}
export type CalendarUpdateInput = CalendarWriteInput & { eventId?: string | null; expectedRevision?: string | null }
export type CalendarDeleteInput = { eventId: string; companyId: string; expectedRevision: string }
export type CalendarWriteSuccess = { ok: true; eventId: string; event: CalendarEvent; assignedProfileIds: string[] }
export type CalendarJob = {
  id: string; company_id: string; parent_job_id: string | null; title: string | null
  description: string | null; status: string | null; start_at: string | null; end_at: string | null
  customer_id: string | null; customers: { name: string | null }[] | null
}
export type CalendarListData = {
  companyId: string; jobs: CalendarJob[]
  eventRows: Array<Pick<CalendarEvent, 'id' | 'title' | 'description' | 'start_at' | 'end_at' | 'job_id'>>
}
export type CalendarEditorData = {
  companyId: string; companyName: string | null
  jobs: Array<Pick<CalendarJob, 'id' | 'title' | 'company_id'>>
  profiles: Array<{ id: string; full_name: string | null }>
  snapshot: CalendarSnapshot | null
}
