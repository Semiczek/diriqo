export type CompanyCountryConfig = {
  countryCode: string
  countryName: string
  defaultLanguage: string
  defaultCurrency: string
  registrationNumberLabel: string
  taxNumberLabel: string
  registrationNumberPlaceholder?: string
  taxNumberPlaceholder?: string
}

export const fallbackCompanyCountryConfig: CompanyCountryConfig = {
  countryCode: 'ZZ',
  countryName: 'Other',
  defaultLanguage: 'en',
  defaultCurrency: 'EUR',
  registrationNumberLabel: 'Business registration number',
  taxNumberLabel: 'Tax/VAT number',
}

export const companyCountryConfigs = [
  {
    countryCode: 'CZ',
    countryName: 'Czech Republic',
    defaultLanguage: 'cs',
    defaultCurrency: 'CZK',
    registrationNumberLabel: 'IČO',
    taxNumberLabel: 'DIČ',
    registrationNumberPlaceholder: '12345678',
    taxNumberPlaceholder: 'CZ12345678',
  },
  {
    countryCode: 'SK',
    countryName: 'Slovakia',
    defaultLanguage: 'sk',
    defaultCurrency: 'EUR',
    registrationNumberLabel: 'IČO',
    taxNumberLabel: 'IČ DPH',
    registrationNumberPlaceholder: '12345678',
    taxNumberPlaceholder: 'SK1234567890',
  },
  {
    countryCode: 'DE',
    countryName: 'Germany',
    defaultLanguage: 'de',
    defaultCurrency: 'EUR',
    registrationNumberLabel: 'Handelsregisternummer',
    taxNumberLabel: 'USt-IdNr.',
    registrationNumberPlaceholder: 'HRB 123456',
    taxNumberPlaceholder: 'DE123456789',
  },
  {
    countryCode: 'AT',
    countryName: 'Austria',
    defaultLanguage: 'de',
    defaultCurrency: 'EUR',
    registrationNumberLabel: 'Firmenbuchnummer',
    taxNumberLabel: 'UID-Nummer',
    registrationNumberPlaceholder: 'FN 123456a',
    taxNumberPlaceholder: 'ATU12345678',
  },
  {
    countryCode: 'PL',
    countryName: 'Poland',
    defaultLanguage: 'pl',
    defaultCurrency: 'PLN',
    registrationNumberLabel: 'REGON / KRS',
    taxNumberLabel: 'NIP',
    registrationNumberPlaceholder: '123456789',
    taxNumberPlaceholder: 'PL1234567890',
  },
  {
    countryCode: 'HU',
    countryName: 'Hungary',
    defaultLanguage: 'hu',
    defaultCurrency: 'HUF',
    registrationNumberLabel: 'Cégjegyzékszám',
    taxNumberLabel: 'Adószám',
    registrationNumberPlaceholder: '01-09-123456',
    taxNumberPlaceholder: 'HU12345678',
  },
  {
    countryCode: 'FR',
    countryName: 'France',
    defaultLanguage: 'fr',
    defaultCurrency: 'EUR',
    registrationNumberLabel: 'SIREN / SIRET',
    taxNumberLabel: 'TVA intracommunautaire',
    registrationNumberPlaceholder: '123 456 789',
    taxNumberPlaceholder: 'FR12345678901',
  },
  {
    countryCode: 'IT',
    countryName: 'Italy',
    defaultLanguage: 'it',
    defaultCurrency: 'EUR',
    registrationNumberLabel: 'Numero REA',
    taxNumberLabel: 'Partita IVA',
    registrationNumberPlaceholder: 'RM-123456',
    taxNumberPlaceholder: 'IT12345678901',
  },
  {
    countryCode: 'ES',
    countryName: 'Spain',
    defaultLanguage: 'es',
    defaultCurrency: 'EUR',
    registrationNumberLabel: 'NIF / CIF',
    taxNumberLabel: 'NIF / IVA',
    registrationNumberPlaceholder: 'B12345678',
    taxNumberPlaceholder: 'ESB12345678',
  },
  {
    countryCode: 'PT',
    countryName: 'Portugal',
    defaultLanguage: 'pt',
    defaultCurrency: 'EUR',
    registrationNumberLabel: 'NIPC',
    taxNumberLabel: 'NIF',
    registrationNumberPlaceholder: '123456789',
    taxNumberPlaceholder: 'PT123456789',
  },
  {
    countryCode: 'NL',
    countryName: 'Netherlands',
    defaultLanguage: 'nl',
    defaultCurrency: 'EUR',
    registrationNumberLabel: 'KvK nummer',
    taxNumberLabel: 'BTW-nummer',
    registrationNumberPlaceholder: '12345678',
    taxNumberPlaceholder: 'NL123456789B01',
  },
  {
    countryCode: 'BE',
    countryName: 'Belgium',
    defaultLanguage: 'nl',
    defaultCurrency: 'EUR',
    registrationNumberLabel: 'Ondernemingsnummer',
    taxNumberLabel: 'BTW-nummer',
    registrationNumberPlaceholder: '0123.456.789',
    taxNumberPlaceholder: 'BE0123456789',
  },
  {
    countryCode: 'IE',
    countryName: 'Ireland',
    defaultLanguage: 'en',
    defaultCurrency: 'EUR',
    registrationNumberLabel: 'CRO number',
    taxNumberLabel: 'VAT number',
    registrationNumberPlaceholder: '123456',
    taxNumberPlaceholder: 'IE1234567A',
  },
  {
    countryCode: 'DK',
    countryName: 'Denmark',
    defaultLanguage: 'da',
    defaultCurrency: 'DKK',
    registrationNumberLabel: 'CVR number',
    taxNumberLabel: 'VAT number',
    registrationNumberPlaceholder: '12345678',
    taxNumberPlaceholder: 'DK12345678',
  },
  {
    countryCode: 'SE',
    countryName: 'Sweden',
    defaultLanguage: 'sv',
    defaultCurrency: 'SEK',
    registrationNumberLabel: 'Organisationsnummer',
    taxNumberLabel: 'VAT number',
    registrationNumberPlaceholder: '556123-4567',
    taxNumberPlaceholder: 'SE123456789001',
  },
  {
    countryCode: 'FI',
    countryName: 'Finland',
    defaultLanguage: 'fi',
    defaultCurrency: 'EUR',
    registrationNumberLabel: 'Business ID',
    taxNumberLabel: 'VAT number',
    registrationNumberPlaceholder: '1234567-8',
    taxNumberPlaceholder: 'FI12345678',
  },
  {
    countryCode: 'NO',
    countryName: 'Norway',
    defaultLanguage: 'no',
    defaultCurrency: 'NOK',
    registrationNumberLabel: 'Organisasjonsnummer',
    taxNumberLabel: 'VAT number',
    registrationNumberPlaceholder: '123456789',
    taxNumberPlaceholder: 'NO123456789MVA',
  },
  {
    countryCode: 'UK',
    countryName: 'United Kingdom',
    defaultLanguage: 'en',
    defaultCurrency: 'GBP',
    registrationNumberLabel: 'Company number',
    taxNumberLabel: 'VAT number',
    registrationNumberPlaceholder: '12345678',
    taxNumberPlaceholder: 'GB123456789',
  },
  {
    countryCode: 'US',
    countryName: 'United States',
    defaultLanguage: 'en',
    defaultCurrency: 'USD',
    registrationNumberLabel: 'EIN',
    taxNumberLabel: 'Tax ID',
    registrationNumberPlaceholder: '12-3456789',
    taxNumberPlaceholder: '12-3456789',
  },
  {
    countryCode: 'CA',
    countryName: 'Canada',
    defaultLanguage: 'en',
    defaultCurrency: 'CAD',
    registrationNumberLabel: 'Business Number',
    taxNumberLabel: 'GST/HST number',
    registrationNumberPlaceholder: '123456789',
    taxNumberPlaceholder: '123456789RT0001',
  },
  {
    countryCode: 'MX',
    countryName: 'Mexico',
    defaultLanguage: 'es',
    defaultCurrency: 'MXN',
    registrationNumberLabel: 'RFC',
    taxNumberLabel: 'RFC',
    registrationNumberPlaceholder: 'ABC123456XYZ',
    taxNumberPlaceholder: 'ABC123456XYZ',
  },
  {
    countryCode: 'AU',
    countryName: 'Australia',
    defaultLanguage: 'en',
    defaultCurrency: 'AUD',
    registrationNumberLabel: 'ABN',
    taxNumberLabel: 'GST number',
    registrationNumberPlaceholder: '12 345 678 901',
  },
  {
    countryCode: 'NZ',
    countryName: 'New Zealand',
    defaultLanguage: 'en',
    defaultCurrency: 'NZD',
    registrationNumberLabel: 'NZBN',
    taxNumberLabel: 'GST number',
    registrationNumberPlaceholder: '9429000000000',
  },
  {
    countryCode: 'BR',
    countryName: 'Brazil',
    defaultLanguage: 'pt',
    defaultCurrency: 'BRL',
    registrationNumberLabel: 'CNPJ',
    taxNumberLabel: 'CNPJ',
    registrationNumberPlaceholder: '12.345.678/0001-90',
  },
  {
    countryCode: 'IN',
    countryName: 'India',
    defaultLanguage: 'en',
    defaultCurrency: 'INR',
    registrationNumberLabel: 'CIN / Udyam number',
    taxNumberLabel: 'GSTIN',
    registrationNumberPlaceholder: 'U12345MH2020PTC123456',
    taxNumberPlaceholder: '22AAAAA0000A1Z5',
  },
  {
    countryCode: 'ZA',
    countryName: 'South Africa',
    defaultLanguage: 'en',
    defaultCurrency: 'ZAR',
    registrationNumberLabel: 'Company registration number',
    taxNumberLabel: 'VAT number',
    registrationNumberPlaceholder: '2020/123456/07',
  },
  {
    countryCode: 'SG',
    countryName: 'Singapore',
    defaultLanguage: 'en',
    defaultCurrency: 'SGD',
    registrationNumberLabel: 'UEN',
    taxNumberLabel: 'GST registration number',
    registrationNumberPlaceholder: '201912345A',
  },
  {
    countryCode: 'AE',
    countryName: 'United Arab Emirates',
    defaultLanguage: 'en',
    defaultCurrency: 'AED',
    registrationNumberLabel: 'Trade license number',
    taxNumberLabel: 'TRN',
    registrationNumberPlaceholder: '123456',
    taxNumberPlaceholder: '100123456700003',
  },
  {
    countryCode: 'CH',
    countryName: 'Switzerland',
    defaultLanguage: 'de',
    defaultCurrency: 'CHF',
    registrationNumberLabel: 'UID',
    taxNumberLabel: 'VAT number',
    registrationNumberPlaceholder: 'CHE-123.456.789',
    taxNumberPlaceholder: 'CHE-123.456.789 MWST',
  },
  {
    countryCode: 'JP',
    countryName: 'Japan',
    defaultLanguage: 'en',
    defaultCurrency: 'JPY',
    registrationNumberLabel: 'Corporate number',
    taxNumberLabel: 'Consumption tax number',
    registrationNumberPlaceholder: '1234567890123',
  },
  {
    countryCode: 'KR',
    countryName: 'South Korea',
    defaultLanguage: 'en',
    defaultCurrency: 'KRW',
    registrationNumberLabel: 'Business registration number',
    taxNumberLabel: 'VAT number',
    registrationNumberPlaceholder: '123-45-67890',
  },
] satisfies CompanyCountryConfig[]

