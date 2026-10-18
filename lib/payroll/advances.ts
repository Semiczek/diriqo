/** Amounts are accumulated as integer cents; a request is never a second payment. */
export type AdvancePayment = {
  id: string
  company_id: string
  profile_id: string
  advance_request_id: string | null
  amount: number | string
  issued_at: string
  payroll_month: string
  paid_at: string
  note: string | null
  payment_method?: 'cash' | 'bank_transfer'
  payment_reference?: string | null
  currency?: string | null
  operation_id?: string | null
}

export type AdvanceSettlement = {
  id: string; company_id: string; profile_id: string; worker_advance_id: string
  amount: number | string; method: 'returned' | 'payroll_offset'; reference: string
  settled_on: string; created_at: string
  currency?: string | null; operation_id?: string
}

export function advanceAmountCents(value: unknown): number {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim().replace(',', '.') : ''
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) throw new Error('Zadejte kladnou částku nejvýše se dvěma desetinnými místy.')
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 999999999999) throw new Error('Zadejte platnou kladnou částku.')
  return cents
}

export function advanceAmount(value: unknown): string {
  const cents = advanceAmountCents(value)
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

export function sumAdvancePayments(rows: ReadonlyArray<Pick<AdvancePayment, 'id' | 'amount'>>): number {
  const seen = new Set<string>()
  let cents = 0
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) throw new Error('Přehled výplat obsahuje neplatný nebo duplicitní záznam.')
    seen.add(row.id)
    cents += advanceAmountCents(row.amount)
  }
  if (!Number.isSafeInteger(cents)) throw new Error('Součet výplat nelze bezpečně vyčíslit.')
  return cents / 100
}

export function advanceBalance(approvedAmount: number | string, payments: ReadonlyArray<Pick<AdvancePayment, 'id' | 'amount'>>) {
  const approved = advanceAmountCents(approvedAmount)
  const paid = Math.round(sumAdvancePayments(payments) * 100)
  if (paid > approved) throw new Error('Výplaty překračují schválenou částku. Kontaktujte správce.')
  return { approved: approved / 100, paid: paid / 100, remaining: (approved - paid) / 100 }
}

/** A return reduces the advance still counted against pay. A payroll offset
 * confirms that same deduction; it is not a second deduction or a return. */
export function payrollAdvanceTotal(
  payments: ReadonlyArray<Pick<AdvancePayment, 'id' | 'amount'>>,
  settlements: ReadonlyArray<Pick<AdvanceSettlement, 'id' | 'worker_advance_id' | 'amount' | 'method'>>,
): number {
  const paidCents = Math.round(sumAdvancePayments(payments) * 100)
  let returnedCents = 0
  const seen = new Set<string>()
  for (const payment of payments) {
    const entries = settlements.filter(entry => entry.worker_advance_id === payment.id)
    const settledCents = Math.round(sumAdvancePayments(entries) * 100)
    if (settledCents > advanceAmountCents(payment.amount)) throw new Error('Vypořádání překračuje výplatu zálohy.')
    for (const entry of entries) {
      if (seen.has(entry.id)) throw new Error('Duplicitní vypořádání.')
      seen.add(entry.id)
      if (entry.method === 'returned') returnedCents += advanceAmountCents(entry.amount)
    }
  }
  return (paidCents - returnedCents) / 100
}

export function formatAdvanceMoney(value: number | string, currency: string | null | undefined): string {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return `${Number(value).toLocaleString('cs-CZ')} (měna nedoložena)`
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency }).format(Number(value))
}
