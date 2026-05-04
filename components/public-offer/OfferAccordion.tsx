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
          border: '1px solid #fed7aa',
          headerBackground: '#fff7ed',
          labelColor: '#9a3412',
        }
      : {
          border: '1px solid #dbe4f0',
          headerBackground: '#ffffff',
          labelColor: '#475569',
        }

  return (
    <section
      ref={(element) => {
        registerSectionRef(sectionKey, element)
      }}
      data-section-key={sectionKey}
      style={{
        borderRadius: '20px',
        border: accentStyles.border,
        backgroundColor: '#ffffff',
        boxShadow: '0 12px 36px rgba(15, 23, 42, 0.05)',
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
          padding: '18px 22px',
          border: 'none',
          backgroundColor: accentStyles.headerBackground,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '24px', fontWeight: 800 }}>{title}</span>
        <span style={{ color: accentStyles.labelColor, fontWeight: 700 }}>{isOpen ? 'Sbalit' : 'Rozbalit'}</span>
      </button>

      {isOpen ? (
        <div style={{ padding: '0 22px 22px', color: '#334155', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{content}</div>
      ) : null}
    </section>
  )
}
