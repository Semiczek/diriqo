export function parseMailboxAddress(value: string | null | undefined) {
  const raw = (value ?? '').trim()
  if (!raw) {
    return {
      email: '',
      name: null as string | null,
    }
  }

  const angleMatch = raw.match(/^(.*)<([^>]+)>$/)
  if (angleMatch) {
    return {
      name: angleMatch[1]?.trim().replace(/^"|"$/g, '') || null,
      email: angleMatch[2]?.trim().toLowerCase() || '',
    }
  }

  return {
    email: raw.toLowerCase(),
    name: null as string | null,
  }
}
