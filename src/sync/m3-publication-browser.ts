/**
 * Explicit opt-in ETESТ-only M3 append-only event publisher.
 * Never restores/mutates learning data or V4 revision.
 * Called exclusively from an S1-mounted Learn tab holding its writer lease.
 */
import { loadAuth } from './auth'
import { inspectEventOutbox } from './multi-device-outbox-idb'
import { tryDeclareCheckoutAfterPublication } from './m3-checkout-cycle'
import { browserDeviceId } from './device-id'
import { runM3PublicationCycle } from './m3-publication-cycle'
import type { M3PublicationCycleResult } from './m3-publication-cycle'
import { flushOneWitnessedOutboxBatch } from './multi-device-outbox-transport'
import { recoverOwnedLearningEvents } from './multi-device-recovery-browser'
import { workspaceRegistryPort } from './workspace-vault'

let running: Promise<M3PublicationCycleResult> | null = null
let timer: ReturnType<typeof setTimeout> | null = null

export function etestM3PilotEnabled(): boolean {
  return import.meta.env.VITE_QWERTY_M3_PILOT_AUTO === 'true' &&
    typeof window !== 'undefined' &&
    window.location.hostname === 'etest.edgeone.dev'
}

export async function runEtestM3Publication(): Promise<M3PublicationCycleResult> {
  if (!etestM3PilotEnabled()) return { status: 'blocked', reason: 'pilot-disabled' }
  if (running) return running
  running = (async () => {
    const auth = loadAuth()
    if (!auth || auth.expiresAt * 1000 <= Date.now()) {
      return { status: 'blocked', reason: 'pilot-auth-required' }
    }
    const accountId = auth.user.userId
    const token = auth.token
    const owner = await workspaceRegistryPort.read()
    if (owner.pending || owner.generation === 0 || owner.active.kind !== 'account' ||
        owner.active.accountId !== accountId) {
      return { status: 'blocked', reason: 'pilot-account-not-mounted' }
    }
    const deviceId = browserDeviceId()
    const assertOwner = async () => {
      const [current, authNow] = await Promise.all([
        workspaceRegistryPort.read(), Promise.resolve(loadAuth()),
      ])
      if (current.generation !== owner.generation || current.pending ||
          current.active.kind !== 'account' || current.active.accountId !== accountId ||
          authNow?.user.userId !== accountId || authNow.token !== token ||
          authNow.expiresAt * 1000 <= Date.now() ||
          browserDeviceId() !== deviceId) {
        throw new Error('pilot-owner-changed')
      }
    }
    const published = await runM3PublicationCycle({
      assertOwner,
      recover: () => recoverOwnedLearningEvents(),
      publish: () => flushOneWitnessedOutboxBatch({ accountId, deviceId, token }),
    })
    // A verified immutable M3 upload may optionally issue a separate
    // etest-only checkout declaration. Neither a receipt nor a failed
    // declaration ever authorizes local V4 restore/cloud overwrite.
    const checkout = await tryDeclareCheckoutAfterPublication({
      accountId, deviceId, published,
      port: {
        assertOwner,
        readOutbox: () => inspectEventOutbox(accountId, deviceId),
        declare: async head => {
          // Lazy import avoids ordinary Learn startup or non-etest behavior.
          const { declareOwnedEtestCheckout } =
            await import('./m2-checkout-declaration-browser')
          return declareOwnedEtestCheckout(head)
        },
      },
    })
    if (checkout.status === 'blocked') {
      console.warn('M3 etest checkout retained uploaded evidence:', checkout.reason)
    }
    return published
  })()
  try { return await running } finally { running = null }
}

/** Debounced after durable WordRecord. An interrupted upload remains queued. */
export function scheduleEtestM3Publication(): void {
  if (!etestM3PilotEnabled()) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void runEtestM3Publication().then(result => {
      if (result.status === 'blocked') {
        console.warn('M3 etest event pilot retained local evidence:', result.reason)
      }
    }).catch(error => console.warn('M3 etest event pilot stopped:', error))
  }, 12_000)
}
