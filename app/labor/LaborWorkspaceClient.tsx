'use client'

import { useEffect, useRef, useState, useCallback, startTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/components/I18nProvider'
import { type LaborSubmissionDto, type LaborCostPreviewDto, type LaborTimeLine, LaborHistoryError } from '@/lib/labor-history'
import { runLaborCommandAction, previewLaborAction } from './actions'
import { assertLaborReceipt, blankLaborLine, createLaborDraftCommand, initialDraftFields, parseLaborCommand, sourceKey, type DraftFields, type LaborCommand, type LaborWorkspace } from './workflow'
import { laborMessages, type LaborText } from './messages'
import styles from './labor.module.css'

function identity(workspace: LaborWorkspace, profileId: string, jobId: string) {
  return { worker: workspace.sources.find(source => source.profileId === profileId)?.profileName ?? profileId.slice(0, 8),
    job: workspace.sources.find(source => source.jobId === jobId)?.jobTitle ?? jobId.slice(0, 8) }
}
function bufferKey(workspace: LaborWorkspace, id: string | null) { return `diriqo:labor-draft:v1:${workspace.companyId}:${workspace.actorProfileId}:${id ?? 'new'}` }
function safeDraft(raw: unknown): { revision: string; fields: DraftFields } {
  if (!raw || typeof raw !== 'object') throw new Error('draft')
  const value = raw as { revision?: unknown; fields?: Partial<DraftFields> }
  const fields = value.fields
  if (typeof value.revision !== 'string' || !fields || !Array.isArray(fields.sources) || fields.sources.length > 100 || fields.sources.some(key => typeof key !== 'string')
    || !Array.isArray(fields.lines) || !fields.lines.length || fields.lines.length > 366 || typeof fields.reason !== 'string' || fields.reason.length > 2000) throw new Error('draft')
  for (const line of fields.lines) {
    if (!line || typeof line !== 'object' || ['workDate','actualHours','payHours','billedHours'].some(key => typeof line[key as keyof LaborTimeLine] !== 'string')
      || (line.startedAt !== null && typeof line.startedAt !== 'string') || (line.endedAt !== null && typeof line.endedAt !== 'string')) throw new Error('draft')
  }
  return { revision: value.revision, fields: fields as DraftFields }
}

export default function LaborWorkspaceClient({ workspace }: { workspace: LaborWorkspace }) {
  const { locale } = useI18n(); const text = laborMessages[locale]; const router = useRouter()
  const finance = workspace.role === 'company_admin' || workspace.role === 'super_admin'
  const reviewer = workspace.role !== 'worker'
  const [selection, setSelection] = useState<string | null | 'new'>(null)
  const [editorState, setEditorState] = useState<{ key:string; dirty:boolean } | null>(null)
  const [filter, setFilter] = useState<'own' | 'queue' | 'all'>(reviewer ? 'queue' : 'own')
  const [receipts, setReceipts] = useState<Record<string, LaborSubmissionDto>>({})
  const [pending, setPending] = useState<LaborCommand | null>(null)
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState(''); const [saved, setSaved] = useState(false); const [conflict, setConflict] = useState(false)
  const [conflictReloadFrom, setConflictReloadFrom] = useState<LaborWorkspace | null>(null)
  const [previewInvalidation, setPreviewInvalidation] = useState<string | null>(null)
  const alive = useRef(false); const flight = useRef(false)
  const storageKey = `diriqo:labor-operation:v1:${workspace.companyId}:${workspace.actorProfileId}`
  const items = [...new Set([...workspace.items.map(item => item.id), ...Object.keys(receipts)])].map(id => {
    const server = workspace.items.find(item => item.id === id), receipt = receipts[id]
    return !server || (receipt && BigInt(receipt.revision) > BigInt(server.revision)) ? receipt : server
  }).filter((item): item is LaborSubmissionDto => Boolean(item))
  // A source can change without advancing the timesheet. Only an explicit refresh
  // followed by new server props unlocks a known rejected command.
  const conflictActive = conflict && (!conflictReloadFrom || conflictReloadFrom === workspace)
  const item = items.find(value => value.id === selection) ?? null
  const current = item?.versions.find(value => value.id === item.currentVersionId)
  const editorKey = item ? `${item.id}:${item.revision}` : 'new'
  const editorDirty = editorState?.key === editorKey && editorState.dirty
  const onEditorDirty = useCallback((dirty:boolean) => setEditorState({ key:editorKey, dirty }), [editorKey])
  const disabled = !ready || busy || blocked || Boolean(pending) || conflictActive

  useEffect(() => {
    alive.current = true
    try {
      const stored = sessionStorage.getItem(storageKey)
      if (stored) {
        const command = parseLaborCommand(JSON.parse(stored))
        if (command.input.companyId !== workspace.companyId || command.input.actorProfileId !== workspace.actorProfileId) throw new Error('scope')
        // Restore an interrupted operation only after browser storage is available.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPending(command)
        setSelection(command.input.submissionId ?? 'new')
      }
      setReady(true)
    } catch { setBlocked(true); setError('invalidStored') }
    return () => { alive.current = false }
  }, [storageKey, workspace.companyId, workspace.actorProfileId])

  async function run(raw: LaborCommand, replay = false) {
    if (!ready || busy || blocked || flight.current || (!replay && (pending || conflictActive))) return
    flight.current = true; setBusy(true); setSaved(false); setError(''); setConflict(false); setConflictReloadFrom(null)
    let command: LaborCommand
    try {
      command = parseLaborCommand(raw)
      if (command.input.companyId !== workspace.companyId || command.input.actorProfileId !== workspace.actorProfileId) throw new Error('scope')
      if (!replay) { try { sessionStorage.setItem(storageKey, JSON.stringify(command)) } catch { setBlocked(true); setError('storage'); return } }
      setPending(command)
      let result
      try { result = await runLaborCommandAction(command) } catch { if (alive.current) setError('unknown'); return }
      if (!alive.current) return
      if (!result.ok) {
        setError(result.code in text ? result.code : 'unknown')
        if (!replay && !result.uncertain) {
          try { sessionStorage.removeItem(storageKey); setPending(null) } catch { setBlocked(true); setError('storage') }
          if (result.code === 'conflict') {
            // Rates can change the preview without changing the timesheet revision.
            // A known approval rejection requires a fresh preview; its CAS stays unchanged.
            if (command.kind === 'review' && command.input.decision === 'approve') setPreviewInvalidation(command.input.operationId)
            else {
              setConflict(true)
              if (command.kind === 'submit') setEditorState({ key: `${command.input.submissionId}:${command.input.expectedRevision}`, dirty: true })
            }
          }
        }
        return
      }
      assertLaborReceipt(command, result.data)
      try {
        if (command.kind === 'draft') sessionStorage.removeItem(bufferKey(workspace, command.input.submissionId))
        sessionStorage.removeItem(storageKey)
      } catch { setBlocked(true); setError('storage'); return }
      setPending(null); setReceipts(previous => ({ ...previous, [result.data.id]: result.data })); setSelection(result.data.id); setSaved(true)
      router.refresh()
    } catch (failure) { if (alive.current) setError(failure instanceof LaborHistoryError && !failure.uncertain ? failure.code : 'unknown') }
    finally { flight.current = false; if (alive.current) setBusy(false) }
  }
  function refreshWorkspace() {
    if (conflictActive) setConflictReloadFrom(workspace)
    router.refresh()
  }
  const dispatch = (command: LaborCommand) => startTransition(() => { void run(command) })
  const base = item ? { companyId: workspace.companyId, actorProfileId: workspace.actorProfileId, submissionId: item.id, versionId: item.currentVersionId, expectedRevision: item.revision } : null
  const pendingItem = pending ? items.find(value => value.id === pending.input.submissionId) : null
  const pendingProfile = pending?.kind === 'draft' ? pending.input.profileId : pendingItem?.profileId
  const pendingJob = pending?.kind === 'draft' ? pending.input.jobId : pendingItem?.jobId
  const pendingIdentity = pendingProfile && pendingJob ? identity(workspace, pendingProfile, pendingJob) : null

  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.company}>{workspace.companyName}</p><h1>{text.title}</h1><p>{text.intro}</p></div><button type="button" className={styles.secondary} disabled={busy} onClick={refreshWorkspace}>{text.refresh}</button></header>
    {error && !(error === 'conflict' && conflict && !conflictActive) && <p className={styles.error} role="alert">{text[error as keyof typeof text] ?? text.unknown}</p>}
    {saved && <p className={styles.notice} role="status">{text.saved}</p>}
    {pending && <section className={styles.notice} role="status"><strong>{pending.kind === 'draft' ? text.save : pending.kind === 'submit' ? text.submit : pending.input.decision === 'approve' ? text.approve : text.return}</strong>
      {pendingIdentity && <p>{pendingIdentity.worker} · {pendingIdentity.job}</p>}<p>{text.pending}</p>
      {pending.kind === 'draft' && <><HoursTable lines={pending.input.lines} text={text} /><p>{pending.input.correctionReason}</p></>}
      {pending.kind === 'review' && pending.input.reason && <p>{pending.input.reason}</p>}
      <button type="button" className={styles.primary} disabled={busy || blocked} onClick={() => startTransition(() => { void run(pending, true) })}>{busy ? text.busy : text.retry}</button>
    </section>}
    <div className={styles.layout}><aside className={styles.sidebar}><div className={styles.filters}>
      {(['own', ...(reviewer ? ['queue', 'all'] : [])] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} disabled={Boolean(pending)} onClick={() => setFilter(value as typeof filter)}>{text[value as 'own' | 'queue' | 'all']}</button>)}
    </div><button type="button" className={styles.primary} disabled={disabled} onClick={() => { setSelection('new'); setSaved(false) }}>{text.new}</button>
      <ul className={styles.list}>{items.filter(value => filter === 'own' ? value.profileId === workspace.actorProfileId : filter === 'queue' ? value.versions.find(version => version.id === value.currentVersionId)?.state === 'submitted' : true).map(value => {
        const latest = value.versions.find(version => version.id === value.currentVersionId)!, names = identity(workspace, value.profileId, value.jobId)
        return <li key={value.id}><button type="button" aria-pressed={selection === value.id} disabled={Boolean(pending) || busy} onClick={() => setSelection(value.id)}><strong>{names.job}</strong><span>{names.worker}</span><span>{latest.lines[0]?.workDate} · {text[latest.state]}</span></button></li>
      })}</ul>
      {items.filter(value => filter === 'own' ? value.profileId === workspace.actorProfileId : filter === 'queue' ? value.versions.find(version => version.id === value.currentVersionId)?.state === 'submitted' : true).length === 0 && <p className={styles.muted}>{text.empty}</p>}
    </aside><section className={styles.detail}>
      {selection === null && <p>{text.select}</p>}
      {item && current && <><header className={styles.detailHeader}><h2>{identity(workspace, item.profileId, item.jobId).job}</h2><p>{identity(workspace, item.profileId, item.jobId).worker} · {text[current.state]} · {text.version} {current.version}</p></header>
        <HoursTable lines={current.lines} text={text} />
        {current.reviewReason && <p className={styles.notice}>{text.returnReason}: {current.reviewReason}</p>}
        {current.state === 'draft' && base && <button type="button" className={styles.primary} disabled={disabled || editorDirty} onClick={() => dispatch({ kind:'submit', input:{ ...base, operationId:crypto.randomUUID() } })}>{text.submit}</button>}
        {editorDirty && current.state === 'draft' && <p role="status" className={styles.hint}>{text.unsaved}</p>}
        {current.state === 'submitted' && reviewer && base && <ReviewForm key={`${item.id}:${item.revision}`} workspace={workspace} item={item} disabled={disabled} text={text} locale={locale} finance={finance} previewInvalidation={previewInvalidation} onRun={dispatch} />}
      </>}
      {(selection === 'new' || (item && current && current.state !== 'submitted')) && <DraftEditor key={item ? `${item.id}:${item.revision}` : 'new'} workspace={workspace} item={item} text={text} disabled={disabled} onRun={dispatch} onDirty={onEditorDirty} />}
      {item && <details className={styles.history}><summary>{text.history}</summary>{[...item.versions].reverse().map(version => <section key={version.id} className={styles.version}><h3>{text.version} {version.version} · {text[version.state]} {item.approvedVersionId === version.id ? `· ${text.currentApproved}` : ''}</h3><p>{version.correctionReason}</p><HoursTable lines={version.lines} text={text} />{finance && version.cost && <p>{text.cost}: {new Intl.NumberFormat(locale, { style:'currency', currency:version.cost.currency }).format(Number(version.cost.amount))}</p>}</section>)}</details>}
    </section></div>
  </main>
}

