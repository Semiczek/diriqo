function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function htmlToText(value: string | null | undefined) {
  if (!value) return ''

  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export function buildPreview(textValue: string | null | undefined, htmlValue: string | null | undefined) {
  const raw = textValue?.trim() ? textValue.trim() : htmlToText(htmlValue)

  if (!raw) return ''
  return raw.length > 180 ? `${raw.slice(0, 177)}...` : raw
}

function formatSignatureTimestamp(value: Date) {
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function buildSignatureText(senderProfileId: string, senderName: string | null | undefined, sentAt: Date) {
  const senderLabel = senderName?.trim() ? `${senderName.trim()} (ID: ${senderProfileId})` : `ID: ${senderProfileId}`

  return [
    '---',
    'Odesláno z Diriqo',
    `Odesílatel: ${senderLabel}`,
    `Čas odeslání: ${formatSignatureTimestamp(sentAt)}`,
  ].join('\n')
}

function buildSignatureHtml(senderProfileId: string, senderName: string | null | undefined, sentAt: Date) {
  const senderLabel = senderName?.trim() ? `${senderName.trim()} (ID: ${senderProfileId})` : `ID: ${senderProfileId}`

  return [
    '<hr style="border:none;border-top:1px solid #d1d5db;margin:20px 0 16px;" />',
    '<div style="font-size:12px;line-height:1.6;color:#6b7280;">',
    '<div><strong>Odesláno z Diriqo</strong></div>',
    `<div>Odesílatel: ${escapeHtml(senderLabel)}</div>`,
    `<div>Čas odeslání: ${escapeHtml(formatSignatureTimestamp(sentAt))}</div>`,
    '</div>',
  ].join('')
}

export function appendHubSignature(input: {
  text: string | null | undefined
  html: string | null | undefined
  senderProfileId: string
  senderName?: string | null
  sentAt: Date
}) {
  const baseText = input.text?.trim() ?? ''
  const baseHtml = input.html?.trim() ?? ''
  const signatureText = buildSignatureText(input.senderProfileId, input.senderName, input.sentAt)
  const signatureHtml = buildSignatureHtml(input.senderProfileId, input.senderName, input.sentAt)

  return {
    text: baseText ? `${baseText}\n\n${signatureText}` : signatureText,
    html: baseHtml
      ? `${baseHtml}${signatureHtml}`
      : `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(
          signatureText,
        ).replace(/\n/g, '<br />')}</div>`,
  }
}
