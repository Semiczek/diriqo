import { selectExistingCompany } from './select-company'

type Props = {
  companies: { companyId: string; companyName: string | null }[]
  title: string
  description: string
  unnamedCompany: string
  error: string | null
}

export default function CompanySelectionRecovery({ companies, title, description, unnamedCompany, error }: Props) {
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 28 }}>{title}</h1>
      <p style={{ color: '#64748b', lineHeight: 1.6 }}>{description}</p>
      {error ? <p role="alert" style={{ color: '#b91c1c' }}>{error}</p> : null}
      <form action={selectExistingCompany} style={{ display: 'grid', gap: 12 }}>
        {companies.map(company => (
          <button key={company.companyId} type="submit" name="companyId" value={company.companyId}
            style={{ minHeight: 48, padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: 8,
              background: '#fff', color: '#111827', font: 'inherit', fontWeight: 700, textAlign: 'left', cursor: 'pointer' }}>
            {company.companyName || unnamedCompany}
          </button>
        ))}
      </form>
    </div>
  )
}