function HoursTable({ lines, text }: { lines: LaborTimeLine[]; text: LaborText }) {
  return <div className={styles.tableWrap}><table><thead><tr><th scope="col">{text.date}</th><th scope="col">{text.actual}</th><th scope="col">{text.pay}</th><th scope="col">{text.billed}</th></tr></thead><tbody>{lines.map((line, index) => <tr key={`${line.workDate}:${index}`}><td>{line.workDate}</td><td>{line.actualHours}</td><td>{line.payHours}</td><td>{line.billedHours}</td></tr>)}</tbody></table></div>
}

function DraftEditor({ workspace, item, disabled, text, onRun, onDirty }: { workspace: LaborWorkspace; item: LaborSubmissionDto | null; disabled: boolean; text: LaborText; onRun: (command: LaborCommand) => void; onDirty: (dirty:boolean) => void }) {
  const current = item?.versions.find(version => version.id === item.currentVersionId)
  const [editing, setEditing] = useState(!current || current.state === 'draft')
  const [fields, setFields] = useState(() => initialDraftFields(item)); const [ready, setReady] = useState(false)
  const [stale, setStale] = useState(false); const [error, setError] = useState('')
  const key = bufferKey(workspace, item?.id ?? null), revision = item?.revision ?? '0'
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(key)
      if (stored) {
        const value = safeDraft(JSON.parse(stored))
        // Browser drafts are restored after hydration, never during server rendering.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFields(value.fields); setStale(value.revision !== revision); setEditing(true); onDirty(true)
      }
      setReady(true)
    } catch { setError('storage') }
  }, [key, revision, onDirty])
  const update = (next: DraftFields) => {
    setFields(next); onDirty(true)
    try { sessionStorage.setItem(key, JSON.stringify({ revision: stale ? 'stale' : revision, fields: next })); setError('') }
    catch { setError('storage') }
  }
  const available = workspace.sources.filter(source => source.submissionId === null || source.submissionId === item?.id)
  const first = available.find(source => fields.sources.includes(sourceKey(source)))
  const eligible = available.filter(source => (!item || (source.profileId === item.profileId && source.jobId === item.jobId))
    && (!first || (source.profileId === first.profileId && source.jobId === first.jobId)))
  const locked = disabled || !ready || error === 'storage'
  function submit(event: FormEvent) {
    event.preventDefault()
    if (locked || stale) return
    try { onRun(createLaborDraftCommand(workspace, item, fields)); setError('') }
    catch { setError('validation') }
  }
  if (!editing) return <button type="button" className={styles.secondary} disabled={disabled} onClick={() => setEditing(true)}>{text.revise}</button>
  return <form className={styles.editor} onSubmit={submit}>
    <h3>{item ? text.save : text.new}</h3>
    {error && <p role="alert" className={styles.error}>{text[error as keyof LaborText] ?? text.validation}</p>}
    {stale && <div className={styles.notice}><p>{text.staleDraft}</p><label><input type="checkbox" onChange={event => { if (event.target.checked) { setStale(false); try { sessionStorage.setItem(key, JSON.stringify({ revision, fields })) } catch { setError('storage') } } }} /> {text.acceptCurrent}</label></div>}
    <fieldset disabled={locked}><legend>{text.sources}</legend><p className={styles.muted}>{item?.approvedVersionId ? text.lockedSources : text.sourceHint}</p>
      {eligible.length === 0 && !item && <p>{text.noSources}</p>}
      <div className={styles.sourceList}>{eligible.map(source => <label key={sourceKey(source)} className={styles.source}><input type="checkbox" checked={fields.sources.includes(sourceKey(source))} disabled={Boolean(item?.approvedVersionId)} onChange={event => {
        const selected = event.target.checked ? [...fields.sources, sourceKey(source)] : fields.sources.filter(value => value !== sourceKey(source))
        const lines = fields.sources.length === 0 && event.target.checked && fields.lines.length === 1 && !fields.lines[0].workDate
          ? [{ ...blankLaborLine(), workDate:source.workDate ?? '', actualHours:source.actualHours ?? '' }] : fields.lines
        update({ ...fields, sources:selected, lines })
      }} /><span><strong>{source.jobTitle ?? text.job} · {source.profileName ?? text.worker}</strong><small>{text[source.kind]} · {source.workDate ?? '—'}</small></span></label>)}</div>
      {item?.sources.filter(source => !available.some(value => sourceKey(value) === sourceKey(source))).map(source => <p key={sourceKey(source)}>{text.archived}: {text[source.kind]}</p>)}
      <p className={styles.hint}>{text.hoursHint}</p>
      {fields.lines.map((line, index) => <div className={styles.line} key={index}>
        <label>{text.date}<input name={`date-${index}`} type="date" required value={line.workDate} onChange={event => update({ ...fields, lines:fields.lines.map((value, at) => at === index ? { ...value, workDate:event.target.value, startedAt:null, endedAt:null } : value) })} /></label>
        {(['actualHours','payHours','billedHours'] as const).map((name, at) => <label key={name}>{[text.actual,text.pay,text.billed][at]}<input name={`${name}-${index}`} type="number" min="0" max="25" step="0.0001" inputMode="decimal" required value={line[name]} onChange={event => update({ ...fields, lines:fields.lines.map((value, row) => row === index ? { ...value, [name]:event.target.value, ...(name === 'actualHours' ? { startedAt:null, endedAt:null } : {}) } : value) })} /></label>)}
        <button type="button" className={styles.secondary} disabled={fields.lines.length === 1} aria-label={`${text.remove} ${index + 1}`} onClick={() => update({ ...fields, lines:fields.lines.filter((_, at) => at !== index) })}>×</button>
      </div>)}
      <button type="button" className={styles.secondary} disabled={fields.lines.length >= 366} onClick={() => update({ ...fields, lines:[...fields.lines,blankLaborLine()] })}>{text.addDay}</button>
      {(current?.revisionOf || (current && current.state !== 'draft')) && <label className={styles.reason}>{text.reason}<textarea required maxLength={2000} rows={3} value={fields.reason} onChange={event => update({ ...fields, reason:event.target.value })} /></label>}
      <p className={styles.hint}>{text.retained}</p><button type="submit" className={styles.primary} disabled={stale}>{text.save}</button>
    </fieldset>
  </form>
}

