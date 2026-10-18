import Link from 'next/link'
import { AdvancePaymentForm } from '@/app/advance-requests/AdvanceForms'
import { formatDateKeyInTimeZone } from '@/lib/date/prague-time'
import type { WorkerAdvanceRow } from './worker-detail-helpers'
import { formatAdvanceMoney } from '@/lib/payroll/advances'
import { formatDate, tableStyle, tableWrapStyle, tdStyle, thStyle } from './worker-detail-helpers'
import { sectionCardStyle } from '@/components/SaasPageLayout'

export default function WorkerAdvancesSection(props: {
  advancePeriodLabel: string; selectedMonth: string; workerId: string; workerAdvances: WorkerAdvanceRow[]
  advancesAllowed: boolean; advanceLimitAmount: number | null; totalAdvances: number
  companyId: string; actorProfileId: string; timeZone: string; currency: string
}) {
  const formatCurrency = (value: number) => formatAdvanceMoney(value, props.currency)
  return <section style={sectionCardStyle}>
    <h2>Zálohy ({props.advancePeriodLabel})</h2>
    <p>Zálohy po doloženém vrácení {formatCurrency(props.totalAdvances)}{props.advanceLimitAmount != null ? ` · nastavený limit ${formatCurrency(props.advanceLimitAmount)}` : ''}</p>
    <p><Link href="/advance-requests">Žádosti, zbývající částky a vypořádání</Link></p>
    {props.advancesAllowed ? <AdvancePaymentForm currency={props.currency} companyId={props.companyId} actorProfileId={props.actorProfileId}
      profileId={props.workerId} requestId={null} revision={null} today={formatDateKeyInTimeZone(new Date(), props.timeZone)} />
      : <p>Nové zálohy jsou pro pracovníka vypnuté. Historie zůstává dostupná.</p>}
    <div style={tableWrapStyle}><table style={tableStyle}>
      <thead><tr><th style={thStyle}>Datum</th><th style={thStyle}>Částka</th><th style={thStyle}>Poznámka</th></tr></thead>
      <tbody>{props.workerAdvances.map(advance => <tr key={advance.id}>
        <td style={tdStyle}>{formatDate(advance.issued_at)}</td><td style={tdStyle}>{formatCurrency(Number(advance.amount))}</td><td style={tdStyle}>{advance.note || '—'}</td>
      </tr>)}</tbody>
    </table></div>
    {!props.workerAdvances.length && <p>Ve zvoleném období nejsou evidované výplaty záloh.</p>}
    <p>Záznamy výplat se nemažou. Vrácení či započtení doložte v historii vypořádání.</p>
  </section>
}
