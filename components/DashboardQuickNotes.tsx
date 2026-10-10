'use client'

import { useEffect, useState } from 'react'
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

export default function DashboardQuickNotes(props: DashboardQuickNotesProps) {
  // A company switch must never carry the previous company's notes into its storage key.
  return <QuickNotesContent key={props.storageKey} {...props} />
}

function QuickNotesContent({ storageKey, labels }: DashboardQuickNotesProps) {
  const [notes, setNotes] = useState<QuickNote[]>([])
  const [draft, setDraft] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (stored) {
        const parsed: unknown = JSON.parse(stored)
        if (!Array.isArray(parsed) || !parsed.every(isQuickNote)) throw new Error('Invalid notes')
        setNotes(parsed)
      }
    } catch {
      setStorageFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [storageKey])

  function updateNotes(next: QuickNote[]) {
    setNotes(next)
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next))
      setStorageFailed(false)
    } catch {
      setStorageFailed(true)
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
