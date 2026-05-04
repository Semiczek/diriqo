import { NextRequest, NextResponse } from 'next/server'

import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type RouteContext = {
  params: Promise<{
    jobId: string
  }>
}

type JobUpdatePayload = {
  title?: string | null
  description?: string | null
  status?: string | null
  address?: string | null
  price?: number | null
  is_internal?: boolean | null
  start_at?: string | null
  end_at?: string | null
  is_paid?: boolean | null
  customer_id?: string | null
  contact_id?: string | null
  parent_job_id?: string | null
  propagate_to_children?: boolean
}

type JobCheckRow = {
  id: string
  company_id: string | null
  parent_job_id: string | null
}

function normalizeNullableText(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeNullableUuid(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeNullableIso(value: unknown) {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null

  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null

  return date.toISOString()
}

function normalizeNullableNumber(value: unknown) {
  if (value == null || value === '') return null
  if (typeof value !== 'number') return null
  return Number.isFinite(value) ? value : null
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { jobId } = await context.params
  const cleanJobId = jobId?.trim()

  if (!cleanJobId) {
    return NextResponse.json({ error: 'Missing job id.' }, { status: 400 })
  }

  const payload = (await request.json().catch(() => ({}))) as JobUpdatePayload
  const supabase = await createSupabaseServerClient()

  const existingJobResponse = await supabase
    .from('jobs')
    .select('id, company_id, parent_job_id')
    .eq('id', cleanJobId)
    .eq('company_id', activeCompany.companyId)
    .maybeSingle()

  if (existingJobResponse.error) {
    return NextResponse.json(
      { error: `Failed to load job: ${existingJobResponse.error.message}` },
      { status: 500 }
    )
  }

  const existingJob = (existingJobResponse.data ?? null) as JobCheckRow | null

  if (!existingJob) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
  }

  const parentJobId = normalizeNullableUuid(payload.parent_job_id)

  if (parentJobId && parentJobId === cleanJobId) {
    return NextResponse.json(
      { error: 'Zakázka nemůže být sama sobě nadřazenou.' },
      { status: 400 }
    )
  }

  const title = normalizeNullableText(payload.title)
  const description = normalizeNullableText(payload.description)
  const address = normalizeNullableText(payload.address)
  const customerId = normalizeNullableUuid(payload.customer_id)
  const contactId = normalizeNullableUuid(payload.contact_id)
  const startAt = normalizeNullableIso(payload.start_at)
  const endAt = normalizeNullableIso(payload.end_at)
  const price = normalizeNullableNumber(payload.price)
  const isInternal = payload.is_internal === true
  const status = typeof payload.status === 'string' ? payload.status : null
  const isPaid = typeof payload.is_paid === 'boolean' ? payload.is_paid : false
  const propagateToChildren = payload.propagate_to_children === true

  if (startAt && endAt && new Date(endAt).getTime() < new Date(startAt).getTime()) {
    return NextResponse.json(
      { error: 'Datum konce musí být později než datum začátku.' },
      { status: 400 }
    )
  }

  if (parentJobId) {
    const parentCheckResponse = await supabase
      .from('jobs')
      .select('id, company_id, customer_id, contact_id')
      .eq('id', parentJobId)
      .eq('company_id', activeCompany.companyId)
      .maybeSingle()

    if (parentCheckResponse.error) {
      return NextResponse.json(
        { error: `Failed to load parent job: ${parentCheckResponse.error.message}` },
        { status: 500 }
      )
    }

    if (!parentCheckResponse.data) {
      return NextResponse.json({ error: 'Parent job not found.' }, { status: 404 })
    }
  }

  const updatePayload = {
    title,
    description,
    status,
    address,
    price: parentJobId ? null : price,
    is_internal: isInternal,
    start_at: startAt,
    end_at: endAt,
    is_paid: parentJobId ? false : isPaid,
    customer_id: customerId,
    contact_id: contactId,
    parent_job_id: parentJobId,
  }

  const updateResponse = await supabase
    .from('jobs')
    .update(updatePayload)
    .eq('id', cleanJobId)
    .eq('company_id', activeCompany.companyId)

  if (updateResponse.error) {
    return NextResponse.json(
      { error: `Failed to update job: ${updateResponse.error.message}` },
      { status: 500 }
    )
  }

  if (propagateToChildren && !existingJob.parent_job_id) {
    const childUpdatePayload = {
      title,
      description,
      customer_id: customerId,
      is_internal: isInternal,
    }

    const childUpdateResponse = await supabase
      .from('jobs')
      .update(childUpdatePayload)
      .eq('company_id', activeCompany.companyId)
      .eq('parent_job_id', cleanJobId)

    if (childUpdateResponse.error) {
      return NextResponse.json(
        { error: `Failed to propagate changes to child jobs: ${childUpdateResponse.error.message}` },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ ok: true })
}
