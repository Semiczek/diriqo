'use client'

import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'

type InvoiceOverviewFilterFormProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export default function InvoiceOverviewFilterForm({
  children,
  className,
  style,
}: InvoiceOverviewFilterFormProps) {
  const router = useRouter()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const customerId = formData.get('customerId')?.toString().trim()
    const month = formData.get('month')?.toString().trim()
    const params = new URLSearchParams()

    if (customerId) {
      params.set('customerId', customerId)
    }

    if (month) {
      params.set('month', month)
    }

    const query = params.toString()
    router.push(query ? `/invoices/new?${query}` : '/invoices/new')
  }

  return (
    <form className={className} method="get" onSubmit={handleSubmit} style={style}>
      {children}
    </form>
  )
}
