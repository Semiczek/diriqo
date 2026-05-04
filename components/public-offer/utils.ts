import type { CtaActionType, CtaModalState } from '@/components/public-offer/types'

export const VISITOR_ID_STORAGE_KEY = 'diriqo-offer-visitor-id'

export function formatCurrency(value: number | null | undefined) {
  if (value == null) return '—'

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

export function hasText(value: string | null | undefined) {
  return Boolean(value && value.trim())
}

export function getOrCreateVisitorId() {
  if (typeof window === 'undefined') return ''

  const existing = window.localStorage.getItem(VISITOR_ID_STORAGE_KEY)
  if (existing) return existing

  const bytes = new Uint8Array(16)
  window.crypto.getRandomValues(bytes)
  const generated = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  window.localStorage.setItem(VISITOR_ID_STORAGE_KEY, generated)
  return generated
}

export async function postOfferEvent(payload: {
  token: string
  eventType: string
  sectionKey?: string
  eventValue?: string
  visitorId?: string
}) {
  try {
    await fetch('/api/offers/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: payload.token,
        eventType: payload.eventType,
        sectionKey: payload.sectionKey ?? null,
        eventValue: payload.eventValue ?? null,
        visitorId: payload.visitorId ?? null,
        referrer: typeof document !== 'undefined' ? document.referrer || null : null,
      }),
      keepalive: true,
    })
  } catch {
    // Tracking nesmí rozbít veřejnou nabídku.
  }
}

export async function submitOfferResponse(payload: {
  token: string
  actionType: CtaActionType
  customerName: string
  customerEmail: string
  customerPhone: string
  note?: string
  visitorId?: string
  website?: string
  openedAt?: number
}) {
  const response = await fetch('/api/offers/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || 'Reakci se nepodařilo uložit.')
  }

  return data
}

export function getCtaModalState(actionType: CtaActionType): CtaModalState {
  if (actionType === 'interested') {
    return {
      actionType,
      title: 'Potvrdit zájem o nabídku',
      description:
        'Vyplňte krátký kontakt. Budeme vědět, že chcete pokračovat, a ozveme se vám co nejdříve.',
      submitLabel: 'Potvrdit zájem',
      noteLabel: 'Poznámka',
      notePlaceholder: 'Např. preferovaný termín volání nebo doplňující informace',
    }
  }

  if (actionType === 'revision_requested') {
    return {
      actionType,
      title: 'Požádat o úpravu nabídky',
      description: 'Napište nám, co potřebujete změnit. Připravíme vám upravenou variantu nabídky.',
      submitLabel: 'Odeslat požadavek',
      noteLabel: 'Co chcete upravit',
      notePlaceholder: 'Např. rozsah prací, termín, množství nebo cenovou variantu',
    }
  }

  if (actionType === 'not_interested') {
    return {
      actionType,
      title: 'Potvrdit, že o nabídku nemáte zájem',
      description:
        'Krátce nám dejte vědět, že o tuto nabídku nemáte zájem. Pokud chcete, můžete přidat i důvod.',
      submitLabel: 'Potvrdit nezájem',
      noteLabel: 'Důvod (volitelné)',
      notePlaceholder: 'Např. odloženo, jiná varianta, již neaktuální',
    }
  }

  return {
    actionType,
    title: 'Kontaktovat nás',
    description: 'Pošlete nám krátkou zprávu k nabídce. Ozveme se vám zpět.',
    submitLabel: 'Odeslat zprávu',
    noteLabel: 'Zpráva',
    notePlaceholder: 'Napište nám svůj dotaz nebo požadavek',
  }
}
