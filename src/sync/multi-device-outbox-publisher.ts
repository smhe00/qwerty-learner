/**
 * M3.8 opt-in crash-safe publication orchestration.
 * The port is injected so ambiguous transport, account-switch and readback
 * failures can be verified without a real Blob or local browser.
 * This is NOT the ordinary V4 Sync/Restore path.
 */
import type { ChainedBatch, ChainedReceipt, EventOutboxState } from './multi-device-outbox'
import { stableWorkspaceJson } from './workspace-v4'

const SHA = /^[a-f0-9]{64}$/

export type ChainedPublicationResponse = ChainedReceipt & { stored: true }
export type ChainedReadback = {
  ok: true
  batch: ChainedBatch & {
    accountId: string
    schemaVersion: 2
    sha256: string
  }
}

export type EventPublisherPort = {
  /** MUST check account+token+device+workspace generation before each operation. */
  assertOwner(): Promise<void>
  /** Atomic IDB reservation; must return SAME in-flight bytes on retry. */
  reserve(): Promise<EventOutboxState>
  publish(batch: ChainedBatch): Promise<ChainedPublicationResponse>
  read(receipt: ChainedReceipt): Promise<ChainedReadback>
  /** Atomic IDB completion; do not clear evidence without exact readback. */
  confirm(receipt: ChainedReceipt): Promise<EventOutboxState>
}

export type EventPublicationOutcome =
  | { status: 'idle' }
  | { status: 'verified'; receipt: ChainedReceipt; remaining: number }
  | { status: 'retained'; reason: string }

function exactIdentity(batch: ChainedBatch, item: ChainedReceipt): boolean {
  return batch.deviceId === item.deviceId &&
    batch.batchId === item.batchId &&
    batch.sequence === item.sequence &&
    SHA.test(item.sha256)
}

/**
 * No destructive operation occurs on any ambiguous result: the unchanged
 * batch remains durably reserved for identical retry.
 */
export async function publishOneImmutableBatch(
  accountId: string, port: EventPublisherPort,
): Promise<EventPublicationOutcome> {
  if (!accountId) throw new Error('outbox-missing-account')
  await port.assertOwner()
  // Errors during reservation (quota, corrupt IDB, wrong owner) are NOT
  // downgraded to a mere transport retry: surface the durable fault.
  const state = await port.reserve()
  const batch = state.inflight
  if (!batch) return { status: 'idle' }
  if (state.accountId !== accountId || state.deviceId !== batch.deviceId) {
    throw new Error('outbox-reservation-owner-mismatch')
  }
  try {
    await port.assertOwner()
    const post = await port.publish(batch)
    if (!post.stored || !exactIdentity(batch, post)) {
      throw new Error('outbox-post-receipt-mismatch')
    }
    const receipt = { deviceId: post.deviceId, sequence: post.sequence,
      batchId: post.batchId, sha256: post.sha256 }
    // A browser may have switched accounts while the POST was in flight.
    await port.assertOwner()
    const exact = await port.read(receipt)
    if (!exact.ok || exact.batch.accountId !== accountId ||
        exact.batch.schemaVersion !== 2 ||
        exact.batch.sha256 !== receipt.sha256 ||
        !exactIdentity(batch, exact.batch) ||
        exact.batch.previous?.sha256 !== batch.previous?.sha256 ||
        exact.batch.previous?.batchId !== batch.previous?.batchId ||
        stableWorkspaceJson(exact.batch.events) !== stableWorkspaceJson(batch.events)) {
      throw new Error('outbox-readback-integrity-mismatch')
    }
    await port.assertOwner()
    const confirmed = await port.confirm(receipt)
    return { status: 'verified', receipt, remaining: confirmed.pending.length }
  } catch (error) {
    return {
      status: 'retained',
      reason: error instanceof Error ? error.message : 'unknown-network-error',
    }
  }
}
