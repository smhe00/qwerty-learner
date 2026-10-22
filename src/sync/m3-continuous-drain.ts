/**
 * M3 etest-only background pump. A learning attempt is durable before this
 * runs; failure never erases the outbox or changes V4/FSRS state.
 *
 * A periodic rescan repairs crashes between RecordDB and outbox IDB commits,
 * and lifecycle triggers recover pending evidence after connectivity returns.
 * Every cycle is independently S1-account-pinned by its browser adapter.
 */
import type { M3PublicationCycleResult } from './m3-publication-cycle'

export type M3DrainLoopPort = {
  run(): Promise<M3PublicationCycleResult>
  schedule(callback: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
  isOnline(): boolean
  onOnline(callback: () => void): () => void
  onVisible(callback: () => void): () => void
  log(reason: string): void
}

const IDLE_MS = 45_000
const BUSY_MS = 1_000
const OFFLINE_MS = 60_000
const FIRST_MS = 2_000
const MAX_BACKOFF_MS = 120_000

/** No overlapping cycles, bounded exponential retry, and stop on pagehide. */
export function startM3ContinuousDrain(
  port: M3DrainLoopPort,
): () => void {
  let stopped = false
  let active = false
  let scheduled: unknown = null
  let failures = 0
  let rerun = false
  const arm = (ms: number) => {
    if (stopped) return
    if (scheduled !== null) port.cancel(scheduled)
    scheduled = port.schedule(() => {
      scheduled = null
      void tick()
    }, ms)
  }
  const tick = async () => {
    if (stopped) return
    if (active) {
      rerun = true
      return
    }
    if (!port.isOnline()) {
      arm(OFFLINE_MS)
      return
    }
    active = true
    let wait = IDLE_MS
    try {
      const outcome = await port.run()
      if (outcome.status === 'blocked') {
        failures = Math.min(failures + 1, 4)
        wait = Math.min(MAX_BACKOFF_MS, 7_500 * 2 ** (failures - 1))
        // M3 is opt-in, and retained outbox remains the recovery source.
        if (outcome.reason !== 'pilot-auth-required' &&
            outcome.reason !== 'pilot-account-not-mounted') {
          port.log(outcome.reason)
        }
      } else {
        failures = 0
        if (outcome.status === 'uploaded-events-only' &&
            outcome.remaining > 0) wait = BUSY_MS
      }
    } catch (error) {
      failures = Math.min(failures + 1, 4)
      wait = Math.min(MAX_BACKOFF_MS, 7_500 * 2 ** (failures - 1))
      port.log(error instanceof Error ? error.message : 'm3-unknown-pump-error')
    } finally {
      active = false
      if (!stopped) {
        if (rerun) { rerun = false; arm(BUSY_MS) }
        else arm(wait)
      }
    }
  }
  const wake = () => {
    if (stopped) return
    if (active) { rerun = true; return }
    failures = 0
    if (port.isOnline()) arm(BUSY_MS)
  }
  const detachOnline = port.onOnline(wake)
  const detachVisible = port.onVisible(wake)
  arm(FIRST_MS)
  return () => {
    if (stopped) return
    stopped = true
    if (scheduled !== null) port.cancel(scheduled)
    scheduled = null
    detachOnline()
    detachVisible()
  }
}
