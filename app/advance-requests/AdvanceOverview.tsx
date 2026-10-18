import type { AdvanceRequest } from '@/lib/dal/worker-advances'
import { advanceBalance, formatAdvanceMoney, sumAdvancePayments, type AdvancePayment, type AdvanceSettlement } from '@/lib/payroll/advances'
import { AdvancePaymentForm, AdvanceReviewForm, AdvanceSettlementForm } from './AdvanceForms'
import styles from './advances.module.css'

export default function AdvanceOverview(props: {
  companyId: string; actorProfileId: string; today: string; admin: boolean; currency: string
  requests: AdvanceRequest[]; payments: AdvancePayment[]; settlements: AdvanceSettlement[]
}) {
  return <div className={styles.page}>
    {props.requests.length === 0 && <p>Zatím zde nejsou žádné žádosti o zálohu.</p>}
    {props.requests.map(request => {
      const payments = props.payments.filter(p => p.advance_request_id === request.id)
      const paid = sumAdvancePayments(payments)
      const ids = new Set(payments.map(p => p.id))
      const settled = sumAdvancePayments(props.settlements.filter(s => ids.has(s.worker_advance_id)))
      const approved = ['approved', 'paid'].includes(request.status) ? Number(request.amount) : 0
      const remaining = approved > 0 ? advanceBalance(approved, payments).remaining : 0
      const money = (value: number | string) => formatAdvanceMoney(value, request.currency)
      const label = request.status === 'rejected' ? 'Zamítnuto' : request.status === 'pending' ? 'Čeká na rozhodnutí'
        : remaining === 0 ? 'Vyplaceno' : paid > 0 ? 'Částečně vyplaceno' : 'Schváleno · nevyplaceno'
      return <article key={request.id} className={styles.card}>
        <header><span className={styles.badge}>{label}</span><h2>{props.admin ? request.worker_name : 'Žádost o zálohu'}</h2>
          <p>Podáno {new Date(request.requested_at).toLocaleDateString('cs-CZ')} · {request.reason || request.note || 'Bez poznámky'}</p></header>
        <dl className={styles.summary}>
          <div><dt>Požadováno</dt><dd>{request.requested_amount == null ? 'Původní částka není doložená' : money(request.requested_amount)}</dd></div>
          <div><dt>Schváleno</dt><dd>{money(approved)}</dd></div>
          <div><dt>Vyplaceno</dt><dd>{money(paid)}</dd></div>
          <div><dt>Zbývá vyplatit</dt><dd>{money(remaining)}</dd></div>
          <div><dt>Vyplaceno a nevypořádáno</dt><dd>{money(paid - settled)}</dd></div>
        </dl>
        {request.review_reason && <p>Důvod rozhodnutí: {request.review_reason}</p>}
        {props.admin && request.currency && request.requested_amount != null && request.status === 'pending' && <AdvanceReviewForm companyId={props.companyId} actorProfileId={props.actorProfileId} requestId={request.id} revision={request.revision} requestedAmount={request.requested_amount} currency={request.currency!} />}
        {props.admin && request.currency && request.status === 'approved' && remaining > 0 && <AdvancePaymentForm companyId={props.companyId} actorProfileId={props.actorProfileId} requestId={request.id} profileId={request.profile_id} revision={request.revision} remaining={remaining} today={props.today} currency={request.currency} />}
        <PaymentHistory {...props} payments={payments} />
      </article>
    })}
    {props.payments.some(p => !p.advance_request_id) && <section className={styles.card}><h2>Výplaty bez žádosti</h2><PaymentHistory {...props} payments={props.payments.filter(p => !p.advance_request_id)} /></section>}
  </div>
}

function PaymentHistory(props: { companyId: string; actorProfileId: string; today: string; admin: boolean; payments: AdvancePayment[]; settlements: AdvanceSettlement[] }) {
  if (!props.payments.length) return null
  return <section><h3>Historie výplat a vypořádání</h3><ul className={styles.history}>{props.payments.map(payment => {
    const settlements = props.settlements.filter(s => s.worker_advance_id === payment.id)
    const outstanding = advanceBalance(payment.amount, settlements).remaining
    const money = (value: number | string) => formatAdvanceMoney(value, payment.currency)
    return <li key={payment.id}>
      <strong>{money(payment.amount)}</strong> · {payment.issued_at} · {payment.payment_method === 'bank_transfer' ? 'Převod' : payment.payment_method === 'cash' ? 'Hotově' : 'Způsob nedoložen'}
      {payment.payment_reference && <span> · {payment.payment_reference}</span>}{payment.note && <p>{payment.note}</p>}
      {settlements.map(s => <p key={s.id}>{s.settled_on} · {s.method === 'returned' ? 'Vráceno' : 'Započteno'} {money(s.amount)} · {s.reference}</p>)}
      {props.admin && payment.currency && payment.operation_id && outstanding > 0 && <details><summary>Zaznamenat vypořádání</summary><AdvanceSettlementForm companyId={props.companyId} actorProfileId={props.actorProfileId} paymentId={payment.id} outstanding={outstanding} today={props.today} currency={payment.currency} /></details>}
    </li>
  })}</ul></section>
}
