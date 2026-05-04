export const DEFAULT_QUOTE_BENEFITS = [
  'Jasně definovaný rozsah podle vašeho požadavku',
  'Konkrétní popis navrženého řešení',
  'Přehledný termín a harmonogram realizace',
  'Transparentní cenová kalkulace bez zbytečných nejasností',
]

export const DEFAULT_QUOTE_BENEFITS_TEXT = DEFAULT_QUOTE_BENEFITS.join('\n')

export function getQuoteBenefits(value: string | null | undefined) {
  const parsed = (value ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[•\-]\s*/, '').trim())
    .filter(Boolean)

  return parsed.length > 0 ? parsed : DEFAULT_QUOTE_BENEFITS
}