function ReviewForm({ workspace, item, disabled, text, locale, finance, previewInvalidation, onRun }: { workspace: LaborWorkspace; item: LaborSubmissionDto; disabled: boolean; text: LaborText; locale: string; finance: boolean; previewInvalidation: string | null; onRun: (command: LaborCommand) => void }) {
  const [checkedPreview, setCheckedPreview] = useState<{ data: LaborCostPreviewDto; invalidation: string | null } | null>(null)
  const [busy, setBusy] = useState(false), [reason, setReason] = useState(''), [error, setError] = useState('')
  const preview = checkedPreview?.invalidation === previewInvalidation ? checkedPreview.data : null
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const base = { companyId:workspace.companyId, actorProfileId:workspace.actorProfileId, submissionId:item.id, versionId:item.currentVersionId }
  async function loadPreview() {
    if (busy || disabled) return
    setBusy(true); setError(''); setCheckedPreview(null)
    try {
      const result = await previewLaborAction(base)
      if (!alive.current) return
      if (!result.ok) { setError(result.code); return }
      if (result.data.companyId !== base.companyId || result.data.submissionId !== base.submissionId || result.data.versionId !== base.versionId) { setError('unknown'); return }
      setCheckedPreview({ data: result.data, invalidation: previewInvalidation })
    } catch { if (alive.current) setError('unknown') }
    finally { if (alive.current) setBusy(false) }
  }
  function review(decision:'approve'|'return') {
    if (disabled || busy || (decision === 'approve' && preview?.completeness !== 'complete') || (decision === 'return' && !reason.trim())) return
    onRun({ kind:'review', input:{ ...base, expectedRevision:item.revision, operationId:crypto.randomUUID(), decision,
      reason:reason.trim() || null, expectedCostPreviewHash:decision === 'approve' ? preview!.previewHash : null } })
  }
  return <section className={styles.review}><h3>{text.queue}</h3>{error && <p role="alert" className={styles.error}>{text[error as keyof LaborText] ?? text.unknown}</p>}
    <button type="button" className={styles.secondary} disabled={disabled || busy} onClick={() => startTransition(() => { void loadPreview() })}>{busy ? text.busy : text.preview}</button>
    {preview && <div className={styles.notice} role="status"><p>{preview.completeness === 'complete' ? text.previewReady : text.incomplete}</p>{preview.reasons.map((value,index) => <p key={`${value}:${index}`}>{text[value as keyof LaborText] ?? text.incomplete}</p>)}{finance && preview.cost && <strong>{text.cost}: {new Intl.NumberFormat(locale,{style:'currency',currency:preview.cost.currency}).format(Number(preview.cost.amount))}</strong>}</div>}
    <label className={styles.reason}>{text.returnReason}<textarea maxLength={2000} rows={2} value={reason} disabled={disabled || busy} onChange={event => setReason(event.target.value)} /></label>
    <div className={styles.actions}><button type="button" className={styles.primary} disabled={disabled || busy || preview?.completeness !== 'complete'} onClick={() => review('approve')}>{text.approve}</button><button type="button" className={styles.secondary} disabled={disabled || busy || !reason.trim()} onClick={() => review('return')}>{text.return}</button></div>
  </section>
}
