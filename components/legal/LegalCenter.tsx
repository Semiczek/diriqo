import Link from 'next/link'

import LegalAcceptanceActions from '@/components/legal/LegalAcceptanceActions'
import type { LegalVersionSnapshot } from '@/lib/legal'
import type { LegalDocumentDefinition, LegalDocumentType } from '@/lib/legal-documents'

type Props = {
  documents: LegalDocumentDefinition[]
  activeType: LegalDocumentType
  versions: LegalVersionSnapshot[]
  basePath: '/legal' | '/settings/legal'
  mode: 'public' | 'settings'
  pending?: LegalVersionSnapshot[]
  storageAvailable?: boolean
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('cs-CZ')
}

export default function LegalCenter({
  documents,
  activeType,
  versions,
  basePath,
  mode,
  pending = [],
  storageAvailable = true,
}: Props) {
  const activeDocument = documents.find((document) => document.type === activeType) ?? documents[0]
  const versionMap = new Map(versions.map((version) => [version.type, version]))
  const activeVersion = versionMap.get(activeDocument.type)

  return (
    <main className={mode === 'settings' ? 'legal-page legal-page-in-app' : 'legal-page'}>
      <style>{legalStyles}</style>

      <section className="legal-hero">
        <div>
          <p className="legal-eyebrow">Diriqo Legal & Compliance</p>
          <h1>{mode === 'settings' ? 'Legal centrum' : 'Právní dokumenty Diriqo'}</h1>
          <p>
            Přehled právních dokumentů, verzí, bezpečnostních informací a GDPR rámce pro profesionální SaaS provoz.
          </p>
        </div>
        <div className="legal-hero-metrics" aria-label="Legal metadata">
          <div>
            <span>Aktivní verze</span>
            <strong>{activeVersion?.version ?? activeDocument.version}</strong>
          </div>
          <div>
            <span>Publikováno</span>
            <strong>{formatDate(activeVersion?.publishedAt ?? activeDocument.publishedAt)}</strong>
          </div>
          <div>
            <span>Audit souhlasů</span>
            <strong>{mode === 'settings' ? 'Zapnuto' : 'In-app'}</strong>
          </div>
        </div>
      </section>

      <section className="legal-layout">
        <aside className="legal-nav" aria-label="Legal navigation">
          {documents.map((document) => {
            const version = versionMap.get(document.type)
            const isActive = document.type === activeDocument.type

            return (
              <Link
                key={document.type}
                href={`${basePath}?doc=${document.type}`}
                className={isActive ? 'is-active' : ''}
              >
                <span>{document.shortTitle}</span>
                <small>v{version?.version ?? document.version}</small>
              </Link>
            )
          })}
        </aside>

        <article className="legal-document">
          <header>
            <p>{activeDocument.summary}</p>
            <h2>{activeDocument.title}</h2>
            <div className="legal-document-meta">
              <span>Typ: {activeDocument.type}</span>
              <span>Verze: {activeVersion?.version ?? activeDocument.version}</span>
              <span>Publikováno: {formatDate(activeVersion?.publishedAt ?? activeDocument.publishedAt)}</span>
            </div>
          </header>

          <div className="legal-sections">
            {activeDocument.sections.map((section) => (
              <section key={section.id} id={section.id}>
                <h3>{section.title}</h3>
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets?.length ? (
                  <ul>
                    {section.bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </article>
      </section>

      <section className="legal-versions">
        <div>
          <p className="legal-eyebrow">Versioning</p>
          <h2>Verze dokumentů</h2>
        </div>
        <div className="legal-version-grid">
          {documents.map((document) => {
            const version = versionMap.get(document.type)
            const isPending = pending.some((item) => item.type === document.type)

            return (
              <div key={document.type} className={isPending ? 'legal-version-card is-pending' : 'legal-version-card'}>
                <span>{document.shortTitle}</span>
                <strong>{version?.version ?? document.version}</strong>
                <small>{formatDate(version?.publishedAt ?? document.publishedAt)}</small>
                {document.requiresAcceptance ? <em>{isPending ? 'Čeká na souhlas' : 'Vyžaduje souhlas'}</em> : <em>Informativní</em>}
              </div>
            )
          })}
        </div>
      </section>

      {mode === 'settings' ? (
        <section className="legal-acceptance-section">
          <LegalAcceptanceActions
            pending={pending.map((document) => ({
              type: document.type,
              title: document.title,
              version: document.version,
            }))}
            storageAvailable={storageAvailable}
          />
        </section>
      ) : null}
    </main>
  )
}

const legalStyles = `
  .legal-page {
    min-height: 100vh;
    background: #f8fafc;
    color: #0f172a;
    padding: 28px;
  }

  .legal-page-in-app {
    min-height: auto;
    padding: 0;
    background: transparent;
  }

  .legal-hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
    gap: 24px;
    align-items: end;
    padding: 28px 0 22px;
  }

  .legal-eyebrow {
    margin: 0 0 8px;
    color: #2563eb;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .legal-hero h1,
  .legal-versions h2,
  .legal-consent-panel h2 {
    margin: 0;
    color: #0f172a;
    letter-spacing: 0;
  }

  .legal-hero h1 {
    font-size: clamp(34px, 4.2vw, 58px);
    line-height: 1;
  }

  .legal-hero p {
    max-width: 780px;
    margin: 14px 0 0;
    color: #475569;
    font-size: 17px;
    line-height: 1.7;
    font-weight: 650;
  }

  .legal-hero-metrics {
    display: grid;
    gap: 8px;
  }

  .legal-hero-metrics div,
  .legal-version-card,
  .legal-consent-panel,
  .legal-status {
    border: 1px solid rgba(203, 213, 225, 0.86);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.88);
    box-shadow: 0 14px 32px rgba(15, 23, 42, 0.05);
  }

  .legal-hero-metrics div {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    padding: 12px 14px;
  }

  .legal-hero-metrics span,
  .legal-version-card span,
  .legal-version-card small,
  .legal-document-meta {
    color: #64748b;
    font-size: 12px;
    font-weight: 850;
  }

  .legal-layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 22px;
    align-items: start;
  }

  .legal-nav {
    position: sticky;
    top: 18px;
    display: grid;
    gap: 8px;
  }

  .legal-nav a {
    min-height: 54px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.78);
    color: #334155;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 13px;
    text-decoration: none;
    font-weight: 900;
  }

  .legal-nav a.is-active {
    border-color: rgba(37, 99, 235, 0.36);
    background: #eef5ff;
    color: #1d4ed8;
    box-shadow: 0 14px 30px rgba(37, 99, 235, 0.12);
  }

  .legal-nav small {
    color: #64748b;
    font-weight: 850;
  }

  .legal-document {
    border: 1px solid rgba(203, 213, 225, 0.86);
    border-radius: 8px;
    background: #ffffff;
    box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
    padding: clamp(20px, 3vw, 34px);
  }

  .legal-document header {
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 20px;
    margin-bottom: 10px;
  }

  .legal-document header p {
    margin: 0 0 12px;
    color: #475569;
    font-size: 15px;
    line-height: 1.7;
    font-weight: 700;
  }

  .legal-document h2 {
    margin: 0;
    font-size: clamp(26px, 3vw, 38px);
    line-height: 1.1;
  }

  .legal-document-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }

  .legal-document-meta span {
    border: 1px solid #dbeafe;
    border-radius: 8px;
    background: #eff6ff;
    padding: 6px 9px;
    color: #1e3a8a;
  }

  .legal-sections {
    display: grid;
    gap: 4px;
  }

  .legal-sections section {
    padding: 22px 0;
    border-bottom: 1px solid #e2e8f0;
  }

  .legal-sections section:last-child {
    border-bottom: 0;
  }

  .legal-sections h3 {
    margin: 0 0 10px;
    font-size: 21px;
    line-height: 1.25;
  }

  .legal-sections p,
  .legal-sections li {
    color: #334155;
    font-size: 15px;
    line-height: 1.75;
    font-weight: 600;
  }

  .legal-sections p {
    margin: 0 0 10px;
  }

  .legal-sections ul {
    margin: 10px 0 0;
    padding-left: 20px;
  }

  .legal-versions,
  .legal-acceptance-section {
    margin-top: 22px;
  }

  .legal-version-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 10px;
    margin-top: 12px;
  }

  .legal-version-card {
    display: grid;
    gap: 6px;
    padding: 15px;
  }

  .legal-version-card strong {
    font-size: 21px;
  }

  .legal-version-card em {
    color: #0f766e;
    font-size: 12px;
    font-style: normal;
    font-weight: 900;
  }

  .legal-version-card.is-pending {
    border-color: #fbbf24;
    background: #fffbeb;
  }

  .legal-status {
    padding: 14px 16px;
    font-weight: 800;
  }

  .legal-status-ok {
    border-color: #bbf7d0;
    background: #f0fdf4;
    color: #166534;
  }

  .legal-status-warning {
    border-color: #fde68a;
    background: #fffbeb;
    color: #92400e;
  }

  .legal-status-error {
    border-color: #fecaca;
    background: #fef2f2;
    color: #991b1b;
  }

  .legal-consent-panel {
    display: grid;
    gap: 12px;
    padding: 18px;
  }

  .legal-consent-panel p {
    margin: 8px 0 0;
    color: #475569;
    line-height: 1.6;
    font-weight: 650;
  }

  .legal-consent-panel button {
    justify-self: start;
    min-height: 44px;
    border: 0;
    border-radius: 8px;
    background: #0f172a;
    color: #ffffff;
    padding: 0 16px;
    font-weight: 900;
    cursor: pointer;
  }

  .legal-consent-panel button:disabled {
    opacity: 0.68;
    cursor: wait;
  }

  @media (max-width: 860px) {
    .legal-page {
      padding: 18px;
    }

    .legal-page-in-app {
      padding: 0;
    }

    .legal-hero,
    .legal-layout {
      grid-template-columns: 1fr;
    }

    .legal-nav {
      position: static;
      grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
    }
  }

  @media (prefers-color-scheme: dark) {
    .legal-page:not(.legal-page-in-app) {
      background: #070b18;
      color: #f8fafc;
    }

    .legal-page:not(.legal-page-in-app) .legal-document,
    .legal-page:not(.legal-page-in-app) .legal-nav a,
    .legal-page:not(.legal-page-in-app) .legal-version-card,
    .legal-page:not(.legal-page-in-app) .legal-hero-metrics div {
      background: rgba(15, 23, 42, 0.92);
      border-color: rgba(148, 163, 184, 0.24);
      color: #f8fafc;
    }

    .legal-page:not(.legal-page-in-app) .legal-hero h1,
    .legal-page:not(.legal-page-in-app) .legal-versions h2,
    .legal-page:not(.legal-page-in-app) .legal-document h2,
    .legal-page:not(.legal-page-in-app) .legal-sections h3 {
      color: #f8fafc;
    }

    .legal-page:not(.legal-page-in-app) .legal-hero p,
    .legal-page:not(.legal-page-in-app) .legal-document header p,
    .legal-page:not(.legal-page-in-app) .legal-sections p,
    .legal-page:not(.legal-page-in-app) .legal-sections li {
      color: #cbd5e1;
    }
  }
`
