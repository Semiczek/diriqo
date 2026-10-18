import type { Operation } from '@/lib/diriqent/server'
import type { WorkResult } from '@/lib/diriqent/work'
import styles from './diriqent.module.css'

const metricLabels: Record<string, string> = {
  jobCount: 'Počet zakázek ve výběru', completedJobCount: 'Dokončené zakázky', overdueJobCount: 'Zakázky po plánovaném konci',
  ownCompletedShiftCount: 'Vlastní dokončené směny', ownHours: 'Vlastní hodiny podle evidence', contractValueByCurrency: 'Nominální hodnota zakázek podle měny',
}
function metricValue(key: string, value: unknown): string {
  if (typeof value === 'number') return value.toLocaleString('cs-CZ')
  if (key === 'contractValueByCurrency' && Array.isArray(value)) {
    return value.map(item => typeof item?.amount === 'number' && typeof item?.currency === 'string'
      ? `${item.amount.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} ${item.currency}` : 'Částka není dostupná').join('; ') || 'Žádné oceněné zakázky'
  }
  return 'Údaj není dostupný'
}
export default function WorkResultView({ operation }: { operation: Operation }) {
  const result = operation.result as WorkResult | null
  if (!result) return null
  const context = operation.context_snapshot
  return <div className={styles.stack}>
    <p className={styles.answer}>{result.answer}</p>
    {result.findings?.map((finding, index) => <div key={index}><h3>{finding.title}</h3><p className={styles.answer}>{finding.detail}</p>{finding.metricKeys.length > 0 && <small className={styles.muted}>Podklady: {finding.metricKeys.map(key => metricLabels[key] ?? key).join(', ')}</small>}</div>)}
    {result.steps?.length > 0 && <><h3>Navržené kroky · čekají na vaše posouzení</h3><ol>{result.steps.map((step, index) => <li key={index}><strong>{step.title}</strong><p className={styles.answer}>{step.detail}</p>{step.jobId && <small className={styles.muted}>Zakázka: {context?.jobs?.find(job => job.id === step.jobId)?.title ?? step.jobId}</small>}</li>)}</ol></>}
    {result.caveats?.length > 0 && <div className={styles.notice}><strong>Omezení analýzy</strong><ul>{result.caveats.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    {context?.coverage?.truncated === true && <p className={styles.notice}>Podklady překročily limit výběru. Výsledek nepokrývá celé období; pro úplnější přehled zvolte kratší interval.</p>}
    {context?.warnings?.map((warning, index) => <p className={styles.notice} key={index}>{warning}</p>)}
    <details className={styles.details}><summary>Ověřitelné podklady a rozsah výběru</summary>
      <p className={styles.muted}>{context?.scope}</p>
      <p className={styles.muted}>Období {operation.work_spec?.from} až {operation.work_spec?.to}. Stav podkladů: {context?.asOf ? new Date(context.asOf).toLocaleString('cs-CZ') : 'neuveden'}.</p>
      <dl>{Object.entries(context?.metrics ?? {}).map(([key, value]) => <div key={key}><dt>{metricLabels[key] ?? key}</dt><dd>{metricValue(key, value)}</dd></div>)}</dl>
      <p className={styles.muted}>Vyhodnoceno {typeof context?.coverage?.jobRows === 'number' ? context.coverage.jobRows : 0} zakázek se začátkem v období a {typeof context?.coverage?.shiftRows === 'number' ? context.coverage.shiftRows : 0} vlastních směn zahájených v období. Hodiny se počítají jen z dokončených směn.</p>
      <p className={styles.muted}>Výběr pro plánování: {context?.jobs?.length ?? 0} zakázek. Finanční částky různých měn se nesčítají.</p>
    </details>
  </div>
}
