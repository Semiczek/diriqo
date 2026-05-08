'use client'

export default function OfferAccordion({
  title,
  sectionKey,
  content,
  tone = 'default',
  isOpen,
  onToggle,
  registerSectionRef,
}: {
  title: string
  sectionKey: string
  content: string
  tone?: 'default' | 'highlight'
  isOpen: boolean
  onToggle: (sectionKey: string) => void
  registerSectionRef: (sectionKey: string, element: HTMLElement | null) => void
}) {
  const accentStyles =
    tone === 'highlight'
      ? {
          border: '1px solid rgba(217, 70, 239, 0.24)',
          headerBackground: 'linear-gradient(135deg, #fdf4ff, #ecfeff)',
          labelColor: '#7c3aed',
        }
      : {
          border: '1px solid rgba(191, 219, 254, 0.95)',
          headerBackground: 'linear-gradient(135deg, #ffffff, #f8fbff)',
          labelColor: '#2563eb',
        }

  return (
    <section
      ref={(element) => {
        registerSectionRef(sectionKey, element)
      }}
      data-section-key={sectionKey}
      style={{
        borderRadius: '24px',
        border: accentStyles.border,
        backgroundColor: '#ffffff',
        boxShadow: '0 16px 44px rgba(15, 23, 42, 0.07)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => onToggle(sectionKey)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          padding: '20px 24px',
          border: 'none',
          background: accentStyles.headerBackground,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '24px', fontWeight: 900, color: '#08111f' }}>{title}</span>
        <span style={{ color: accentStyles.labelColor, fontWeight: 700 }}>{isOpen ? 'Sbalit' : 'Rozbalit'}</span>
      </button>

      {isOpen ? (
        <div style={{ padding: '0 22px 22px', color: '#334155', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{content}</div>
      ) : null}
    </section>
  )
}
