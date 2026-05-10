'use client'

import { useMemo, useState } from 'react'

import { createCompanyOnboarding } from '@/app/onboarding/actions'
import { useI18n } from '@/components/I18nProvider'
import {
  companyCountryOptions,
  companyCurrencyOptions,
  companyLanguageOptions,
  getCompanyCountryConfig,
} from '@/lib/company-country-config'
import SubmitButton from './SubmitButton'

type Props = {
  initialCountryCode: string
  hasCompanyNameError: boolean
  hasRequiredError: boolean
  hasCreateError: boolean
}

const languageLabels: Record<string, string> = {
  cs: 'Čeština',
  sk: 'Slovenčina',
  en: 'English',
  de: 'Deutsch',
  pl: 'Polski',
  hu: 'Magyar',
  fr: 'Français',
  it: 'Italiano',
  es: 'Español',
  pt: 'Português',
  nl: 'Nederlands',
  da: 'Dansk',
  sv: 'Svenska',
  fi: 'Suomi',
  no: 'Norsk',
}

export default function CompanyOnboardingForm({
  initialCountryCode,
  hasCompanyNameError,
  hasRequiredError,
  hasCreateError,
}: Props) {
  const { dictionary } = useI18n()
  const t = dictionary.auth
  const initialConfig = useMemo(() => getCompanyCountryConfig(initialCountryCode), [initialCountryCode])
  const [countryCode, setCountryCode] = useState(initialConfig.countryCode)
  const [language, setLanguage] = useState(initialConfig.defaultLanguage)
  const [currency, setCurrency] = useState(initialConfig.defaultCurrency)
  const countryConfig = getCompanyCountryConfig(countryCode)

  return (
    <form action={createCompanyOnboarding} style={formStyle}>
      <label style={fieldStyle}>
        <span style={labelStyle}>{t.companyName}</span>
        <input name="company_name" required minLength={2} placeholder="Moje firma s.r.o." style={inputStyle} />
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>{t.country}</span>
        <select
          name="country_code"
          value={countryCode}
          required
          style={inputStyle}
          onChange={(event) => {
            const nextCountryCode = event.target.value
            const nextConfig = getCompanyCountryConfig(nextCountryCode)
            setCountryCode(nextConfig.countryCode)
            setLanguage(nextConfig.defaultLanguage)
            setCurrency(nextConfig.defaultCurrency)
          }}
        >
          {companyCountryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div style={twoColumnStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>{t.language}</span>
          <select
            name="language"
            value={language}
            required
            style={inputStyle}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {companyLanguageOptions.map((option) => (
              <option key={option} value={option}>
                {languageLabels[option] ?? option.toUpperCase()}
              </option>
            ))}
          </select>
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>{t.currency}</span>
          <select
            name="currency"
            value={currency}
            required
            style={inputStyle}
            onChange={(event) => setCurrency(event.target.value)}
          >
            {companyCurrencyOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={optionalBlockStyle}>
        <strong style={optionalTitleStyle}>{t.companyDetails}</strong>
        <p style={optionalTextStyle}>{t.companyDetailsLater}</p>
      </div>

      <div style={twoColumnStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>{countryConfig.registrationNumberLabel}</span>
          <input
            name="registration_number"
            maxLength={64}
            placeholder={countryConfig.registrationNumberPlaceholder ?? ''}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>{countryConfig.taxNumberLabel}</span>
          <input name="tax_number" maxLength={64} placeholder={countryConfig.taxNumberPlaceholder ?? ''} style={inputStyle} />
        </label>
      </div>

      <label style={fieldStyle}>
        <span style={labelStyle}>{t.email}</span>
        <input name="company_email" type="email" style={inputStyle} />
      </label>

      <div style={twoColumnStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>{t.phone}</span>
          <input name="phone" style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>{t.address}</span>
          <input name="address" style={inputStyle} />
        </label>
      </div>

      {hasCompanyNameError ? <div style={errorStyle}>{t.companyNameMinLength}</div> : null}

      {hasRequiredError ? <div style={errorStyle}>{t.requiredFields}</div> : null}

      {hasCreateError ? <div style={errorStyle}>{t.companyCreateFailed}</div> : null}

      <SubmitButton />
    </form>
  )
}

const formStyle = {
  display: 'grid',
  gap: 14,
} as const

const twoColumnStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
  gap: 12,
} as const

const fieldStyle = {
  display: 'grid',
  gap: 6,
  minWidth: 0,
} as const

const labelStyle = {
  color: '#334155',
  fontSize: 13,
  fontWeight: 850,
} as const

const inputStyle = {
  minHeight: 44,
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  padding: '9px 11px',
  fontSize: 15,
  boxSizing: 'border-box',
  width: '100%',
} as const

const optionalBlockStyle = {
  borderRadius: 10,
  border: '1px solid #dbeafe',
  background: '#eff6ff',
  padding: '10px 12px',
} as const

const optionalTitleStyle = {
  display: 'block',
  color: '#1e3a8a',
  fontSize: 13,
} as const

const optionalTextStyle = {
  margin: '3px 0 0',
  color: '#475569',
  fontSize: 13,
  lineHeight: 1.45,
  fontWeight: 650,
} as const

const errorStyle = {
  borderRadius: 8,
  border: '1px solid #fecaca',
  background: '#fef2f2',
  color: '#991b1b',
  padding: '10px 12px',
  fontSize: 14,
  fontWeight: 750,
} as const
