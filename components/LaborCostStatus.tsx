import Link from 'next/link'
import type { JobEconomicsSummary } from '@/lib/economics'
import type { Locale } from '@/lib/i18n/config'

const copy = {
  cs: { incomplete: 'Náklady práce nejsou úplné', provisional: 'Část práce čeká na schválení', missing: 'Hodiny bez sazby', unapproved: 'Hodiny ke schválení', legacy: 'Starší záznamy k ověření', currency: 'Náklady v jiné měně vyžadují přepočet.', detail: 'Zisk a marži zobrazíme po doplnění a schválení práce.', open: 'Otevřít pracovní výkazy' },
  en: { incomplete: 'Labour costs are incomplete', provisional: 'Some work awaits approval', missing: 'Hours without a rate', unapproved: 'Hours awaiting approval', legacy: 'Older records to review', currency: 'Costs in another currency need conversion.', detail: 'Profit and margin become available after work is priced and approved.', open: 'Open work submissions' },
  de: { incomplete: 'Arbeitskosten sind unvollständig', provisional: 'Ein Teil der Arbeit wartet auf Freigabe', missing: 'Stunden ohne Kostensatz', unapproved: 'Stunden zur Freigabe', legacy: 'Ältere Einträge zur Prüfung', currency: 'Kosten in einer anderen Währung müssen umgerechnet werden.', detail: 'Gewinn und Marge werden nach Bewertung und Freigabe angezeigt.', open: 'Arbeitsnachweise öffnen' },
}

export default function LaborCostStatus({ summary, locale = 'cs' }: {
  summary: JobEconomicsSummary | null | undefined
  locale?: Locale
}) {
  if (summary?.labor_completeness === 'complete') return null
  const t = copy[locale]
  const details = [
    summary?.missing_rate_hours ? `${t.missing}: ${summary.missing_rate_hours}` : null,
    summary?.unapproved_labor_hours ? `${t.unapproved}: ${summary.unapproved_labor_hours}` : null,
    summary?.legacy_unverified_labor_count ? `${t.legacy}: ${summary.legacy_unverified_labor_count}` : null,
  ].filter(Boolean)
  return <aside role="status" style={{ border: '1px solid var(--dq-border, #ddd8eb)', borderRadius: 12, padding: '12px 16px', background: 'var(--dq-purple-soft, #f7f4ff)', color: 'var(--dq-text, #292539)' }}>
    <strong>{summary?.labor_completeness === 'provisional' ? t.provisional : t.incomplete}</strong>
    {details.length > 0 ? <p style={{ margin: '6px 0' }}>{details.join(' · ')}</p> : null}
    {summary?.unconverted_labor_costs.length ? <p style={{ margin: '6px 0' }}>{t.currency}</p> : null}
    <p style={{ margin: '6px 0' }}>{t.detail}</p>
    <Link href={summary ? `/labor?job=${encodeURIComponent(summary.job_id)}` : '/labor'}>{t.open}</Link>
  </aside>
}
