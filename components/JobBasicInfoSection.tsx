'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useI18n } from '@/components/I18nProvider'
import {
  cardTitleStyle,
  metaItemStyle,
  metaLabelStyle,
  metaValueStyle,
  secondaryButtonStyle,
  sectionCardStyle,
} from '@/components/SaasPageLayout'

type JobBasicInfoSectionProps = {
  jobId: string
  status: string | null
  price: number | null
  address: string | null
  startAt: string | null | undefined
  endAt: string | null | undefined
  totalHours: number
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
  }).format(value)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function JobBasicInfoSection({
  jobId,
  status,
  price,
  address,
  startAt,
  endAt,
  totalHours,
}: JobBasicInfoSectionProps) {
  const { dictionary } = useI18n()
  const t = dictionary.jobs
  const detail = dictionary.jobs.detail

  const cardStyle: CSSProperties = {
    ...metaItemStyle,
  }

  const labelStyle: CSSProperties = {
    ...metaLabelStyle,
  }

  const valueStyle: CSSProperties = {
    ...metaValueStyle,
  }

  return (
    <section
      style={sectionCardStyle}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '20px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2
            style={{
              ...cardTitleStyle,
              fontSize: '24px',
              margin: 0,
            }}
          >
            {detail.jobStatus}
          </h2>
          <p
            style={{
              margin: '8px 0 0 0',
              color: '#6b7280',
              fontSize: '14px',
            }}
          >
            {detail.billingInfo}
          </p>
        </div>

        <Link
          href={`/jobs/${jobId}/edit`}
          style={{
            ...secondaryButtonStyle,
          }}
        >
          {detail.editJob}
        </Link>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px',
        }}
      >
        <div style={cardStyle}>
          <div style={labelStyle}>{detail.workState}</div>
          <div style={valueStyle}>{status ?? '-'}</div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>{t.price}</div>
          <div style={valueStyle}>{price != null ? formatCurrency(Number(price)) : '-'}</div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>{t.addressLabel}</div>
          <div style={valueStyle}>{address ?? '-'}</div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>{t.startLabel}</div>
          <div style={valueStyle}>{formatDateTime(startAt)}</div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>{t.endLabel}</div>
          <div style={valueStyle}>{formatDateTime(endAt)}</div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>{detail.hours}</div>
          <div style={valueStyle}>{totalHours}</div>
        </div>
      </div>
    </section>
  )
}
