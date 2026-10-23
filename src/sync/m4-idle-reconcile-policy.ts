/**
 * Etest-only passive M4 convergence trigger. This is NOT permission to
 * write IndexedDB: a true result only permits navigation to the existing S1
 * pre-mount writer-locked reconciliation transaction. Never interrupt input.
 */
export type IdleM4Signal = {
  missingLocalAttempts: number | undefined
  lastInteractionAgeMs: number
  online: boolean
  visible: boolean
  pathname: string
  search: string
  editingFieldFocused: boolean
  temporarilyBlocked: boolean
}
export function shouldRequestIdleM4Adoption(x: IdleM4Signal): boolean {
  return Number.isSafeInteger(x.missingLocalAttempts) &&
    Number(x.missingLocalAttempts) > 0 &&
    Number.isFinite(x.lastInteractionAgeMs) &&
    x.lastInteractionAgeMs >= 25_000 &&
    x.online && x.visible && !x.editingFieldFocused &&
    !x.temporarilyBlocked && x.search === '' &&
    ['/', '/learn', '/mobile'].includes(x.pathname.replace(/\/$/, '') || '/')
}
