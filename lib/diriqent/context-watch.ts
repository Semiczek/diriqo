import { matchesDiriqentIdentity, type DiriqentIdentity } from './access'
import { OFFICE_CONTEXT_EVENT } from '@/lib/office/client-context'

export type DiriqentContextState = 'checking' | 'ready' | 'blocked'

/** Only checks identity; never loads conversations or business data into the browser. */
export function watchDiriqentIdentity(identity: DiriqentIdentity, onState: (state: DiriqentContextState) => void) {
  let stopped = false, blocked = false, sequence = 0
  let controller: AbortController | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  function cancelRequest() {
    sequence++
    controller?.abort()
    clearTimeout(timeout)
  }
  async function verify(conceal = false) {
    if (stopped || blocked || document.visibilityState !== 'visible') return
    cancelRequest()
    const attempt = sequence
    controller = new AbortController()
    if (conceal) onState('checking')
    timeout = setTimeout(() => controller?.abort(), 8_000)
    try {
      const response = await fetch('/api/diriqent/context', { cache: 'no-store', signal: controller.signal })
      const value: unknown = response.ok ? await response.json() : null
      if (stopped || attempt !== sequence) return
      if (!matchesDiriqentIdentity(identity, value)) {
        blocked = true
        onState('blocked')
      } else if (document.visibilityState === 'visible' && document.hasFocus()) onState('ready')
    } catch {
      if (!stopped && attempt === sequence) { blocked = true; onState('blocked') }
    } finally { if (attempt === sequence) clearTimeout(timeout) }
  }
  function conceal() {
    cancelRequest()
    if (!blocked && !stopped) onState('checking')
  }
  function foreground() { void verify(true) }
  function visibility() { if (document.visibilityState === 'visible') foreground(); else conceal() }
  // Hide before returning to a tab whose old content may have a higher privilege.
  window.addEventListener('blur', conceal)
  window.addEventListener('focus', foreground)
  window.addEventListener('online', foreground)
  window.addEventListener('storage', foreground)
  window.addEventListener(OFFICE_CONTEXT_EVENT, foreground)
  document.addEventListener('visibilitychange', visibility)
  const timer = setInterval(() => { if (document.hasFocus()) void verify() }, 30_000)
  void verify()
  return () => {
    stopped = true
    cancelRequest()
    clearInterval(timer)
    window.removeEventListener('blur', conceal)
    window.removeEventListener('focus', foreground)
    window.removeEventListener('online', foreground)
    window.removeEventListener('storage', foreground)
    window.removeEventListener(OFFICE_CONTEXT_EVENT, foreground)
    document.removeEventListener('visibilitychange', visibility)
  }
}
