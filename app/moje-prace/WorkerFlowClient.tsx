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

function formatDate(value: string | null) {
  if (!value) return 'Bez terminu'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Bez terminu'
  return date.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
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

export default function WorkerFlowClient({ jobs }: { jobs: WorkerJobCard[] }) {
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

  function runJobAction(
    jobId: string,
    callback: () => Promise<WorkerActionResult<unknown>>,
    successMessage: string,
  ) {
    setError(null)
    setMessage(null)
    setActiveJobId(jobId)

    startTransition(async () => {
      const result = await callback()

      if (!result.ok) {
        setError(result.error)
        setActiveJobId(null)
        return
      }

      setMessage(successMessage)
      setActiveJobId(null)
      router.refresh()
    })
  }

  async function uploadPhoto(jobId: string, photoType: JobPhotoUploadCategory, queuedFile?: File, queuedId?: string) {
    const fileInput = fileInputsRef.current[`${jobId}-${photoType}`]
    const file = queuedFile ?? fileInput?.files?.[0]

    if (!file) {
      setError('Vyber fotku k nahrani.')
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
      const uploadMessage = uploadError instanceof Error ? uploadError.message : 'Fotku se nepodarilo nahrat.'
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

    setMessage('Fotka je nahrana.')
    setUploadingJobId(null)
    router.refresh()
  }

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      {message ? (
        <div style={{ padding: 12, borderRadius: 12, background: '#ecfdf5', color: '#166534', fontWeight: 750 }}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div style={{ padding: 12, borderRadius: 12, background: '#fef2f2', color: '#b91c1c', fontWeight: 750 }}>
          {error}
        </div>
      ) : null}

      {queuedUploads.length > 0 ? (
        <section style={{ padding: 14, borderRadius: 14, border: '1px solid #fed7aa', background: '#fff7ed', display: 'grid', gap: 10 }}>
          <div style={{ color: '#9a3412', fontWeight: 850 }}>Cekaji fotky k odeslani</div>
          {queuedUploads.map((item) => (
            <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
              <div style={{ color: '#7c2d12', fontSize: 13 }}>
                {item.file.name} - {item.error}
              </div>
              <button
                type="button"
                disabled={uploadingJobId === item.jobId}
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
          <h2 style={{ margin: 0, fontSize: 20 }}>Moje zakazky</h2>
          <p style={{ margin: '8px 0 0', color: '#64748b' }}>Aktualne nemas prirazene zadne zakazky.</p>
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
                    {job.openShiftId ? 'Bezi' : isDone ? 'Hotovo' : 'Prirazeno'}
                  </span>
                </div>
                <div style={{ color: '#64748b', fontSize: 14 }}>{formatDate(job.startAt)}</div>
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
                        'Smena je ukoncena.',
                      )
                    }
                    style={{ ...buttonStyle, background: '#111827', color: '#ffffff', opacity: isBusy ? 0.7 : 1 }}
                  >
                    {isBusy ? 'Ukladam...' : 'Stop'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy || isDone}
                    onClick={() =>
                      runJobAction(job.jobId, () => startMyJobShiftAction({ jobId: job.jobId }), 'Smena je spustena.')
                    }
                    style={{ ...buttonStyle, background: '#111827', color: '#ffffff', opacity: isBusy || isDone ? 0.55 : 1 }}
                  >
                    {isBusy ? 'Ukladam...' : 'Start'}
                  </button>
                )}

                <button
                  type="button"
                  disabled={isBusy || isDone}
                  onClick={() =>
                    runJobAction(job.jobId, () => completeMyJobAction({ jobId: job.jobId }), 'Zakazka je oznacena hotovo.')
                  }
                  style={{ ...buttonStyle, background: '#dcfce7', color: '#166534', opacity: isBusy || isDone ? 0.55 : 1 }}
                >
                  {isBusy ? 'Ukladam...' : 'Hotovo'}
                </button>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ color: '#334155', fontSize: 13, fontWeight: 850 }}>Fotka</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center' }}>
                  <input
                    ref={(node) => {
                      fileInputsRef.current[`${job.jobId}-before`] = node
                    }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    style={{ minWidth: 0 }}
                  />
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => uploadPhoto(job.jobId, 'before')}
                    style={{ ...buttonStyle, background: '#eef2ff', color: '#3730a3', opacity: isUploading ? 0.6 : 1 }}
                  >
                    Pred
                  </button>
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => uploadPhoto(job.jobId, 'after')}
                    style={{ ...buttonStyle, background: '#f0fdf4', color: '#166534', opacity: isUploading ? 0.6 : 1 }}
                  >
                    Po
                  </button>
                </div>
              </div>
            </article>
          )
        })
      )}
    </div>
  )
}
