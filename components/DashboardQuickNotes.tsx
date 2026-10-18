'use client'

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { FormEvent } from 'react'
import styles from './dashboard-controls.module.css'

type QuickNote = { id: string; text: string; done: boolean }

type DashboardQuickNotesProps = {
  storageKey: string
  labels: {
    title: string
    placeholder: string
    add: string
    empty: string
    deleteNote: string
    starterCallCustomer: string
    starterCheckJobs: string
    storageHint: string
    storageError: string
  }
}

function isQuickNote(value: unknown): value is QuickNote {
  if (!value || typeof value !== 'object') return false
  const note = value as Record<string, unknown>
  return typeof note.id === 'string' && typeof note.text === 'string' && typeof note.done === 'boolean'
}

const NOTES_CHANGED = 'diriqo-quick-notes-changed'

function subscribeToNotes(notify: () => void) {
  window.addEventListener('storage', notify)
  window.addEventListener(NOTES_CHANGED, notify)
  return () => {
    window.removeEventListener('storage', notify)
    window.removeEventListener(NOTES_CHANGED, notify)
  }
}

function getServerNotesSnapshot(): undefined {
  return undefined
}

export default function DashboardQuickNotes(props: DashboardQuickNotesProps) {
  // A company switch must never carry the previous company's notes into its storage key.
  return <QuickNotesContent key={props.storageKey} {...props} />
}

function QuickNotesContent({ storageKey, labels }: DashboardQuickNotesProps) {
  const readStoredNotes = useCallback(() => {
    try {
      return window.localStorage.getItem(storageKey)
    } catch {
      return false as const
    }
  }, [storageKey])
  const stored = useSyncExternalStore(subscribeToNotes, readStoredNotes, getServerNotesSnapshot)
  const parsed = useMemo(() => {
    try {
      if (stored === false) throw new Error('Storage unavailable')
      const value: unknown = stored ? JSON.parse(stored) : []
      if (!Array.isArray(value) || !value.every(isQuickNote)) throw new Error('Invalid notes')
      return { notes: value, failed: false }
    } catch {
      return { notes: [] as QuickNote[], failed: true }
    }
  }, [stored])
  // Keep an unsaved edit visible even when browser storage is unavailable.
  const [unsavedNotes, setUnsavedNotes] = useState<QuickNote[] | null>(null)
  const notes = unsavedNotes ?? parsed.notes
  const [draft, setDraft] = useState('')
  const loaded = stored !== undefined
  const storageFailed = parsed.failed || unsavedNotes !== null

  function updateNotes(next: QuickNote[]) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next))
      setUnsavedNotes(null)
      window.dispatchEvent(new Event(NOTES_CHANGED))
    } catch {
      setUnsavedNotes(next)
    }
  }

  function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || !loaded) return
    updateNotes([{ id: crypto.randomUUID(), text, done: false }, ...notes])
    setDraft('')
  }

  function noteText(note: QuickNote) {
    if (note.id === 'starter-call-customer') return labels.starterCallCustomer
    if (note.id === 'starter-check-jobs') return labels.starterCheckJobs
    return note.text
  }

  return (
    <section className={styles.notes} aria-label={labels.title}>
      <h2 className={styles.title}>{labels.title}</h2>
      <p className={styles.hint}>{labels.storageHint}</p>
      <form onSubmit={addNote} className={styles.form}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={labels.placeholder}
          aria-label={labels.placeholder}
          maxLength={500}
          disabled={!loaded}
          className={styles.input}
        />
        <button type="submit" disabled={!loaded || !draft.trim()} className={styles.add}>
          {labels.add}
        </button>
      </form>
      {storageFailed ? <p role="status" className={styles.error}>{labels.storageError}</p> : null}
      <div className={styles.list} aria-busy={!loaded}>
        {loaded && notes.length === 0 ? <p className={styles.empty}>{labels.empty}</p> : null}
        {notes.map((note) => (
          <div key={note.id} className={styles.noteRow}>
            <label className={styles.noteLabel}>
              <input
                type="checkbox"
                checked={note.done}
                onChange={() => updateNotes(notes.map((item) => item.id === note.id ? { ...item, done: !item.done } : item))}
              />
              <span className={note.done ? styles.done : styles.text}>{noteText(note)}</span>
            </label>
            <button
              type="button"
              onClick={() => updateNotes(notes.filter((item) => item.id !== note.id))}
              aria-label={`${labels.deleteNote}: ${noteText(note)}`}
              className={styles.delete}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
