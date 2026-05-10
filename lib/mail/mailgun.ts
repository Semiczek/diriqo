import 'server-only'

export type SendMailgunMessageInput = {
  from: string
  to: string
  subject: string
  text?: string | null
  html?: string | null
  replyTo?: string | null
  messageId?: string | null
  inReplyTo?: string | null
  references?: string | null
}

export type SendMailgunMessageResult = {
  id: string | null
  message: string | null
}

function getMailgunApiKey() {
  const apiKey = process.env.MAILGUN_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('MAILGUN_API_KEY is not configured.')
  }

  return apiKey
}

function getMailgunDomain() {
  const domain = process.env.MAILGUN_DOMAIN?.trim()
  if (!domain) {
    throw new Error('MAILGUN_DOMAIN is not configured.')
  }

  return domain
}

function getMailgunApiBase() {
  return process.env.MAILGUN_API_BASE?.trim().replace(/\/$/, '') || 'https://api.mailgun.net'
}

function appendOptional(formData: FormData, key: string, value: string | null | undefined) {
  const normalized = value?.trim()
  if (normalized) {
    formData.append(key, normalized)
  }
}

export async function sendMailgunMessage(input: SendMailgunMessageInput): Promise<SendMailgunMessageResult> {
  const formData = new FormData()

  formData.append('from', input.from)
  formData.append('to', input.to)
  formData.append('subject', input.subject)
  appendOptional(formData, 'text', input.text)
  appendOptional(formData, 'html', input.html)
  appendOptional(formData, 'h:Reply-To', input.replyTo)
  appendOptional(formData, 'h:Message-ID', input.messageId)
  appendOptional(formData, 'h:In-Reply-To', input.inReplyTo)
  appendOptional(formData, 'h:References', input.references)

  const response = await fetch(`${getMailgunApiBase()}/v3/${getMailgunDomain()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${getMailgunApiKey()}`).toString('base64')}`,
    },
    body: formData,
  })
  const payload = (await response.json().catch(() => null)) as {
    id?: string
    message?: string
  } | null

  if (!response.ok) {
    throw new Error(payload?.message || `Mailgun request failed with status ${response.status}.`)
  }

  return {
    id: payload?.id ?? null,
    message: payload?.message ?? null,
  }
}
