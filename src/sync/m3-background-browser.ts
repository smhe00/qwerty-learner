/**
 * Etest-only, explicitly configured M3 durable outbox background repair.
 * Safe to import after the S1-mounted app acquired its exclusive writer
 * lease. Never changes the cloud V4 snapshot or local learning state.
 */
import { startM3ContinuousDrain } from './m3-continuous-drain'
import { etestM3PilotEnabled, runEtestM3Publication } from './m3-publication-browser'

export function startEtestM3BackgroundMonitor(): () => void {
  if (!etestM3PilotEnabled()) return () => undefined
  let lastDiscoveryAt = 0
  return startM3ContinuousDrain({
    run: async () => {
      const published = await runEtestM3Publication()
      // Receiver is intentionally read-only; never treat a partial Blob
      // listing as complete device discovery or a writable merge candidate.
      if (published.status !== 'blocked' &&
          Date.now() - lastDiscoveryAt >= 60_000) {
        lastDiscoveryAt = Date.now()
        const { inspectEtestVisibleDeviceHeads } =
          await import('./m3-receive-discovery-browser')
        const observed = await inspectEtestVisibleDeviceHeads()
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
}
