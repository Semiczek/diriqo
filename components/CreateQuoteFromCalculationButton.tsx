'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createQuoteFromCalculationAction } from '@/app/business-actions'
import { parseCoreQuoteCreate, parseCoreQuoteReceipt } from '@/lib/core-quote-lifecycle'
import { quoteDetailHref } from './quote-lifecycle-state'
import { useQuoteOperation } from './useQuoteOperation'
import styles from './QuoteLifecycle.module.css'

type Props = { calculationId: string; customerId: string | null; companyId: string; profileId: string; expectedCalculationRevision: string }
export default function CreateQuoteFromCalculationButton(props: Props) {
  const router = useRouter()
  const [source] = useState(props)
  const operation = useQuoteOperation({
    scope: { companyId: props.companyId, profileId: props.profileId, entityId: props.calculationId, slot: 'create' },
    parseCommand: raw => {
      const parsed = parseCoreQuoteCreate(raw)
      if (parsed.companyId !== source.companyId || parsed.profileId !== source.profileId || parsed.calculationId !== source.calculationId) throw new Error('Požadavek patří k jiné kalkulaci nebo firmě.')
      return parsed
    },
    parseReceipt: (raw, input) => parseCoreQuoteReceipt(raw, input, 'create'),
    execute: createQuoteFromCalculationAction,
    onSuccess: receipt => { router.push(quoteDetailHref(receipt.quoteId, source.customerId)); router.refresh() },
  })
  return <div className={styles.stack}>
    {operation.error ? <p role="alert" className={styles.error}>{operation.error}</p> : null}
    {operation.pending ? <p role="status" className={styles.notice}>{operation.pending.receipt ? 'Nabídka je uložená. Ověřte aktivní firmu a otevřete ji.' : 'Požadavek je uložený. Ověřte jeho výsledek; nevytváříme další nabídku.'}</p> : null}
    {operation.retryAvailable ? <button type="button" className={styles.primary} onClick={() => operation.run()}>{operation.pending?.receipt ? 'Otevřít uloženou nabídku' : 'Ověřit stejný požadavek'}</button> :
      <button type="button" className={styles.primary} disabled={operation.locked} onClick={() => operation.run({ companyId: source.companyId, profileId: source.profileId, calculationId: source.calculationId, expectedCalculationRevision: source.expectedCalculationRevision, operationId: crypto.randomUUID() })}>{operation.busy ? 'Vytvářím nabídku…' : 'Vytvořit cenovou nabídku'}</button>}
  </div>
}
