import { describe, expect, it } from 'vitest'
import { parsePayday, payrollMonthRange, plannedPayday } from '../lib/payroll/payday'
import { parsePayrollSettings } from '../lib/payroll/settings-input'

const input = { payType: 'monthly', payday: '18', weekday: null, advancesEnabled: true, advanceLimitAmount: '5000', advanceFrequency: 'monthly' }

describe('company payment day', () => {
  it.each([1, 18, 28, 29, 30, 31])('plans day %i in the following month without changing the work period', (day) => {
    expect(plannedPayday('2026-03', day)).toBe(`2026-04-${String(Math.min(day, 30)).padStart(2, '0')}`)
    expect(payrollMonthRange('2026-03')).toEqual({ startDate: '2026-03-01', endExclusiveDate: '2026-04-01' })
  })
  it.each([29, 30, 31])('clips day %i in both ordinary and leap February', (day) => {
    expect(plannedPayday('2026-01', day)).toBe('2026-02-28')
    expect(plannedPayday('2028-01', day)).toBe('2028-02-29')
  })
  it('crosses the year and retains all days of the work month', () => {
    expect(plannedPayday('2026-12', 31)).toBe('2027-01-31')
    expect(payrollMonthRange('2028-02')).toEqual({ startDate: '2028-02-01', endExclusiveDate: '2028-03-01' })
  })
  it('keeps an unset schedule unset', () => {
    expect(parsePayday('')).toBeNull()
    expect(plannedPayday('2026-10', null)).toBeNull()
  })
  it.each([0, 32, 1.5, -2, '18.5', 'invalid', true, {}, Infinity])('rejects invalid payday %j', (day) => {
    expect(() => parsePayday(day)).toThrow()
  })
  it.each(['2026-00', '2026-13', '2026-1', '0999-01', '2026-02-01'])('rejects malformed month %s', (month) => {
    expect(() => payrollMonthRange(month)).toThrow()
  })
})

describe('shared payroll settings normalization', () => {
  it('updates canonical and compatibility values together', () => {
    expect(parsePayrollSettings(input)).toMatchObject({ payday_day: 18, payroll_day_of_month: 18, default_pay_type: 'monthly', payroll_type: 'monthly', advances_enabled: true, allow_advances: true })
    expect(parsePayrollSettings({ ...input, payType: 'shift', payday: null, advancesEnabled: false })).toMatchObject({ default_pay_type: 'after_shift', payroll_type: 'shift', payday_day: null, payroll_day_of_month: null, advances_enabled: false, allow_advances: false })
  })
  it('does not reset settings absent from the simpler account form', () => {
    const payload = parsePayrollSettings(input)
    expect(payload).not.toHaveProperty('advance_limit_type')
    expect(payload).not.toHaveProperty('default_hourly_rate')
    expect(payload).not.toHaveProperty('payroll_anchor_date')
    expect(parsePayrollSettings({ ...input, advanceFrequency: 'anytime' }).advance_frequency).toBe('anytime')
  })
  it.each([
    { weekday: '1.5' }, { weekday: '8' }, { advanceLimitAmount: 'bad' },
    { advanceLimitAmount: -1 }, { advanceLimitPercent: 101 }, { anchorDate: '2026-02-30' },
    { advanceFrequency: 'invalid' }, { payType: 'bad' }, { payday: '1.5' },
  ])('rejects invalid submitted settings %j without silent coercion', (patch) => {
    expect(() => parsePayrollSettings({ ...input, ...patch })).toThrow()
  })
})
