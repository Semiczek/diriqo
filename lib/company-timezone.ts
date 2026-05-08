export const DEFAULT_COMPANY_TIME_ZONE = 'Europe/Prague'

export type CompanyTimeZoneOption = {
  value: string
  label: string
}

function fixedUtcOffsetTimeZone(offset: number) {
  if (offset === 0) return 'UTC'
  return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`
}

function formatUtcOffsetLabel(offset: number) {
  if (offset === 0) return 'UTC +0'
  return `UTC ${offset > 0 ? '+' : ''}${offset}`
}

export const COMPANY_TIME_ZONE_OPTIONS: CompanyTimeZoneOption[] = [
  { value: DEFAULT_COMPANY_TIME_ZONE, label: 'Praha / ČR (Europe/Prague)' },
  ...Array.from({ length: 25 }, (_, index) => {
    const offset = index - 12
    return {
      value: fixedUtcOffsetTimeZone(offset),
      label: formatUtcOffsetLabel(offset),
    }
  }),
]

export function resolveCompanyTimeZone(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  if (!normalized) return DEFAULT_COMPANY_TIME_ZONE

  return COMPANY_TIME_ZONE_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : DEFAULT_COMPANY_TIME_ZONE
}
