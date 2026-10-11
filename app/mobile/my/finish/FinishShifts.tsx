'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { stopMyJobShiftAction } from '@/app/moje-prace/actions'
import type { OwnOpenShift } from '../../data'
import styles from '../../mobile.module.css'

export default function FinishShifts({ shifts, timeZone }: { shifts: OwnOpenShift[]; timeZone: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  function finish(shiftId: string) {
    setMessage(null); setError(null)
    startTransition(async () => {
      try {
        const result = await stopMyJobShiftAction({ shiftId })
        if (!result.ok) { setError(result.error); return }
        setMessage('Směna je ukončena.'); router.refresh()
      } catch { setError('Ukončení se nepodařilo potvrdit. Obnovte přehled a ověřte stav směny.') }
    })
  }
  return <section className={styles.section}>
    {message && <p role="status" className={styles.card}>{message}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {shifts.map(shift => <article key={shift.id} className={styles.card}>
      <span className={styles.badge}>Běžící směna</span><strong>{shift.title}</strong>
      <p>Začátek: {shift.started_at ? new Date(shift.started_at).toLocaleString('cs-CZ', { timeZone }) : 'Neuveden'}</p>
      <button className={styles.button} type="button" disabled={pending} onClick={() => finish(shift.id)}>{pending ? 'Ukládám…' : 'Ukončit směnu'}</button>
    </article>)}
  </section>
}
