/** Bounded M3 event publisher; event receipts are NOT V4 cloud convergence. */
import type { EventPublicationOutcome } from './multi-device-outbox-publisher'

export type M3PublicationCyclePort = {
  assertOwner(): Promise<void>
  recover(): Promise<{ scanned: number; pending: number }>
  publish(): Promise<EventPublicationOutcome>
}
export type M3PublicationCycleResult =
  | { status: 'blocked'; reason: string }
  | { status: 'idle'; scanned: number }
  | { status: 'uploaded-events-only'; scanned: number; batches: number; remaining: number }

export async function runM3PublicationCycle(
  port: M3PublicationCyclePort, limit = 2,
): Promise<M3PublicationCycleResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 4) {
    return { status: 'blocked', reason: 'invalid-pilot-batch-limit' }
  }
  try {
    await port.assertOwner()
    const recovered = await port.recover()
    await port.assertOwner()
    if (!Number.isSafeInteger(recovered.scanned) || recovered.scanned < 0 ||
        !Number.isSafeInteger(recovered.pending) || recovered.pending < 0) {
      return { status: 'blocked', reason: 'invalid-recovery-scan' }
    }
    let batches = 0
    let remaining = recovered.pending
    for (let n = 0; n < limit; n++) {
      await port.assertOwner()
      const result = await port.publish()
      await port.assertOwner()
      if (result.status === 'retained') {
        return { status: 'blocked', reason: result.reason }
      }
      if (result.status === 'idle') break
      batches++
      remaining = result.remaining
      if (!remaining) break
    }
    return batches
      ? { status: 'uploaded-events-only', scanned: recovered.scanned, batches, remaining }
      : { status: 'idle', scanned: recovered.scanned }
  } catch (error) {
    return { status: 'blocked', reason: error instanceof Error ?
      error.message : 'unknown-pilot-failure' }
  }
}
