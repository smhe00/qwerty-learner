/**
 * Etest-only, explicitly configured M3 durable outbox background repair.
 * Safe to import after the S1-mounted app acquired its exclusive writer
 * lease. Never changes the cloud V4 snapshot or local learning state.
 */
import { startM3ContinuousDrain } from './m3-continuous-drain'
import { etestM3PilotEnabled, runEtestM3Publication } from './m3-publication-browser'
import { shouldRequestIdleM4Adoption } from './m4-idle-reconcile-policy'

export function startEtestM3BackgroundMonitor(): () => void {
  if (!etestM3PilotEnabled()) return () => undefined
  let lastDiscoveryAt = 0
  let lastInteractionAt = Date.now()
  const activity = () => { lastInteractionAt = Date.now() }
  document.addEventListener('keydown', activity, true)
  document.addEventListener('pointerdown', activity, true)
  const stopDrain = startM3ContinuousDrain({
    run: async () => {
      const published = await runEtestM3Publication()
      // Receiver is intentionally read-only; never treat a partial Blob
      // listing as complete device discovery or a writable merge candidate.
      if (published.status !== 'blocked' &&
          Date.now() - lastDiscoveryAt >= 15_000) {
        lastDiscoveryAt = Date.now()
        const { inspectEtestVisibleDeviceHeads } =
          await import('./m3-receive-discovery-browser')
        const observed = await inspectEtestVisibleDeviceHeads()
        if (observed.status === 'observed-only' &&
            observed.missingLocalAttempts && observed.missingLocalAttempts > 0) {
          console.info('QWERTY_M4_TRACE ' + JSON.stringify({
            phase: 'background', missing: observed.missingLocalAttempts,
            visibleDevices: observed.observedDevices,
          }))
          const element = document.activeElement
          const editingFieldFocused = element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            (element instanceof HTMLElement && element.isContentEditable)
          const eligible = shouldRequestIdleM4Adoption({
            missingLocalAttempts: observed.missingLocalAttempts,
            lastInteractionAgeMs: Date.now() - lastInteractionAt,
            online: navigator.onLine, visible: document.visibilityState === 'visible',
            pathname: window.location.pathname, search: window.location.search,
            editingFieldFocused,
            temporarilyBlocked:
              sessionStorage.getItem('qwerty.etest.m4.idleBlocked') === '1',
          })
          if (eligible) {
            // Never mutate mounted Dexie. Navigating starts a NEW guarded
            // S1 writer-exclusive, pre-mount M4 transaction. Idle input is
            // not lost and every committed WordRecord remains durable.
            window.location.replace('/?m4-reconcile=1')
          }
        }
        if (observed.status === 'blocked' &&
            observed.reason !== 'receipt-observation-no-observed-device-heads') {
          console.warn('etest M3 received only partial evidence:', observed.reason)
        }
      }
      return published
    },
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: handle => window.clearTimeout(handle as number),
    isOnline: () => navigator.onLine,
    onOnline: callback => {
      window.addEventListener('online', callback)
      return () => window.removeEventListener('online', callback)
    },
    onVisible: callback => {
      const onVisibility = () => {
        if (document.visibilityState === 'visible') callback()
      }
      document.addEventListener('visibilitychange', onVisibility)
      return () => document.removeEventListener('visibilitychange', onVisibility)
    },
    log: reason => console.warn('etest M3 outbox preserved; will retry:', reason),
  })
  return () => {
    stopDrain()
    document.removeEventListener('keydown', activity, true)
    document.removeEventListener('pointerdown', activity, true)
  }
}