const configByCountryCode = new Map(
  companyCountryConfigs.map((config) => [config.countryCode, config] as const),
)

export const companyCountryOptions = [
  ...companyCountryConfigs.map((config) => ({
    value: config.countryCode,
    label: config.countryName,
  })),
  {
    value: fallbackCompanyCountryConfig.countryCode,
    label: fallbackCompanyCountryConfig.countryName,
  },
]

export const companyLanguageOptions = Array.from(
  new Set(['cs', 'en', 'de', ...companyCountryConfigs.map((config) => config.defaultLanguage)]),
)

export const companyCurrencyOptions = Array.from(
  new Set(['CZK', 'EUR', 'USD', ...companyCountryConfigs.map((config) => config.defaultCurrency)]),
)

function normalizeCountryCode(countryCode: string | null | undefined) {
  return countryCode?.trim().toUpperCase() || fallbackCompanyCountryConfig.countryCode
}

export function getCompanyCountryConfig(countryCode: string | null | undefined): CompanyCountryConfig {
  const normalized = normalizeCountryCode(countryCode)
  return configByCountryCode.get(normalized) ?? {
    ...fallbackCompanyCountryConfig,
    countryCode: normalized,
  }
}

export function getRegistrationNumberLabel(countryCode: string | null | undefined) {
  return getCompanyCountryConfig(countryCode).registrationNumberLabel
}

export function getTaxNumberLabel(countryCode: string | null | undefined) {
  return getCompanyCountryConfig(countryCode).taxNumberLabel
}

export function getDefaultCurrencyForCountry(countryCode: string | null | undefined) {
  return getCompanyCountryConfig(countryCode).defaultCurrency
}

export function getDefaultLanguageForCountry(countryCode: string | null | undefined) {
  return getCompanyCountryConfig(countryCode).defaultLanguage
}
