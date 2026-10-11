'use client'

import { startTransition, useActionState, useEffect, useRef, type ReactNode, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { writeFleetAction } from './actions'
import styles from './fleet.module.css'

type Props = { children: ReactNode; companyId: string; vehicleId?: string; requestId: string; operation: string; label?: string; openCreated?: boolean }

export default function FleetForm(props: Props) {
  return <FleetFormAttempt key={props.requestId} {...props} />
}

function FleetFormAttempt({ children, companyId, vehicleId, requestId, operation, label = 'Uložit', openCreated = false }: Props) {
  const [state, action, pending] = useActionState(writeFleetAction, { error: null })
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (state.success) {
      if (openCreated && state.id) router.push(`/fleet/${state.id}`)
      else router.refresh()
    }
  }, [state.success, state.id, openCreated, router])
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    for (const key of ['started_at', 'ended_at']) {
      const value = data.get(key)
      if (typeof value === 'string' && value) {
        const date = new Date(value)
        if (Number.isFinite(date.getTime())) data.set(key, date.toISOString())
      }
    }
    startTransition(() => action(data))
  }
  return <form ref={formRef} onSubmit={submit} className={styles.form}>
    <input type="hidden" name="company_id" value={companyId} />
    <input type="hidden" name="request_id" value={requestId} />
    <input type="hidden" name="operation" value={operation} />
    {vehicleId ? <input type="hidden" name="vehicle_id" value={vehicleId} /> : null}
    <fieldset disabled={pending || !!state.success}>{children}</fieldset>
    {state.error ? <p role="alert" className={styles.error}>{state.error}</p> : null}
    {state.success ? <p role="status" className={styles.success}>{state.success}</p> : null}
    <button className={styles.primary} disabled={pending || !!state.success} type="submit">{pending ? 'Ukládám…' : label}</button>
  </form>
}
