import 'server-only'

function getMessageIdHost() {
  const appBaseUrl = process.env.APP_BASE_URL?.trim()

  if (appBaseUrl) {
    try {
      return new URL(appBaseUrl).host
    } catch {
    }
  }

  const fallbackEmail = process.env.MAILBOX_DEFAULT_FROM_EMAIL?.trim()
  if (fallbackEmail?.includes('@')) {
    return fallbackEmail.split('@')[1] ?? 'mail.diriqo.local'
  }

  return 'mail.diriqo.local'
}

export function buildInternetMessageId() {
  const host = getMessageIdHost()
  return `<diriqo-${crypto.randomUUID()}@${host}>`
}
