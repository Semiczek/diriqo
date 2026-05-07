'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

function toLocalDateTimeInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

type GeneratedWorkDay = {
  dateKey: string
  label: string
  startAt: Date
  endAt: Date
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function getLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

function makeDateOnDay(dateKey: string, sourceTime: Date) {
  const [year, month, day] = dateKey.split('-').map(Number)

  return new Date(
    year,
    month - 1,
    day,
    sourceTime.getHours(),
    sourceTime.getMinutes(),
    sourceTime.getSeconds(),
    sourceTime.getMilliseconds(),
  )
}

function isDifferentLocalDay(start: Date | null, end: Date | null) {
  if (!start || !end) return false
  return getLocalDateKey(start) !== getLocalDateKey(end)
}

function formatWorkDayLabel(date: Date) {
  return new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function generateWorkDays(start: Date | null, end: Date | null): GeneratedWorkDay[] {
  if (!start || !end || end <= start || !isDifferentLocalDay(start, end)) return []

  const days: GeneratedWorkDay[] = []
  const endDateKey = getLocalDateKey(end)
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())

  while (getLocalDateKey(cursor) <= endDateKey) {
    const dateKey = getLocalDateKey(cursor)
    const occurrenceStart = makeDateOnDay(dateKey, start)
    let occurrenceEnd = makeDateOnDay(dateKey, end)

    if (occurrenceEnd <= occurrenceStart) {
      occurrenceEnd = new Date(occurrenceEnd)
      occurrenceEnd.setDate(occurrenceEnd.getDate() + 1)
    }

    days.push({
      dateKey,
      label: formatWorkDayLabel(cursor),
      startAt: occurrenceStart,
      endAt: occurrenceEnd,
    })

    cursor.setDate(cursor.getDate() + 1)
  }

  return days
}

function buttonStyle(backgroundColor: string, color: string, border: string, disabled: boolean) {
  return {
    border,
    backgroundColor,
    color,
    borderRadius: '12px',
    padding: '10px 14px',
    fontSize: '14px',
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    whiteSpace: 'nowrap' as const,
  }
}

type QuoteActionsPanelProps = {
  customerId: string
  quoteId: string
  companyId: string
  shareUrl?: string | null
  contactName?: string | null
  contactEmail?: string | null
  quoteTitle?: string | null
  sourceCalculationId?: string | null
  discountAmount?: number | null
  currentStatus?: string | null
  totalPrice?: number | null
  workDescription?: string | null
  proposedSolution?: string | null
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />')
}

function buildHtmlMessage(text: string) {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(
    text,
  )}</div>`
}

export default function QuoteActionsPanel({
  customerId,
  quoteId,
  companyId,
  shareUrl,
  contactName,
  contactEmail,
  quoteTitle,
  sourceCalculationId,
  discountAmount,
  currentStatus,
  totalPrice,
  workDescription,
  proposedSolution,
}: QuoteActionsPanelProps) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [copying, setCopying] = useState(false)
  const [syncingPricing, setSyncingPricing] = useState(false)
  const [sendingUpdate, setSendingUpdate] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [creatingJob, setCreatingJob] = useState(false)
  const [showCreateJobModal, setShowCreateJobModal] = useState(false)
  const [showSendOfferModal, setShowSendOfferModal] = useState(false)
  const [jobAddress, setJobAddress] = useState('')
  const [jobDescription, setJobDescription] = useState(workDescription?.trim() || proposedSolution?.trim() || '')
  const [jobCreationMode, setJobCreationMode] = useState<'single' | 'split'>('single')
  const [sendJobConfirmation, setSendJobConfirmation] = useState(Boolean(contactEmail?.trim()))
  const [selectedWorkDates, setSelectedWorkDates] = useState<string[]>([])
  const [offerRecipientEmail, setOfferRecipientEmail] = useState(contactEmail?.trim() || '')
  const [offerRecipientName, setOfferRecipientName] = useState(contactName?.trim() || '')
  const [offerSubject, setOfferSubject] = useState(
    `Aktualizovaná cenová nabídka: ${quoteTitle?.trim() || 'Diriqo'}`,
  )
  const [offerMessage, setOfferMessage] = useState(() =>
    [
      `Dobrý den${contactName?.trim() ? ` ${contactName.trim()}` : ''},`,
      '',
      'zasíláme Vám aktualizovanou verzi cenové nabídky.',
      '',
      shareUrl ? `Odkaz na nabídku:\n${shareUrl}` : 'Odkaz na nabídku teď není dostupný.',
      '',
      'Pokud budete chtít cokoli upravit, dejte nám prosím vědět.',
      '',
      'S pozdravem',
      'Diriqo',
    ].join('\n'),
  )
  const [jobStartAt, setJobStartAt] = useState(() => {
    const start = new Date()
    start.setMinutes(0, 0, 0)
    return toLocalDateTimeInput(start)
  })
  const [jobEndAt, setJobEndAt] = useState(() => {
    const end = new Date()
    end.setHours(end.getHours() + 1, 0, 0, 0)
    return toLocalDateTimeInput(end)
  })
  const parsedJobStartAt = useMemo(() => {
    const date = new Date(jobStartAt)
    return Number.isNaN(date.getTime()) ? null : date
  }, [jobStartAt])
  const parsedJobEndAt = useMemo(() => {
    const date = new Date(jobEndAt)
    return Number.isNaN(date.getTime()) ? null : date
  }, [jobEndAt])
  const generatedWorkDays = useMemo(
    () => generateWorkDays(parsedJobStartAt, parsedJobEndAt),
    [parsedJobEndAt, parsedJobStartAt],
  )

  useEffect(() => {
    if (generatedWorkDays.length === 0) {
      setSelectedWorkDates([])
      setJobCreationMode('single')
      return
    }

    const validDateKeys = new Set(generatedWorkDays.map((day) => day.dateKey))
    setSelectedWorkDates((current) => {
      const keptDates = current.filter((dateKey) => validDateKeys.has(dateKey))
      return keptDates.length > 0 ? keptDates : generatedWorkDays.map((day) => day.dateKey)
    })
  }, [generatedWorkDays])

  const createJobDisabledReason = useMemo(() => {
    if (!companyId) return 'Nabídka nemá dostupné company_id.'
    return undefined
  }, [companyId])

  const sendOfferDisabledReason = useMemo(() => {
    if (!shareUrl) return 'Pro odeslání nabídky chybí sdílený odkaz.'
    return undefined
  }, [shareUrl])

  async function handleCopyLink() {
    if (!shareUrl || copying) return

    try {
      setCopying(true)
      await navigator.clipboard.writeText(shareUrl)
      alert('Odkaz na online nabídku je zkopírovaný.')
    } catch {
      alert('Nepodařilo se zkopírovat odkaz. Zkuste ho prosím zkopírovat ručně.')
    } finally {
      setCopying(false)
    }
  }

  async function handleDelete() {
    if (deleting) return

    const confirmed = window.confirm('Opravdu chcete smazat tuto cenovou nabídku?')
    if (!confirmed) return

    setDeleting(true)

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError) {
        throw new Error(sessionError.message)
      }

      if (!session) {
        throw new Error('Nejste přihlášen. Obnovte prosím stránku a zkuste to znovu.')
      }

      const { data: deletedRows, error } = await supabase
        .from('quotes')
        .delete()
        .eq('id', quoteId)
        .select('id')

      if (error) {
        throw new Error(error.message)
      }

      if (!deletedRows || deletedRows.length === 0) {
        throw new Error(
          'Cenová nabídka se v databázi nesmazala. Nejdřív prosím ověřte, že je v Supabase spuštěný SQL skript pro mazání nabídek a jejich položek.',
        )
      }

      router.replace(`/customers/${customerId}/quotes`)
      router.refresh()
      window.location.assign(`/customers/${customerId}/quotes`)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Nepodařilo se smazat cenovou nabídku.')
      setDeleting(false)
    }
  }

  async function handleSyncPricing() {
    if (!sourceCalculationId || syncingPricing) return

    setSyncingPricing(true)

    try {
      const [{ data: calculation, error: calculationError }, { data: calculationItems, error: calculationItemsError }] =
        await Promise.all([
          supabase
            .from('calculations')
            .select('subtotal_price, total_price')
            .eq('id', sourceCalculationId)
            .maybeSingle(),
          supabase
            .from('calculation_items')
            .select('sort_order, name, description, quantity, unit, unit_price, vat_rate, total_price, note')
            .eq('calculation_id', sourceCalculationId)
            .eq('item_type', 'customer')
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true }),
        ])

      if (calculationError || !calculation) {
        throw new Error(calculationError?.message ?? 'Nepodarilo se nacist zdrojovou kalkulaci.')
      }

      if (calculationItemsError) {
        throw new Error(calculationItemsError.message)
      }

      const customerItems = (calculationItems ?? []).filter((item) => item.name?.trim())
      if (customerItems.length === 0) {
        throw new Error('Zdrojova kalkulace nema zadne zakaznicke polozky pro aktualizaci nabidky.')
      }

      const { error: deleteItemsError } = await supabase
        .from('quote_items')
        .delete()
        .eq('quote_id', quoteId)

      if (deleteItemsError) {
        throw new Error(deleteItemsError.message)
      }

      const quoteItemsPayload = customerItems.map((item) => ({
        company_id: companyId,
        quote_id: quoteId,
        sort_order: item.sort_order ?? 0,
        name: item.name,
        description: item.description ?? null,
        quantity: Number(item.quantity ?? 0),
        unit: item.unit ?? null,
        unit_price: Number(item.unit_price ?? 0),
        vat_rate: Number(item.vat_rate ?? 0),
        total_price: Number(item.total_price ?? 0),
        note: item.note ?? null,
      }))

      const { error: insertItemsError } = await supabase
        .from('quote_items')
        .insert(quoteItemsPayload)

      if (insertItemsError) {
        throw new Error(insertItemsError.message)
      }

      const subtotalPrice = Number(calculation.subtotal_price ?? calculation.total_price ?? 0)
      const totalPrice = Math.max(0, subtotalPrice - Number(discountAmount ?? 0))

      const { error: updateQuoteError } = await supabase
        .from('quotes')
        .update({
          subtotal_price: subtotalPrice,
          total_price: totalPrice,
        })
        .eq('id', quoteId)

      if (updateQuoteError) {
        throw new Error(updateQuoteError.message)
      }

      alert('Cenova kalkulace v nabidce byla aktualizovana podle posledni verze kalkulace.')
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Nepodarilo se aktualizovat cenovou kalkulaci.')
    } finally {
      setSyncingPricing(false)
    }
  }

  async function handleSendUpdatedOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sendingUpdate) return

    if (!shareUrl) {
      alert('Pro odeslání nabídky chybí sdílený odkaz.')
      return
    }

    const trimmedEmail = offerRecipientEmail.trim().toLowerCase()
    const trimmedSubject = offerSubject.trim()
    const trimmedMessage = offerMessage.trim()

    if (!trimmedEmail || !trimmedSubject || !trimmedMessage) {
      alert('Vyplňte prosím e-mail příjemce, předmět i zprávu.')
      return
    }

    setSendingUpdate(true)

    try {
      const response = await fetch('/api/mail/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          relatedEntityType: 'offer',
          relatedEntityId: quoteId,
          customerId,
          messageType: 'quote_update',
          toEmail: trimmedEmail,
          toName: offerRecipientName.trim() || null,
          subject: trimmedSubject,
          text: trimmedMessage,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(
            trimmedMessage,
          )}</div>`,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Nepodařilo se odeslat aktualizovanou nabídku.')
      }

      const nextStatus =
        currentStatus === 'accepted' || currentStatus === 'rejected' ? currentStatus : 'sent'

      const { error: updateError } = await supabase
        .from('quotes')
        .update({
          sent_at: new Date().toISOString(),
          status: nextStatus,
        })
        .eq('id', quoteId)

      if (updateError) {
        throw new Error(updateError.message)
      }

      window.dispatchEvent(
        new CustomEvent('diriqo:email-feed-refresh', {
          detail: {
            entityType: 'offer',
            entityId: quoteId,
            subject: trimmedSubject,
            email: trimmedEmail,
            preview: trimmedMessage,
          },
        }),
      )

      setShowSendOfferModal(false)
      alert('Aktualizovaná nabídka byla odeslaná z Hubu.')
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Nepodařilo se odeslat aktualizovanou nabídku.')
    } finally {
      setSendingUpdate(false)
    }
  }

  async function handleRejectQuote() {
    if (rejecting) return

    const confirmed = window.confirm('Opravdu chcete tuto cenovou nabídku označit jako "Nemá zájem"?')
    if (!confirmed) return

    setRejecting(true)

    try {
      const { error } = await supabase
        .from('quotes')
        .update({
          status: 'rejected',
          rejected_at: new Date().toISOString(),
        })
        .eq('id', quoteId)

      if (error) {
        throw new Error(error.message)
      }

      alert('Nabídka byla označená jako "Nemá zájem".')
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Nepodařilo se změnit stav nabídky.')
    } finally {
      setRejecting(false)
    }
  }

  function toggleWorkDate(dateKey: string) {
    setSelectedWorkDates((current) =>
      current.includes(dateKey)
        ? current.filter((item) => item !== dateKey)
        : [...current, dateKey].sort(),
    )
  }

  async function handleCreateJobFromQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creatingJob) return

    if (!companyId) {
      alert('Chybí company_id nabídky, zakázku teď nelze bezpečně vytvořit.')
      return
    }

    if (sendJobConfirmation && !contactEmail) {
      alert('Pro odeslání potvrzení zákazníkovi chybí kontaktní e-mail. Vypněte odeslání nebo doplňte e-mail v nabídce.')
      return
    }

    const parsedStartAt = new Date(jobStartAt)
    const parsedEndAt = new Date(jobEndAt)

    if (Number.isNaN(parsedStartAt.getTime()) || Number.isNaN(parsedEndAt.getTime())) {
      alert('Vyplňte prosím platný začátek a konec realizace.')
      return
    }

    if (parsedEndAt <= parsedStartAt) {
      alert('Konec realizace musí být později než začátek.')
      return
    }

    const shouldSplitIntoDailyJobs = jobCreationMode === 'split' && generatedWorkDays.length > 1
    const selectedDailyJobs = generatedWorkDays.filter((day) => selectedWorkDates.includes(day.dateKey))

    if (jobCreationMode === 'split' && generatedWorkDays.length <= 1) {
      alert('Rozpis na jednotlivé dny je dostupný až u vícedenní zakázky.')
      return
    }

    if (shouldSplitIntoDailyJobs && selectedDailyJobs.length === 0) {
      alert('Vyberte alespoň jeden den, pro který se má vytvořit dílčí zakázka.')
      return
    }

    setCreatingJob(true)

    try {
      const baseJobValues = {
        company_id: companyId,
        customer_id: customerId,
        title: quoteTitle?.trim() || 'Zakázka z cenové nabídky',
        description: jobDescription.trim() || null,
        address: jobAddress.trim() || null,
        status: 'planned',
        is_paid: false,
      }

      const { data: insertedJobs, error: insertError } = shouldSplitIntoDailyJobs
        ? await (async () => {
            const { data: parentJob, error: parentError } = await supabase
              .from('jobs')
              .insert({
                ...baseJobValues,
                price: totalPrice != null ? Number(totalPrice) : null,
                start_at: parsedStartAt.toISOString(),
                end_at: parsedEndAt.toISOString(),
                parent_job_id: null,
              })
              .select('id, parent_job_id')
              .single()

            if (parentError || !parentJob) {
              return { data: null, error: parentError }
            }

            const childJobsToInsert = selectedDailyJobs.map((day) => ({
              ...baseJobValues,
              title: `${quoteTitle?.trim() || 'Zakázka z cenové nabídky'} - ${day.label}`,
              price: null,
              start_at: day.startAt.toISOString(),
              end_at: day.endAt.toISOString(),
              parent_job_id: parentJob.id,
            }))

            const { data: childJobs, error: childError } = await supabase
              .from('jobs')
              .insert(childJobsToInsert)
              .select('id, parent_job_id')

            if (childError || !childJobs) {
              return { data: null, error: childError }
            }

            return { data: [parentJob, ...childJobs], error: null }
          })()
        : await supabase
            .from('jobs')
            .insert({
              ...baseJobValues,
              price: totalPrice != null ? Number(totalPrice) : null,
              start_at: parsedStartAt.toISOString(),
              end_at: parsedEndAt.toISOString(),
              parent_job_id: null,
            })
            .select('id, parent_job_id')

      if (insertError || !insertedJobs || insertedJobs.length === 0) {
        throw new Error(insertError?.message ?? 'Zakázku se nepodařilo vytvořit.')
      }

      const createdJobId = insertedJobs[0].id
      const acceptedAt = new Date().toISOString()
      const { error: updateQuoteError } = await supabase
        .from('quotes')
        .update({
          status: 'accepted',
          accepted_at: acceptedAt,
        })
        .eq('id', quoteId)

      if (updateQuoteError) {
        throw new Error(updateQuoteError.message)
      }

      const formatter = new Intl.DateTimeFormat('cs-CZ', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })

      const scheduleMessage = `Dobrý den${contactName ? ` ${contactName}` : ''},

potvrzujeme termín realizace k Vaší cenové nabídce.

Název zakázky:
${quoteTitle || 'Zakázka z cenové nabídky'}

Začátek realizace:
${formatter.format(parsedStartAt)}

Konec realizace:
${formatter.format(parsedEndAt)}
${jobAddress.trim() ? `\nMísto realizace:\n${jobAddress.trim()}\n` : '\n'}${
        shareUrl ? `\nOnline nabídka:\n${shareUrl}\n` : ''
      }
Pokud budete potřebovat něco doplnit, dejte nám prosím vědět.

S pozdravem
Diriqo`

      if (sendJobConfirmation) {
        const scheduleEmailResponse = await fetch('/api/mail/send', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            relatedEntityType: 'job',
            relatedEntityId: createdJobId,
            customerId,
            messageType: 'job_confirmation',
            toEmail: contactEmail,
            toName: contactName ?? null,
            subject: `Potvrzení termínu realizace: ${quoteTitle || 'Diriqo'}`,
            text: scheduleMessage,
            html: buildHtmlMessage(scheduleMessage),
          }),
        })

        const scheduleEmailPayload = (await scheduleEmailResponse.json().catch(() => null)) as { error?: string } | null

        if (!scheduleEmailResponse.ok) {
          throw new Error(scheduleEmailPayload?.error ?? 'Potvrzovací email k zakázce se nepodařilo odeslat.')
        }
      }

      setShowCreateJobModal(false)
      router.refresh()
      window.location.assign(`/jobs/${createdJobId}`)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Nepodařilo se vytvořit zakázku z nabídky.')
    } finally {
      setCreatingJob(false)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <Link
        href={`/customers/${customerId}/quotes/${quoteId}/edit`}
        style={{
          display: 'inline-block',
          backgroundColor: '#000000',
          color: '#ffffff',
          textDecoration: 'none',
          fontWeight: '700',
          fontSize: '14px',
          padding: '10px 14px',
          borderRadius: '12px',
          whiteSpace: 'nowrap',
        }}
      >
        Upravit nabídku
      </Link>

      {shareUrl ? (
        <a
          href={shareUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-block',
            backgroundColor: '#eff6ff',
            color: '#1d4ed8',
            textDecoration: 'none',
            fontWeight: '700',
            fontSize: '14px',
            padding: '10px 14px',
            borderRadius: '12px',
            border: '1px solid #bfdbfe',
            whiteSpace: 'nowrap',
          }}
        >
          Otevřít online nabídku
        </a>
      ) : null}

      {shareUrl ? (
        <button type="button" onClick={handleCopyLink} disabled={copying} style={buttonStyle('#ffffff', '#111827', '1px solid #d1d5db', copying)}>
          {copying ? 'Kopíruji...' : 'Kopírovat odkaz'}
        </button>
      ) : null}

      <a
        href={`/api/quotes/${quoteId}/pdf`}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'inline-block',
          backgroundColor: '#ffffff',
          color: '#111827',
          textDecoration: 'none',
          fontWeight: '700',
          fontSize: '14px',
          padding: '10px 14px',
          borderRadius: '12px',
          border: '1px solid #d1d5db',
          whiteSpace: 'nowrap',
        }}
      >
        Stáhnout PDF
      </a>

      <button
        type="button"
        onClick={handleSyncPricing}
        disabled={!sourceCalculationId || syncingPricing}
        title={
          sourceCalculationId
            ? undefined
            : 'Tato nabídka nemá navázanou zdrojovou kalkulaci.'
        }
        style={buttonStyle('#eff6ff', '#1d4ed8', '1px solid #bfdbfe', !sourceCalculationId || syncingPricing)}
      >
        {syncingPricing ? 'Aktualizuji kalkulaci...' : 'Aktualizovat cenovou kalkulaci'}
      </button>

      <button
        type="button"
        onClick={() => setShowCreateJobModal(true)}
        disabled={Boolean(createJobDisabledReason)}
        title={createJobDisabledReason}
        style={buttonStyle('#eef2ff', '#4338ca', '1px solid #c7d2fe', Boolean(createJobDisabledReason))}
      >
        Vytvořit zakázku z nabídky
      </button>

      <button
        type="button"
        onClick={() => setShowSendOfferModal(true)}
        disabled={Boolean(sendOfferDisabledReason) || sendingUpdate}
        title={
          sendOfferDisabledReason
            ? sendOfferDisabledReason
            : undefined
        }
        style={buttonStyle('#ecfdf5', '#166534', '1px solid #bbf7d0', Boolean(sendOfferDisabledReason) || sendingUpdate)}
      >
        {sendingUpdate ? 'Odesílám...' : 'Odeslat aktualizovanou nabídku'}
      </button>

      <button
        type="button"
        onClick={handleRejectQuote}
        disabled={rejecting}
        style={buttonStyle('#fef2f2', '#991b1b', '1px solid #fecaca', rejecting)}
      >
        {rejecting ? 'Ukládám...' : 'Nemá zájem'}
      </button>

      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        style={buttonStyle('#fef2f2', '#991b1b', '1px solid #fecaca', deleting)}
      >
        {deleting ? 'Mažu...' : 'Smazat nabídku'}
      </button>
      </div>

      {showSendOfferModal ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 1000,
          }}
        >
          <form
            onSubmit={handleSendUpdatedOffer}
            style={{
              width: '100%',
              maxWidth: '720px',
              borderRadius: '18px',
              backgroundColor: '#ffffff',
              padding: '24px',
              boxShadow: '0 24px 64px rgba(15, 23, 42, 0.18)',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '24px' }}>Odeslat aktualizovanou nabídku</h3>
              <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>
                Email se odešle serverově z Hubu a odpověď se pak bude párovat přímo k této nabídce.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gap: '12px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>E-mail příjemce</span>
                <input
                  type="email"
                  value={offerRecipientEmail}
                  onChange={(event) => setOfferRecipientEmail(event.target.value)}
                  placeholder="zakaznik@firma.cz"
                  required
                  style={{
                    border: '1px solid #d1d5db',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    fontSize: '14px',
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Jméno příjemce</span>
                <input
                  type="text"
                  value={offerRecipientName}
                  onChange={(event) => setOfferRecipientName(event.target.value)}
                  placeholder="Jméno kontaktu"
                  style={{
                    border: '1px solid #d1d5db',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    fontSize: '14px',
                  }}
                />
              </label>
            </div>

            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Předmět</span>
              <input
                type="text"
                value={offerSubject}
                onChange={(event) => setOfferSubject(event.target.value)}
                required
                style={{
                  border: '1px solid #d1d5db',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  fontSize: '14px',
                }}
              />
            </label>

            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Zpráva</span>
              <textarea
                value={offerMessage}
                onChange={(event) => setOfferMessage(event.target.value)}
                rows={9}
                required
                style={{
                  border: '1px solid #d1d5db',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  fontSize: '14px',
                  resize: 'vertical',
                }}
              />
            </label>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ color: '#64748b', fontSize: '14px' }}>
                Odkaz na nabídku: {shareUrl ? shareUrl : 'není dostupný'}
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setShowSendOfferModal(false)}
                  disabled={sendingUpdate}
                  style={buttonStyle('#ffffff', '#111827', '1px solid #d1d5db', sendingUpdate)}
                >
                  Zavřít
                </button>
                <button
                  type="submit"
                  disabled={sendingUpdate}
                  style={buttonStyle('#111827', '#ffffff', '1px solid #111827', sendingUpdate)}
                >
                  {sendingUpdate ? 'Odesílám...' : 'Odeslat nabídku'}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {showCreateJobModal ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 1000,
          }}
        >
          <form
            onSubmit={handleCreateJobFromQuote}
            style={{
              width: '100%',
              maxWidth: '620px',
              maxHeight: 'calc(100vh - 48px)',
              borderRadius: '18px',
              backgroundColor: '#ffffff',
              boxShadow: '0 24px 64px rgba(15, 23, 42, 0.18)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '22px 24px 14px', borderBottom: '1px solid #e5e7eb' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '24px' }}>Vytvořit zakázku z nabídky</h3>
              <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>
                Založíme zakázku se stejným zákazníkem. Můžete ji vytvořit interně bez odeslání, nebo rovnou poslat potvrzení zákazníkovi.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gap: '14px',
                padding: '18px 24px',
                overflowY: 'auto',
                maxHeight: 'calc(100vh - 220px)',
              }}
            >
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Začátek realizace</span>
              <input
                type="datetime-local"
                value={jobStartAt}
                onChange={(event) => setJobStartAt(event.target.value)}
                required
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #d1d5db' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Konec realizace</span>
              <input
                type="datetime-local"
                value={jobEndAt}
                onChange={(event) => setJobEndAt(event.target.value)}
                required
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #d1d5db' }}
              />
            </label>

            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ fontWeight: 600 }}>Způsob vytvoření</div>
              <label
                style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '12px',
                  backgroundColor: jobCreationMode === 'single' ? '#f8fafc' : '#ffffff',
                }}
              >
                <input
                  type="radio"
                  name="jobCreationMode"
                  value="single"
                  checked={jobCreationMode === 'single'}
                  onChange={() => setJobCreationMode('single')}
                />
                <span>
                  <strong>Jedna zakázka</strong>
                  <span style={{ display: 'block', color: '#64748b', fontSize: '13px', marginTop: '3px' }}>
                    Vytvoří se jedna zakázka v celém vybraném rozsahu.
                  </span>
                </span>
              </label>

              <label
                style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '12px',
                  backgroundColor: jobCreationMode === 'split' ? '#eef2ff' : '#ffffff',
                  opacity: generatedWorkDays.length > 1 ? 1 : 0.65,
                }}
              >
                <input
                  type="radio"
                  name="jobCreationMode"
                  value="split"
                  checked={jobCreationMode === 'split'}
                  disabled={generatedWorkDays.length <= 1}
                  onChange={() => setJobCreationMode('split')}
                />
                <span>
                  <strong>Rozepsat na jednotlivé dny</strong>
                  <span style={{ display: 'block', color: '#64748b', fontSize: '13px', marginTop: '3px' }}>
                    Vytvoří se souhrnná zakázka a pod ní dílčí jednodenní zakázky.
                  </span>
                </span>
              </label>
            </div>

            {jobCreationMode === 'split' && generatedWorkDays.length > 1 ? (
              <div
                style={{
                  border: '1px solid #c7d2fe',
                  borderRadius: '12px',
                  padding: '12px',
                  backgroundColor: '#eef2ff',
                  display: 'grid',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Dny realizace</div>
                    <div style={{ color: '#64748b', fontSize: '13px', marginTop: '3px' }}>
                      Vybrané dny se vytvoří jako dílčí zakázky.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setSelectedWorkDates(generatedWorkDays.map((day) => day.dateKey))}
                      style={buttonStyle('#ffffff', '#111827', '1px solid #d1d5db', false)}
                    >
                      Vybrat vše
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedWorkDates([])}
                      style={buttonStyle('#ffffff', '#111827', '1px solid #d1d5db', false)}
                    >
                      Zrušit výběr
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '8px' }}>
                  {generatedWorkDays.map((day) => (
                    <label
                      key={day.dateKey}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px',
                        borderRadius: '10px',
                        backgroundColor: selectedWorkDates.includes(day.dateKey) ? '#ffffff' : '#f8fafc',
                        border: '1px solid #dbeafe',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedWorkDates.includes(day.dateKey)}
                        onChange={() => toggleWorkDate(day.dateKey)}
                      />
                      <span style={{ display: 'grid', gap: '2px' }}>
                        <strong>{day.label}</strong>
                        <span style={{ color: '#64748b', fontSize: '13px' }}>
                          {toLocalDateTimeInput(day.startAt).replace('T', ' ')} - {toLocalDateTimeInput(day.endAt).replace('T', ' ')}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Adresa realizace</span>
              <input
                type="text"
                value={jobAddress}
                onChange={(event) => setJobAddress(event.target.value)}
                placeholder="Např. Vídeňská 12, Brno"
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #d1d5db' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Popis zakázky</span>
              <textarea
                value={jobDescription}
                onChange={(event) => setJobDescription(event.target.value)}
                rows={5}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #d1d5db' }}
              />
            </label>

            <div style={{ color: '#475569', fontSize: '14px' }}>
              E-mail zákazníka: <strong style={{ color: '#111827' }}>{contactEmail || '—'}</strong>
            </div>

            <label
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                padding: '12px',
                border: '1px solid #d1d5db',
                borderRadius: '12px',
                backgroundColor: '#f8fafc',
              }}
            >
              <input
                type="checkbox"
                checked={sendJobConfirmation}
                onChange={(event) => setSendJobConfirmation(event.target.checked)}
              />
              <span>
                <strong>Odeslat zákazníkovi potvrzení termínu</strong>
                <span style={{ display: 'block', color: '#64748b', fontSize: '13px', marginTop: '3px' }}>
                  Když vypnete, zakázka se vytvoří jen interně a zákazníkovi se nic nepošle.
                </span>
              </span>
            </label>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                flexWrap: 'wrap',
                padding: '14px 24px 20px',
                borderTop: '1px solid #e5e7eb',
                backgroundColor: '#ffffff',
              }}
            >
              <button type="button" onClick={() => setShowCreateJobModal(false)} disabled={creatingJob} style={buttonStyle('#ffffff', '#111827', '1px solid #d1d5db', creatingJob)}>
                Zrušit
              </button>
              <button type="submit" disabled={creatingJob} style={buttonStyle('#111827', '#ffffff', '1px solid #111827', creatingJob)}>
                {creatingJob
                  ? 'Vytvářím zakázku...'
                  : sendJobConfirmation
                    ? 'Vytvořit zakázku a odeslat potvrzení'
                    : 'Vytvořit zakázku bez odeslání'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
