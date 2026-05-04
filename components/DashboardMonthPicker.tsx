'use client'

import { useRef } from 'react'
import type { CSSProperties } from 'react'

type DashboardMonthPickerProps = {
  selectedMonth: string
  selectedJobsDay: 'today' | 'tomorrow'
  inputStyle: CSSProperties
}

export default function DashboardMonthPicker({
  selectedMonth,
  selectedJobsDay,
  inputStyle,
}: DashboardMonthPickerProps) {
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <form ref={formRef} method="get" key={selectedMonth} style={{ display: 'flex', alignItems: 'center' }}>
      {selectedJobsDay === 'tomorrow' && <input type="hidden" name="jobs_day" value="tomorrow" />}
      <input
        key={selectedMonth}
        type="month"
        name="summary_month"
        defaultValue={selectedMonth}
        style={inputStyle}
        onChange={() => formRef.current?.requestSubmit()}
        aria-label="Vybrat měsíc"
      />
    </form>
  )
}
