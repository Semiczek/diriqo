'use client'

import { useRef } from 'react'
import type { CSSProperties } from 'react'

type DashboardMonthPickerProps = {
  selectedMonth: string
  selectedJobsDay: 'today' | 'tomorrow'
  inputStyle: CSSProperties
  ariaLabel: string
  displayLabel: string
}

export default function DashboardMonthPicker({
  selectedMonth,
  selectedJobsDay,
  inputStyle,
  ariaLabel,
  displayLabel,
}: DashboardMonthPickerProps) {
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <form ref={formRef} method="get" key={selectedMonth} style={{ display: 'flex', alignItems: 'center' }}>
      {selectedJobsDay === 'tomorrow' && <input type="hidden" name="jobs_day" value="tomorrow" />}
      <label style={{ ...inputStyle, position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', cursor: 'pointer' }}>
        <span>{displayLabel}</span>
        <span
          aria-hidden="true"
          style={{
            width: '14px',
            height: '14px',
            border: '2px solid currentColor',
            borderRadius: '3px',
            boxSizing: 'border-box',
            opacity: 0.8,
          }}
        />
        <input
          key={selectedMonth}
          type="month"
          name="summary_month"
          defaultValue={selectedMonth}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            cursor: 'pointer',
          }}
          onChange={() => formRef.current?.requestSubmit()}
          aria-label={ariaLabel}
        />
      </label>
    </form>
  )
}
