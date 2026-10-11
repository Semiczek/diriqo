'use client'
import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import styles from './fleet.module.css'

export default function UploadDocument({ companyId, vehicleId }: { companyId: string; vehicleId: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const attempt = useRef<{ fingerprint: string; requestId: string; uploaded: boolean } | null>(null)
  const router = useRouter()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = new FormData(event.currentTarget).get('file')
    if (!(file instanceof File) || !file.size || file.size > 3 * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Vyberte PDF, JPG, PNG nebo WebP do 3 MB.'); return }
    const fingerprint = `${file.name}:${file.size}:${file.lastModified}`
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID(), uploaded: false }
    const payload = { companyId, vehicleId, requestId: attempt.current.requestId, fileName: file.name.slice(0, 180), sizeBytes: file.size, mimeType: file.type }
    setPending(true); setError(null); setSuccess(false)
    try {
      if (!attempt.current.uploaded) {
        const response = await fetch('/fleet/documents/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error ?? 'Příprava nahrání selhala.')
        const uploaded = await supabase.storage.from('fleet-documents').uploadToSignedUrl(result.path, result.token, file, { contentType: file.type, upsert: false })
        if (uploaded.error && String(uploaded.error.statusCode) !== '409' && !/already exists/i.test(uploaded.error.message)) throw new Error('Nahrání selhalo. Zkuste stejný soubor znovu.')
        attempt.current.uploaded = true
      }
      const response = await fetch('/fleet/documents/upload', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Dokument se nepodařilo uložit.')
      setSuccess(true); attempt.current = null; router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nahrání selhalo. Zkuste to znovu.') }
    finally { setPending(false) }
  }
  return <form className={styles.form} onSubmit={submit}><label>PDF nebo obrázek (max. 3 MB)<input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required disabled={pending} /></label>{error ? <p className={styles.error} role="alert">{error}</p> : null}{success ? <p className={styles.success} role="status">Dokument uložen.</p> : null}<button className={styles.primary} type="submit" disabled={pending}>{pending ? 'Nahrávám…' : 'Nahrát dokument'}</button></form>
}
