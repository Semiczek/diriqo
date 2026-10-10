'use client'

import { useRef } from 'react'
import type { CSSProperties } from 'react'
import styles from './dashboard-controls.module.css'

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
    <form ref={formRef} method="get" key={selectedMonth} className={styles.monthForm}>
      {selectedJobsDay === 'tomorrow' && <input type="hidden" name="jobs_day" value="tomorrow" />}
      <input
        key={selectedMonth}
        type="month"
        name="summary_month"
        defaultValue={selectedMonth}
        style={inputStyle}
        className={styles.monthInput}
        onChange={(event) => { if (event.target.value) formRef.current?.requestSubmit() }}
        aria-label={ariaLabel}
        title={displayLabel}
      />
    </form>
  )
}
