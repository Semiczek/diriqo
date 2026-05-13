import type { Locale } from '@/lib/i18n/config'

type InviteMessageParams = {
  inviteLink: string
  locale?: Locale | string | null
}

export function normalizePhoneForWhatsApp(phone: string) {
  return phone.replace(/[^\d]/g, '')
}

export function buildInviteMessage({ inviteLink, locale }: InviteMessageParams) {
  if ((locale ?? '').toLowerCase().startsWith('cs')) {
    return `Ahoj, byl/a jsi pozván/a do Diriqo.\n\nOtevři pracovní aplikaci tady:\n${inviteLink}`
  }

  return `Hi, you've been invited to Diriqo.\n\nOpen your work app here:\n${inviteLink}`
}

export function buildWhatsAppInviteUrl(phone: string, message: string) {
  const digitsOnlyPhone = normalizePhoneForWhatsApp(phone)
  return `https://wa.me/${digitsOnlyPhone}?text=${encodeURIComponent(message)}`
}

export function normalizePhoneForStorage(phone: string) {
  const trimmed = phone.trim()
  if (trimmed.startsWith('+')) {
    return `+${normalizePhoneForWhatsApp(trimmed)}`
  }

  return normalizePhoneForWhatsApp(trimmed)
}
