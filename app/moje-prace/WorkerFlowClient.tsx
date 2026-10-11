'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { uploadJobPhotoDirect, type JobPhotoUploadCategory } from '@/lib/job-photo-upload-client'
import {
  completeMyJobAction,
  startMyJobShiftAction,
  stopMyJobShiftAction,
  type WorkerActionResult,
} from './actions'

export type WorkerJobCard = {
  assignmentId: string
  jobId: string
  title: string
  address: string | null
  startAt: string | null
  endAt: string | null
  status: string | null
  assignmentStatus: string | null
  completedAt: string | null
  openShiftId: string | null
}

function formatDate(value: string | null, timeZone: string) {
  if (!value) return 'Bez termínu'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Bez termínu'
  return date.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
}

const buttonStyle = {
  border: 0,
  borderRadius: '12px',
  padding: '11px 13px',
  fontWeight: 850,
  fontSize: '14px',
  cursor: 'pointer',
} as const

export default function WorkerFlowClient({ jobs, timeZone }: { jobs: WorkerJobCard[]; timeZone: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [uploadingJobId, setUploadingJobId] = useState<string | null>(null)
  const [queuedUploads, setQueuedUploads] = useState<
    Array<{
      id: string
      jobId: string
      file: File
      photoType: JobPhotoUploadCategory
      error: string
    }>
  >([])
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({})
  const photoTypesRef = useRef<Record<string, JobPhotoUploadCategory>>({})

  function choosePhoto(jobId: string, photoType: JobPhotoUploadCategory) {
    const input = fileInputsRef.current[jobId]
    if (!input || uploadingJobId) return
    photoTypesRef.current[jobId] = photoType
    input.value = ''
    input.click()
  }

  function runJobAction(
    jobId: string,
    callback: () => Promise<WorkerActionResult<unknown>>,
    successMessage: string,
  ) {
    setError(null)
    setMessage(null)
    setActiveJobId(jobId)

    startTransition(async () => {
      try {
        const result = await callback()
        if (!result.ok) {
          setError(result.error)
          return
        }
        setMessage(successMessage)
        router.refresh()
      } catch {
        setError('Nepodařilo se potvrdit výsledek. Zkontrolujte připojení a obnovte přehled, než akci zopakujete.')
      } finally {
        setActiveJobId(null)
      }
    })
  }

  async function uploadPhoto(jobId: string, photoType: JobPhotoUploadCategory, queuedFile?: File, queuedId?: string) {
    const fileInput = fileInputsRef.current[jobId]
    const file = queuedFile ?? fileInput?.files?.[0]

    if (!file) {
      setError('Vyber fotku k nahrání.')
      return
    }

    setError(null)
    setMessage(null)
    setUploadingJobId(jobId)

    try {
      await uploadJobPhotoDirect({
        jobId,
        file,
        photoType,
      })
    } catch (uploadError) {
      const uploadMessage = uploadError instanceof Error ? uploadError.message : 'Fotku se nepodařilo nahrát.'
      setError(uploadMessage)
      setQueuedUploads((current) => {
        if (queuedId) {
          return current.map((item) => (item.id === queuedId ? { ...item, error: uploadMessage } : item))
        }

        return [
          ...current,
          {
            id: crypto.randomUUID(),
            jobId,
            file,
            photoType,
            error: uploadMessage,
          },
        ]
      })
      setUploadingJobId(null)
      return
    }

    if (fileInput) {
      fileInput.value = ''
    }

    if (queuedId) {
      setQueuedUploads((current) => current.filter((item) => item.id !== queuedId))
    }

    setMessage('Fotka je nahraná.')
    setUploadingJobId(null)
    router.refresh()
  }

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      {message ? (
        <div role="status" style={{ padding: 12, borderRadius: 12, background: '#ecfdf5', color: '#166534', fontWeight: 750 }}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div role="alert" style={{ padding: 12, borderRadius: 12, background: '#fef2f2', color: '#b91c1c', fontWeight: 750 }}>
          {error}
        </div>
      ) : null}

      {queuedUploads.length > 0 ? (
        <section style={{ padding: 14, borderRadius: 14, border: '1px solid #fed7aa', background: '#fff7ed', display: 'grid', gap: 10 }}>
          <div style={{ color: '#9a3412', fontWeight: 850 }}>Čekají fotky k odeslání</div>
          {queuedUploads.map((item) => (
            <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
              <div style={{ color: '#7c2d12', fontSize: 13 }}>
                {item.file.name} - {item.error}
              </div>
              <button
                type="button"
                disabled={Boolean(uploadingJobId)}
                onClick={() => uploadPhoto(item.jobId, item.photoType, item.file, item.id)}
                style={{ ...buttonStyle, background: '#ffedd5', color: '#9a3412', opacity: uploadingJobId === item.jobId ? 0.6 : 1 }}
              >
                Zkusit znovu
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {jobs.length === 0 ? (
        <section style={{ padding: 18, borderRadius: 16, border: '1px solid #e5e7eb', background: '#ffffff' }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Moje zakázky</h2>
          <p style={{ margin: '8px 0 0', color: '#64748b' }}>Aktuálně nemáš přiřazené žádné zakázky.</p>
        </section>
      ) : (
        jobs.map((job) => {
          const isBusy = pending && activeJobId === job.jobId
          const isUploading = uploadingJobId === job.jobId
          const isDone = Boolean(job.completedAt) || job.assignmentStatus === 'completed'

          return (
            <article
              key={job.assignmentId}
              style={{
                display: 'grid',
                gap: 12,
                padding: 16,
                borderRadius: 16,
                border: '1px solid #e5e7eb',
                background: '#ffffff',
                boxShadow: '0 10px 22px rgba(15, 23, 42, 0.05)',
              }}
            >
              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                  <h2 style={{ margin: 0, fontSize: 20, lineHeight: 1.2 }}>{job.title}</h2>
                  <span
                    style={{
                      borderRadius: 999,
                      padding: '5px 9px',
                      background: job.openShiftId ? '#dcfce7' : isDone ? '#e0f2fe' : '#f1f5f9',
                      color: job.openShiftId ? '#166534' : isDone ? '#075985' : '#475569',
                      fontSize: 12,
                      fontWeight: 850,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {job.openShiftId ? 'Běží' : isDone ? 'Hotovo' : 'Přiřazeno'}
                  </span>
                </div>
                <div style={{ color: '#64748b', fontSize: 14 }}>{formatDate(job.startAt, timeZone)}</div>
                {job.address ? <div style={{ color: '#475569', fontSize: 14 }}>{job.address}</div> : null}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                {job.openShiftId ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      runJobAction(
                        job.jobId,
                        () => stopMyJobShiftAction({ shiftId: job.openShiftId ?? '' }),
                        'Směna je ukončena.',
                      )
                    }
                    style={{ ...buttonStyle, background: '#111827', color: '#ffffff', opacity: isBusy ? 0.7 : 1 }}
                  >
                    {isBusy ? 'Ukládám...' : 'Stop'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy || isDone}
                    onClick={() =>
                      runJobAction(job.jobId, () => startMyJobShiftAction({ jobId: job.jobId }), 'Směna je spuštěna.')
                    }
                    style={{ ...buttonStyle, background: '#111827', color: '#ffffff', opacity: isBusy || isDone ? 0.55 : 1 }}
                  >
                    {isBusy ? 'Ukládám...' : 'Start'}
                  </button>
                )}

                <button
                  type="button"
                  disabled={isBusy || isDone || Boolean(job.openShiftId)}
                  onClick={() =>
                    runJobAction(job.jobId, () => completeMyJobAction({ jobId: job.jobId }), 'Zakázka je označena hotovo.')
                  }
                  style={{ ...buttonStyle, background: '#dcfce7', color: '#166534', opacity: isBusy || isDone || job.openShiftId ? 0.55 : 1 }}
                >
                  {isBusy ? 'Ukládám...' : 'Hotovo'}
                </button>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ color: '#334155', fontSize: 13, fontWeight: 850 }}>Fotka</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center' }}>
                  <input
                    ref={(node) => {
                      fileInputsRef.current[job.jobId] = node
                    }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    aria-label={`Fotografie k zakázce ${job.title}`}
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void uploadPhoto(job.jobId, photoTypesRef.current[job.jobId] ?? 'before', file)
                    }}
                  />
                  <button
                    type="button"
                    disabled={Boolean(uploadingJobId)}
                    onClick={() => choosePhoto(job.jobId, 'before')}
                    style={{ ...buttonStyle, background: '#f5f0ff', color: '#6d28d9', opacity: isUploading ? 0.6 : 1 }}
                  >
                    Fotka před
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(uploadingJobId)}
                    onClick={() => choosePhoto(job.jobId, 'after')}
                    style={{ ...buttonStyle, background: '#eff6ff', color: '#1d4ed8', opacity: isUploading ? 0.6 : 1 }}
                  >
                    Fotka po
                  </button>
                </div>
                <p style={{ margin: 0, color: '#64748b', fontSize: 12 }} aria-live="polite">{isUploading ? 'Nahrávám fotografii…' : 'Vyberte nebo vyfoťte. Fotka se rovnou uloží k zakázce.'}</p>
              </div>
            </article>
          )
        })
      )}
    </div>
  )
}
