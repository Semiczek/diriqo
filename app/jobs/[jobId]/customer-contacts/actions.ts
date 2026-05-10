'use server'

import { revalidatePath } from 'next/cache'

import { requireHubDalContext } from '@/lib/dal/auth'
import { getRequestLocale } from '@/lib/i18n/server'
import type { Locale } from '@/lib/i18n/config'
import { requireCompanyModule } from '@/lib/module-access'

export type AssignJobCustomerContactResult =
  | {
      ok: true
    }
  | {
      ok: false
      error: string
    }

export type JobCustomerContactMutationResult = AssignJobCustomerContactResult

function cleanOptionalId(value: unknown) {
  const cleaned = String(value ?? '').trim()
  return cleaned || null
}

function getContactActionMessages(locale: Locale) {
  if (locale === 'en') {
    return {
      missingJob: 'Missing job ID.',
      selectContact: 'Select a contact.',
      jobNotFound: 'The job was not found in the active company.',
      jobHasNoCustomer: 'The job has no assigned customer.',
      contactNotForCustomer: 'The contact does not belong to this job customer.',
      duplicateCheckFailed: (message: string) => `Failed to check duplicates: ${message}`,
      alreadyAssigned: 'This contact is already assigned to the job.',
      saveFailed: 'The contact could not be saved.',
      missingJobContact: 'Missing job contact.',
      removeFailed: 'The contact could not be removed.',
    }
  }

  if (locale === 'de') {
    return {
      missingJob: 'Auftrags-ID fehlt.',
      selectContact: 'Kontakt auswählen.',
      jobNotFound: 'Der Auftrag wurde in der aktiven Firma nicht gefunden.',
      jobHasNoCustomer: 'Dem Auftrag ist kein Kunde zugeordnet.',
      contactNotForCustomer: 'Der Kontakt gehört nicht zum Kunden dieses Auftrags.',
      duplicateCheckFailed: (message: string) => `Duplikatprüfung fehlgeschlagen: ${message}`,
      alreadyAssigned: 'Dieser Kontakt ist dem Auftrag bereits zugewiesen.',
      saveFailed: 'Der Kontakt konnte nicht gespeichert werden.',
      missingJobContact: 'Auftragskontakt fehlt.',
      removeFailed: 'Der Kontakt konnte nicht entfernt werden.',
    }
  }

  return {
    missingJob: 'Chybí ID zakázky.',
    selectContact: 'Vyberte kontakt.',
    jobNotFound: 'Zakázka nebyla nalezena v aktivní firmě.',
    jobHasNoCustomer: 'Zakázka nemá přiřazeného zákazníka.',
    contactNotForCustomer: 'Kontakt nepatří k zákazníkovi této zakázky.',
    duplicateCheckFailed: (message: string) => `Nepodařilo se ověřit duplicitu: ${message}`,
    alreadyAssigned: 'Tento kontakt už je u zakázky přiřazen.',
    saveFailed: 'Kontakt se nepodařilo uložit.',
    missingJobContact: 'Chybí kontakt zakázky.',
    removeFailed: 'Kontakt se nepodařilo odebrat.',
  }
}

export async function assignJobCustomerContactAction(input: {
  jobId?: string | null
  customerContactId?: string | null
  roleLabel?: string | null
}): Promise<AssignJobCustomerContactResult> {
  const messages = getContactActionMessages(await getRequestLocale())

  try {
    const context = await requireHubDalContext()
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'jobs')

    if (!moduleAccess.ok) {
      return { ok: false, error: moduleAccess.error }
    }

    const jobId = cleanOptionalId(input.jobId)
    const customerContactId = cleanOptionalId(input.customerContactId)
    const roleLabel = cleanOptionalId(input.roleLabel)

    if (!jobId) {
      return { ok: false, error: messages.missingJob }
    }

    if (!customerContactId) {
      return { ok: false, error: messages.selectContact }
    }

    const jobResponse = await supabase
      .from('jobs')
      .select('id, customer_id')
      .eq('id', jobId)
      .eq('company_id', companyId)
      .maybeSingle()

    const job = jobResponse.data as { id?: string | null; customer_id?: string | null } | null

    if (jobResponse.error || !job?.id) {
      return { ok: false, error: messages.jobNotFound }
    }

    if (!job.customer_id) {
      return { ok: false, error: messages.jobHasNoCustomer }
    }

    const contactResponse = await supabase
      .from('customer_contacts')
      .select('id, customer_id')
      .eq('id', customerContactId)
      .eq('customer_id', job.customer_id)
      .maybeSingle()

    const contact = contactResponse.data as { id?: string | null; customer_id?: string | null } | null

    if (contactResponse.error || !contact?.id) {
      return { ok: false, error: messages.contactNotForCustomer }
    }

    const existingResponse = await supabase
      .from('job_customer_contacts')
      .select('id')
      .eq('job_id', jobId)
      .eq('customer_contact_id', customerContactId)
      .maybeSingle()

    if (existingResponse.error) {
      return { ok: false, error: messages.duplicateCheckFailed(existingResponse.error.message) }
    }

    if (existingResponse.data) {
      return { ok: false, error: messages.alreadyAssigned }
    }

    const insertResponse = await supabase.from('job_customer_contacts').insert({
      company_id: companyId,
      job_id: jobId,
      customer_contact_id: customerContactId,
      role_label: roleLabel,
    })

    if (insertResponse.error) {
      return { ok: false, error: insertResponse.error.message || messages.saveFailed }
    }

    revalidatePath('/jobs')
    revalidatePath(`/jobs/${jobId}`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : messages.saveFailed,
    }
  }
}

export async function deleteJobCustomerContactAction(input: {
  jobId?: string | null
  jobCustomerContactId?: string | null
}): Promise<JobCustomerContactMutationResult> {
  const messages = getContactActionMessages(await getRequestLocale())

  try {
    const context = await requireHubDalContext()
    const { supabase, companyId } = context
    const moduleAccess = await requireCompanyModule(companyId, 'jobs')
    const jobId = cleanOptionalId(input.jobId)
    const jobCustomerContactId = cleanOptionalId(input.jobCustomerContactId)

    if (!moduleAccess.ok) return { ok: false, error: moduleAccess.error }
    if (!jobId || !jobCustomerContactId) return { ok: false, error: messages.missingJobContact }

    const jobResponse = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (jobResponse.error || !jobResponse.data?.id) {
      return { ok: false, error: messages.jobNotFound }
    }

    const deleteResponse = await supabase
      .from('job_customer_contacts')
      .delete()
      .eq('id', jobCustomerContactId)
      .eq('job_id', jobId)
      .eq('company_id', companyId)

    if (deleteResponse.error) {
      return { ok: false, error: deleteResponse.error.message || messages.removeFailed }
    }

    revalidatePath('/jobs')
    revalidatePath(`/jobs/${jobId}`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : messages.removeFailed,
    }
  }
}
