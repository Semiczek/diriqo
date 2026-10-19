type LinkIntent = { href: string; target?: string; download?: boolean; keepDraft?: boolean }
type ClickIntent = { button: number; defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }

/** New tabs, downloads and same-document anchors leave the current draft intact. */
export function inventoryLinkLeavesDraft(link: LinkIntent, click: ClickIntent, currentHref: string): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey
    || link.download || link.keepDraft || (link.target && link.target !== '_self')) return false
  const current = new URL(currentHref)
  const next = new URL(link.href, current)
  if (!['http:', 'https:'].includes(next.protocol)) return false
  return next.origin !== current.origin || next.pathname !== current.pathname || next.search !== current.search
}

/** Shared by the local form controls and browser navigation; no router interception. */
export function createInventoryDraftGuard(confirmDiscard: () => boolean) {
  let dirty = false
  return {
    markDirty() { dirty = true },
    clear() { dirty = false },
    shouldWarn(saving = false) { return dirty || saving },
    discard(saving = false) {
      if (saving) return false
      if (dirty && !confirmDiscard()) return false
      dirty = false
      return true
    },
    beforeUnload(event: { preventDefault(): void; returnValue: string }, saving = false) {
      if (!dirty && !saving) return
      event.preventDefault()
      event.returnValue = ''
    },
  }
}
