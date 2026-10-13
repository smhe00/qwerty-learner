/**
 * M3.6 opt-in one-batch uploader. Not wired to regular Learn/Typing or V4
 * Restore. The normal single-session V4 uploader remains unchanged.
 * Source scan/capture and account writer locks are future M4 prerequisites.
 */
import { publishChainedEventBatch, readChainedEventBatch } from './api'
import { confirmDurableBatch, reserveDurableBatch } from './multi-device-outbox-idb'
import type { ChainedBatch, ChainedReceipt } from './multi-device-outbox'
import { stableWorkspaceJson } from './workspace-v4'
import { newLearningAttemptId } from '@/utils/db/attempt-identity'

const SHA = /^[a-f0-9]{64}$/

function matchingReceipt(batch: ChainedBatch, result: ChainedReceipt): boolean {
  return batch.deviceId === result.deviceId &&
    batch.sequence === result.sequence &&
    batch.batchId === result.batchId &&
    SHA.test(result.sha256)
}

/**
 * Keep the exact in-flight batch across any HTTP error or browser crash.
 * A POST success alone does not remove evidence; independently read the
 * content-addressed receipt, compare full bytes, then durably advance head.
 *
 * Caller MUST hold the S1 account workspace writer lease and attest token
 * owner before calling; this cannot be an unguarded background operation.
 */
export async function flushOneWitnessedOutboxBatch(input: {
  accountId: string
  deviceId: string
  token: string
}): Promise<
  | { status: 'idle' }
  | { status: 'verified'; receipt: ChainedReceipt; remaining: number }
  | { status: 'retained'; reason: string }
> {
  const { accountId, deviceId, token } = input
  if (!accountId || !token || !deviceId) throw new Error('outbox-missing-owner')
  const next = await reserveDurableBatch(accountId, deviceId, newLearningAttemptId())
  const batch = next.inflight
  if (!batch) return { status: 'idle' }

  try {
    const published = await publishChainedEventBatch(token, batch)
    if (!published.stored || !matchingReceipt(batch, published)) {
      throw new Error('outbox-post-receipt-mismatch')
    }
    const receipt = {
      deviceId: published.deviceId, sequence: published.sequence,
      batchId: published.batchId, sha256: published.sha256,
    }
    const exact = await readChainedEventBatch(token, receipt)
    if (!exact.ok || exact.batch.accountId !== accountId ||
        exact.batch.schemaVersion !== 2 ||
        exact.batch.sha256 !== receipt.sha256 ||
        !matchingReceipt(batch, exact.batch) ||
        exact.batch.previous?.sha256 !== batch.previous?.sha256 ||
        exact.batch.previous?.batchId !== batch.previous?.batchId ||
        stableWorkspaceJson(exact.batch.events) !== stableWorkspaceJson(batch.events)) {
      throw new Error('outbox-readback-integrity-mismatch')
    }
    const confirmed = await confirmDurableBatch(accountId, deviceId, receipt)
    return { status: 'verified', receipt, remaining: confirmed.pending.length }
  } catch (error) {
    // Unknown network acknowledgement MUST NOT be interpreted as a failed
    // durable commit. The same immutable batch is available for retry.
    return { status: 'retained',
      reason: error instanceof Error ? error.message : 'unknown-network-error' }
  }
}
