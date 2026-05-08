'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'

type QuickNote = {
  id: string
  text: string
  done: boolean
}

type DashboardQuickNotesProps = {
  storageKey: string
}

const starterNotes: QuickNote[] = [
  { id: 'starter-call-customer', text: 'Zavolat zákazníkovi', done: false },
  { id: 'starter-check-jobs', text: 'Zkontrolovat dnešní zakázky', done: false },
]

export default function DashboardQuickNotes({ storageKey }: DashboardQuickNotesProps) {
  const [notes, setNotes] = useState<QuickNote[]>([])
  const [draft, setDraft] = useState('')
  const [loaded, setLoaded] = useState(false)

  const visibleNotes = useMemo(() => notes.slice(0, 6), [notes])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (!stored) {
        setNotes(starterNotes)
        return
      }

      const parsed = JSON.parse(stored) as QuickNote[]
      setNotes(Array.isArray(parsed) ? parsed : starterNotes)
    } catch {
      setNotes(starterNotes)
    } finally {
      setLoaded(true)
    }
  }, [storageKey])

  useEffect(() => {
    if (!loaded) return

    window.localStorage.setItem(storageKey, JSON.stringify(notes))
  }, [loaded, notes, storageKey])

  function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const text = draft.trim()
    if (!text) return

    setNotes((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text,
        done: false,
      },
      ...current,
    ])
    setDraft('')
  }

  function toggleNote(id: string) {
    setNotes((current) =>
      current.map((note) => (note.id === id ? { ...note, done: !note.done } : note))
    )
  }

  function deleteNote(id: string) {
    setNotes((current) => current.filter((note) => note.id !== id))
  }

  return (
    <aside style={quickNotesWrap} aria-label="Rychlá poznámka">
      <div style={quickNotesTitle}>Rychlá poznámka</div>
      <form onSubmit={addNote} style={quickNotesForm}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Napsat, co chci udělat..."
          style={quickNotesInput}
        />
        <button type="submit" style={quickNotesAddButton}>
          Přidat
        </button>
      </form>

      <div style={quickNotesList}>
        {visibleNotes.length === 0 ? (
          <div style={quickNotesEmpty}>Zatím žádná poznámka.</div>
        ) : (
          visibleNotes.map((note) => (
            <div key={note.id} style={quickNoteRow}>
              <label style={quickNoteLabel}>
                <input
                  type="checkbox"
                  checked={note.done}
                  onChange={() => toggleNote(note.id)}
                  style={quickNoteCheckbox}
                />
                <span style={note.done ? quickNoteTextDone : quickNoteText}>{note.text}</span>
              </label>
              <button
                type="button"
                onClick={() => deleteNote(note.id)}
                aria-label={`Smazat poznámku ${note.text}`}
                style={quickNoteDelete}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

const quickNotesWrap: CSSProperties = {
  justifySelf: 'end',
  alignSelf: 'stretch',
  width: '100%',
  minHeight: '100%',
  padding: '14px',
  borderRadius: '20px',
  backgroundColor: 'rgba(255, 255, 255, 0.58)',
  border: '1px solid rgba(255, 255, 255, 0.7)',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
  backdropFilter: 'blur(14px)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
}

const quickNotesTitle: CSSProperties = {
  color: '#334155',
  fontSize: '13px',
  fontWeight: 900,
  marginBottom: '9px',
}

const quickNotesForm: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: '8px',
  marginBottom: '10px',
}

const quickNotesInput: CSSProperties = {
  minWidth: 0,
  height: '34px',
  padding: '7px 10px',
  borderRadius: '12px',
  border: '1px solid rgba(148, 163, 184, 0.32)',
  backgroundColor: 'rgba(255,255,255,0.82)',
  color: '#0f172a',
  fontSize: '13px',
  fontWeight: 650,
  outline: 'none',
}

const quickNotesAddButton: CSSProperties = {
  height: '34px',
  padding: '7px 11px',
  borderRadius: '12px',
  border: 0,
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 54%, #06b6d4 100%)',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: 900,
  cursor: 'pointer',
  boxShadow: '0 10px 20px rgba(37, 99, 235, 0.16)',
}

const quickNotesList: CSSProperties = {
  display: 'grid',
  gap: '6px',
  flex: 1,
  alignContent: 'start',
  maxHeight: '154px',
  overflowY: 'auto',
  paddingRight: '2px',
}

const quickNotesEmpty: CSSProperties = {
  padding: '8px 0',
  color: '#64748b',
  fontSize: '13px',
}

const quickNoteRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: '8px',
  minHeight: '30px',
}

const quickNoteLabel: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  minWidth: 0,
  color: '#0f172a',
  fontSize: '13px',
  fontWeight: 750,
}

const quickNoteCheckbox: CSSProperties = {
  width: '15px',
  height: '15px',
  flexShrink: 0,
  accentColor: '#2563eb',
}

const quickNoteText: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const quickNoteTextDone: CSSProperties = {
  ...quickNoteText,
  color: '#94a3b8',
  textDecoration: 'line-through',
}

const quickNoteDelete: CSSProperties = {
  width: '24px',
  height: '24px',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  backgroundColor: 'rgba(255,255,255,0.62)',
  color: '#64748b',
  fontSize: '16px',
  lineHeight: 1,
  fontWeight: 800,
  cursor: 'pointer',
}
