'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import Image from 'next/image'
import { useI18n } from '@/components/I18nProvider'
import { getIntlLocale } from '@/lib/i18n/config'
import {
  cardTitleStyle,
  emptyStateStyle,
  errorStateStyle,
  metaItemStyle,
  mutedTextStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionCardStyle,
} from '@/components/SaasPageLayout'

type JobPhotoType = 'before' | 'after' | 'progress' | 'issue' | 'document'

type JobPhotoMeta = {
  id: string
  photoType: JobPhotoType
  fileName: string
  note: string | null
  takenAt: string | null
  thumbUrl: string | null
}

type JobPhotosResponse = {
  items: JobPhotoMeta[]
  total: number
  hasMore: boolean
  metadataMissing?: boolean
  metadataIncompleteCount?: number
}

type JobPhotosSectionProps = {
  jobId: string
  compact?: boolean
  canManage?: boolean
}

const PAGE_SIZE = 20
const PHOTO_FETCH_TIMEOUT_MS = 15000
const PHOTO_TYPES: JobPhotoType[] = ['before', 'after', 'progress', 'issue', 'document']

type UploadFileDraft = {
  key: string
  file: File
  note: string
}

function formatDateTime(value: string | null, locale: string) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function JobPhotosSection({ jobId, compact = false, canManage = false }: JobPhotosSectionProps) {
  const { dictionary, locale } = useI18n()
  const dateLocale = getIntlLocale(locale)
  const t = dictionary.jobs.detail.photos
  const fileInputId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<JobPhotoMeta[]>([])
  const [total, setTotal] = useState(0)
  const [initialLoadFinished, setInitialLoadFinished] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metadataInfo, setMetadataInfo] = useState<string | null>(null)
  const [selectedPhoto, setSelectedPhoto] = useState<JobPhotoMeta | null>(null)
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null)
  const [selectedPhotoFileName, setSelectedPhotoFileName] = useState<string | null>(null)
  const [selectedPhotoLoading, setSelectedPhotoLoading] = useState(false)
  const [selectedPhotoError, setSelectedPhotoError] = useState<string | null>(null)
  const [uploadPhotoType, setUploadPhotoType] = useState<JobPhotoType>('before')
  const [uploadFiles, setUploadFiles] = useState<UploadFileDraft[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null)

  const beforeCount = useMemo(() => items.filter((item) => item.photoType === 'before').length, [items])
  const afterCount = useMemo(() => items.filter((item) => item.photoType === 'after').length, [items])
  const hasMore = items.length < total
  const selectedFilesLabel = uploadFiles.length === 0
    ? t.noFileSelected
    : uploadFiles.length === 1
      ? uploadFiles[0].file.name
      : t.filesSelected.replace('{count}', String(uploadFiles.length))

  const photoTypeLabel = (type: JobPhotoType) => {
    if (type === 'before') return t.before
    if (type === 'after') return t.after
    if (type === 'progress') return t.progress
    if (type === 'issue') return t.issue
    return t.document
  }

  const photoTypeTone = (type: JobPhotoType): CSSProperties => {
    if (type === 'before') {
      return {
        backgroundColor: '#dbeafe',
        color: '#1d4ed8',
        border: '1px solid #bfdbfe',
      }
    }

    if (type === 'after') {
      return {
      backgroundColor: '#dcfce7',
      color: '#166534',
      border: '1px solid #bbf7d0',
      }
    }

    if (type === 'progress') {
      return {
        backgroundColor: '#e0f2fe',
        color: '#075985',
        border: '1px solid #bae6fd',
      }
    }

    if (type === 'document') {
      return {
        backgroundColor: '#f3e8ff',
        color: '#6b21a8',
        border: '1px solid #e9d5ff',
      }
    }

    return {
      backgroundColor: '#fef3c7',
      color: '#92400e',
      border: '1px solid #fde68a',
    }
  }

  const loadPhotos = useCallback(async (offset: number, append: boolean) => {
    if (!jobId) return

    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setError(null)
      setMetadataInfo(null)
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    try {
      const controller = new AbortController()
      timeoutId = setTimeout(() => controller.abort(), PHOTO_FETCH_TIMEOUT_MS)

      const response = await fetch(`/api/job-photos?jobId=${encodeURIComponent(jobId)}&offset=${offset}&limit=${PAGE_SIZE}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      })

      const data = (await response.json()) as JobPhotosResponse & { error?: string }

      if (!response.ok) {
        throw new Error(data.error || t.loadError)
      }

      setItems((prev) => (append ? [...prev, ...data.items] : data.items))
      setTotal(data.total)
      if (!append) {
        if (data.metadataMissing) {
          setMetadataInfo(t.metadataMissing)
        } else if ((data.metadataIncompleteCount ?? 0) > 0) {
          setMetadataInfo(t.metadataIncomplete)
        } else {
          setMetadataInfo(null)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadError)
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      if (!append) {
        setInitialLoadFinished(true)
      }
      setLoading(false)
      setLoadingMore(false)
    }
  }, [jobId, t.loadError, t.metadataIncomplete, t.metadataMissing])

  useEffect(() => {
    setExpanded(false)
    setItems([])
    setTotal(0)
    setError(null)
    setMetadataInfo(null)
    setInitialLoadFinished(false)
    setSelectedPhoto(null)
    setSelectedPhotoUrl(null)
    setSelectedPhotoFileName(null)
    setSelectedPhotoLoading(false)
    setSelectedPhotoError(null)
    setUploadFiles([])
    setUploadError(null)
    setUploading(false)
    setDeletingPhotoId(null)
  }, [jobId])

  useEffect(() => {
    if (!expanded || initialLoadFinished || loading) return
    void loadPhotos(0, false)
  }, [expanded, initialLoadFinished, loading, loadPhotos])

  async function handleOpenPhoto(photo: JobPhotoMeta) {
    setSelectedPhoto(photo)
    setSelectedPhotoUrl(null)
    setSelectedPhotoFileName(photo.fileName)
    setSelectedPhotoError(null)
    setSelectedPhotoLoading(true)

    try {
      const response = await fetch(`/api/job-photos/url?photoId=${encodeURIComponent(photo.id)}`, {
        method: 'GET',
        cache: 'no-store',
      })

      const data = (await response.json()) as { url?: string | null; fileName?: string | null; error?: string }

      if (!response.ok || !data.url) {
        throw new Error(data.error || t.loadPhotoError)
      }

      setSelectedPhotoUrl(data.url)
      setSelectedPhotoFileName(data.fileName ?? photo.fileName)
    } catch (err) {
      setSelectedPhotoError(err instanceof Error ? err.message : t.loadPhotoError)
    } finally {
      setSelectedPhotoLoading(false)
    }
  }

  function handleUploadFileChange(files: FileList | null) {
    const nextFiles = Array.from(files ?? []).map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      note: '',
    }))
    setUploadFiles(nextFiles)
    setUploadError(null)
  }

  function updateUploadNote(key: string, note: string) {
    setUploadFiles((prev) => prev.map((item) => (item.key === key ? { ...item, note } : item)))
  }

  async function handleUploadPhotos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (uploadFiles.length === 0) {
      setUploadError(t.selectAtLeastOne)
      return
    }

    setUploading(true)
    setUploadError(null)

    try {
      const formData = new FormData()
      formData.append('jobId', jobId)
      formData.append('photoType', uploadPhotoType)
      for (const item of uploadFiles) {
        formData.append('files', item.file)
        formData.append('notes', item.note)
      }

      const response = await fetch('/api/job-photos', {
        method: 'POST',
        body: formData,
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        throw new Error(data?.error || t.uploadFailed)
      }

    setUploadFiles([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    await loadPhotos(0, false)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t.uploadFailed)
    } finally {
      setUploading(false)
    }
  }

  async function handleDeletePhoto(photoId: string) {
    setDeletingPhotoId(photoId)
    setError(null)

    try {
      const response = await fetch('/api/job-photos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        throw new Error(data?.error || t.deleteFailed)
      }

      setItems((prev) => prev.filter((item) => item.id !== photoId))
      setTotal((prev) => Math.max(0, prev - 1))
      if (selectedPhoto?.id === photoId) {
        setSelectedPhoto(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.deleteFailed)
    } finally {
      setDeletingPhotoId(null)
    }
  }

  return (
    <>
      <div style={{ ...sectionCardStyle, marginTop: compact ? 0 : '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: expanded ? '14px' : 0 }}>
          <div>
            <h2 style={{ ...cardTitleStyle, fontSize: '20px', marginBottom: '6px' }}>{t.title}</h2>
            <div style={mutedTextStyle}>{t.description}</div>
          </div>

          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            style={{ ...(expanded ? primaryButtonStyle : secondaryButtonStyle), cursor: 'pointer' }}
          >
            {expanded ? t.hide : t.show}
          </button>
        </div>

        {expanded && (
          <div style={{ display: 'grid', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <span style={metaItemStyle}><strong>{t.total}:</strong> {total}</span>
              <span style={metaItemStyle}><strong>{t.before}:</strong> {beforeCount}</span>
              <span style={metaItemStyle}><strong>{t.after}:</strong> {afterCount}</span>
            </div>

            {error && <div style={errorStateStyle}>{error}</div>}
            {metadataInfo && <div style={{ ...metaItemStyle, backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8' }}>{metadataInfo}</div>}

            {canManage && (
              <form onSubmit={(event) => void handleUploadPhotos(event)} style={{ border: '1px solid #e5e7eb', borderRadius: '14px', padding: '14px', display: 'grid', gap: '12px', backgroundColor: '#f9fafb' }}>
                <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'minmax(180px, 240px) minmax(240px, 1fr)', alignItems: 'end' }}>
                  <label style={{ display: 'grid', gap: '6px', fontWeight: 700, color: '#111827' }}>
                    {t.photoType}
                    <select
                      value={uploadPhotoType}
                      onChange={(event) => setUploadPhotoType(event.target.value as JobPhotoType)}
                      disabled={uploading}
                      style={{ border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', font: 'inherit', backgroundColor: '#fff' }}
                    >
                      {PHOTO_TYPES.map((type) => (
                        <option key={type} value={type}>{photoTypeLabel(type)}</option>
                      ))}
                    </select>
                  </label>

                  <div style={{ display: 'grid', gap: '6px', fontWeight: 700, color: '#111827' }}>
                    {t.photosLabel}
                    <input
                      ref={fileInputRef}
                      id={fileInputId}
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      onChange={(event) => handleUploadFileChange(event.target.files)}
                      disabled={uploading}
                      style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: '52px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '7px 10px', backgroundColor: '#fff', overflow: 'hidden' }}>
                      <label
                        htmlFor={fileInputId}
                        style={{ ...secondaryButtonStyle, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.65 : 1, whiteSpace: 'nowrap' }}
                      >
                        {t.chooseFiles}
                      </label>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: uploadFiles.length > 0 ? '#111827' : '#6b7280', fontWeight: 700 }}>
                        {selectedFilesLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {uploadFiles.length > 0 && (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {uploadFiles.map((item) => (
                      <label key={item.key} style={{ display: 'grid', gap: '6px', color: '#374151', fontWeight: 700 }}>
                        {t.photoNote.replace('{fileName}', item.file.name)}
                        <textarea
                          value={item.note}
                          onChange={(event) => updateUploadNote(item.key, event.target.value)}
                          disabled={uploading}
                          rows={2}
                          placeholder={t.optionalNotePlaceholder}
                          style={{ border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', font: 'inherit', resize: 'vertical', backgroundColor: '#fff' }}
                        />
                      </label>
                    ))}
                  </div>
                )}

                {uploadError && <div style={errorStateStyle}>{uploadError}</div>}

                <div>
                  <button
                    type="submit"
                    disabled={uploading || uploadFiles.length === 0}
                    style={{ ...primaryButtonStyle, cursor: uploading || uploadFiles.length === 0 ? 'default' : 'pointer', opacity: uploading || uploadFiles.length === 0 ? 0.65 : 1 }}
                  >
                    {uploading ? t.uploadingPhotos : t.uploadPhotos}
                  </button>
                </div>
              </form>
            )}

            {loading ? (
              <div style={mutedTextStyle}>{t.loading}</div>
            ) : items.length === 0 ? (
              <div style={{ ...emptyStateStyle, padding: '22px' }}>{t.empty}</div>
            ) : (
              <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                {items.map((photo) => (
                  <div
                    key={photo.id}
                    style={{ border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden', backgroundColor: '#f9fafb' }}
                  >
                    <button
                      type="button"
                      onClick={() => void handleOpenPhoto(photo)}
                      style={{ width: '100%', padding: 0, border: 0, backgroundColor: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <div
                        style={{ height: '180px', backgroundColor: '#e5e7eb', backgroundImage: photo.thumbUrl ? `url("${photo.thumbUrl}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}
                      >
                        {!photo.thumbUrl ? t.noPreview : null}
                      </div>

                      <div style={{ padding: '10px 12px', display: 'grid', gap: '6px' }}>
                        <div style={{ ...photoTypeTone(photo.photoType), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 'fit-content', padding: '4px 8px', borderRadius: '999px', fontSize: '12px', fontWeight: 700 }}>
                          {photoTypeLabel(photo.photoType)}
                        </div>
                        <div style={{ fontWeight: 700, color: '#111827', fontSize: '14px' }}>{photo.fileName}</div>
                        {photo.note && <div style={{ color: '#4b5563', fontSize: '13px' }}>{photo.note}</div>}
                        <div style={{ color: '#6b7280', fontSize: '13px' }}>{formatDateTime(photo.takenAt, dateLocale)}</div>
                      </div>
                    </button>

                    {canManage && (
                      <div style={{ padding: '0 12px 12px' }}>
                        <button
                          type="button"
                          onClick={() => void handleDeletePhoto(photo.id)}
                          disabled={deletingPhotoId === photo.id}
                          style={{ ...secondaryButtonStyle, width: '100%', justifyContent: 'center', cursor: deletingPhotoId === photo.id ? 'default' : 'pointer', opacity: deletingPhotoId === photo.id ? 0.65 : 1 }}
                        >
                          {deletingPhotoId === photo.id ? t.deletingPhoto : t.deletePhoto}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {hasMore && (
              <div>
                <button
                  type="button"
                  onClick={() => void loadPhotos(items.length, true)}
                  disabled={loadingMore}
                  style={{ ...secondaryButtonStyle, cursor: loadingMore ? 'default' : 'pointer', opacity: loadingMore ? 0.7 : 1 }}
                >
                  {loadingMore ? t.loadingMore : t.loadMore}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedPhoto && (
        <div role="dialog" aria-modal="true" onClick={() => setSelectedPhoto(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(17, 24, 39, 0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: 'min(1100px, 100%)', maxHeight: '90vh', backgroundColor: '#fff', borderRadius: '16px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, color: '#111827' }}>{selectedPhoto.fileName}</div>
                <div style={{ color: '#6b7280', fontSize: '14px' }}>{photoTypeLabel(selectedPhoto.photoType)} | {formatDateTime(selectedPhoto.takenAt, dateLocale)}</div>
                {selectedPhoto.note && <div style={{ color: '#374151', fontSize: '14px', marginTop: '4px' }}>{selectedPhoto.note}</div>}
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {selectedPhotoUrl && (
                  <a href={selectedPhotoUrl} download={selectedPhotoFileName ?? selectedPhoto.fileName} target="_blank" rel="noreferrer" style={primaryButtonStyle}>
                    {t.download}
                  </a>
                )}

                <button type="button" onClick={() => setSelectedPhoto(null)} style={{ ...secondaryButtonStyle, cursor: 'pointer' }}>
                  {t.close}
                </button>
              </div>
            </div>

            <div style={{ minHeight: '60vh', backgroundColor: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
              {selectedPhotoLoading ? (
                <div style={{ color: '#fff' }}>{t.loadingPhoto}</div>
              ) : selectedPhotoError ? (
                <div style={{ color: '#fecaca' }}>{selectedPhotoError}</div>
              ) : selectedPhotoUrl ? (
                <Image
                  src={selectedPhotoUrl}
                  alt={selectedPhotoFileName ?? selectedPhoto.fileName}
                  width={1200}
                  height={900}
                  unoptimized
                  style={{ maxWidth: '100%', width: 'auto', height: 'auto', maxHeight: '70vh', objectFit: 'contain', display: 'block' }}
                />
              ) : (
                <div style={{ color: '#fff' }}>{t.photoUnavailable}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
