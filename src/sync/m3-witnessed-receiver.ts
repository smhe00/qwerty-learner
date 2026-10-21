/**
 * M2/M3 account-owned, READ-ONLY witnessed-chain receiver.
 *
 * A server-authenticated witnessed set proves only the exact device prefixes
 * given by the caller, not completeness of an eventually-consistent Blob list.
 * No downloaded row can overwrite Dexie, V4 vault, FSRS state or UI progress.
 * Every event and the server's canonical digest are independently rechecked.
 */
import type { IWordRecord } from '@/utils/db/record'
import { sha256Hex } from './sha256-compat'
import { immutableAttempt, type ChainedReceipt } from './multi-device-outbox'
import { stableWorkspaceJson } from './workspace-v4'
import { projectUuidLearningConvergence } from './v4-event-convergence'
import type { EventConvergenceProjection } from './v4-event-convergence'

type WitnessedVerification = {
  verified: boolean
  publishReady: false
  convergenceComplete: false
  listingIsAuthoritative?: false
  uniqueAttemptCount?: number
  evidenceSha256?: string
}
type WitnessedBatchReadback = {
  ok: true
  batch: {
    schemaVersion: 2
    accountId: string
    deviceId: string
    sequence: number
    batchId: string
    sha256: string
    previous: null | { batchId: string; sha256: string }
    events: IWordRecord[]
  }
}
export type WitnessedReaderPort = {
  /** Pin account, bearer and S1 generation; recheck around every await. */
  assertOwner(): Promise<void>
  verifyHeads(heads: ChainedReceipt[]): Promise<WitnessedVerification>
  read(receipt: ChainedReceipt): Promise<WitnessedBatchReadback>
}
export type WitnessedReceiveResult =
  | { status: 'blocked'; reason: string; publishReady: false;
      convergenceComplete: false; remoteAttemptCount: 0 }
  | { status: 'witnessed'; reason: 'verified-prefix-only'; publishReady: false;
      convergenceComplete: false; remoteAttemptCount: number;
      remoteEvents: IWordRecord[]; projection: EventConvergenceProjection }

const SHA = /^[0-9a-f]{64}$/
const DEVICE = /^qwerty-web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_READS = 128

function blocked(reason: string): WitnessedReceiveResult {
  return { status: 'blocked', reason, publishReady: false,
    convergenceComplete: false, remoteAttemptCount: 0 }
}
function validReceipt(x: ChainedReceipt): boolean {
  return Boolean(x && DEVICE.test(x.deviceId) && UUID.test(x.batchId) &&
    SHA.test(x.sha256) && Number.isSafeInteger(x.sequence) &&
    x.sequence >= 1 && x.sequence <= MAX_READS)
}
function identity(x: ChainedReceipt): string {
  return [x.deviceId, x.sequence, x.batchId, x.sha256].join(':')
}

/** Returns an audit preview, never a local/remote commit authorization. */
export async function inspectWitnessedDeviceConvergence(input: {
  accountId: string
  heads: readonly ChainedReceipt[]
  localRecords: readonly IWordRecord[]
  port: WitnessedReaderPort
}): Promise<WitnessedReceiveResult> {
  const { accountId, heads, localRecords, port } = input
  if (!accountId || heads.length < 1 || heads.length > 4 ||
      heads.some(head => !validReceipt(head))) {
    return blocked('invalid-witness-set')
  }

  const uniqueHeads = [...new Map(heads.map(head => [identity(head), head])).values()]
  const reported = new Map<string, string>()
  const batches = new Set<string>()
  const events = new Map<string, IWordRecord>()
  let readCount = 0
  try {
    await port.assertOwner()
    const proof = await port.verifyHeads(uniqueHeads)
    await port.assertOwner()
    if (proof.verified !== true || proof.publishReady !== false ||
        proof.convergenceComplete !== false ||
        proof.listingIsAuthoritative !== false ||
        !Number.isSafeInteger(proof.uniqueAttemptCount) ||
        !proof.evidenceSha256 || !SHA.test(proof.evidenceSha256)) {
      return blocked('witness-server-unverified')
    }

    for (const head of uniqueHeads) {
      let receipt: ChainedReceipt | null = head
      while (receipt) {
        if (++readCount > MAX_READS) return blocked('witness-read-budget')
        const key = identity(receipt)
        if (batches.has(key)) break // already checked this exact shared prefix
        await port.assertOwner()
        const reply = await port.read(receipt)
        await port.assertOwner()
        const batch = reply.batch
        if (reply.ok !== true || batch.accountId !== accountId ||
            batch.schemaVersion !== 2 || batch.deviceId !== receipt.deviceId ||
            batch.sequence !== receipt.sequence ||
            batch.batchId !== receipt.batchId ||
            batch.sha256 !== receipt.sha256 ||
            !Array.isArray(batch.events) || batch.events.length > 32 ||
            batch.events.length === 0) {
          return blocked('witness-receipt-integrity')
        }
        if (batch.sequence === 1 ? batch.previous !== null :
            !batch.previous || !UUID.test(batch.previous.batchId) ||
            !SHA.test(batch.previous.sha256)) {
          return blocked('witness-predecessor-integrity')
        }
        const sequenceKey = batch.deviceId + ':' + batch.sequence
        const existing = reported.get(sequenceKey)
        if (existing && existing !== batch.sha256) {
          return blocked('witnessed-device-fork')
        }
        reported.set(sequenceKey, batch.sha256)
        for (const row of batch.events) {
          const normalized = immutableAttempt(row)
          // A remote row with local Dexie identity must be rejected, not
          // silently cleaned up and made to look server-authenticated.
          if (stableWorkspaceJson(row) !== stableWorkspaceJson(normalized)) {
            return blocked('witness-event-not-canonical')
          }
          const id = normalized.attemptId!
          const prior = events.get(id)
          if (prior && stableWorkspaceJson(prior) !== stableWorkspaceJson(normalized)) {
            return blocked('witness-attempt-identity-conflict')
          }
          events.set(id, prior ?? normalized)
        }
        batches.add(key)
        receipt = batch.sequence === 1 ? null : {
          deviceId: batch.deviceId,
          sequence: batch.sequence - 1,
          batchId: batch.previous!.batchId,
          sha256: batch.previous!.sha256,
        }
      }
    }
    await port.assertOwner()
    const sortedSet = [...events].map(([uuid, row]) =>
      [uuid, stableWorkspaceJson(row)] as const)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    const digest = await sha256Hex(new TextEncoder().encode(stableWorkspaceJson(sortedSet)))
    if (digest !== proof.evidenceSha256 ||
        events.size !== proof.uniqueAttemptCount) {
      return blocked('witness-evidence-digest-mismatch')
    }
    const projection = projectUuidLearningConvergence({
      local: localRecords,
      remote: [...events.values()],
    })
    if (projection.status !== 'projected') {
      return blocked('witness-projection-' + projection.reason)
    }
    await port.assertOwner()
    return {
      status: 'witnessed', reason: 'verified-prefix-only',
      publishReady: false, convergenceComplete: false,
      remoteAttemptCount: events.size,
      remoteEvents: [...events.values()].sort((a, b) =>
        a.timeStamp - b.timeStamp ||
        (a.attemptId! < b.attemptId! ? -1 : a.attemptId! > b.attemptId! ? 1 : 0)),
      projection,
    }
  } catch (error) {
    // Even a network timeout or account switch cannot return a partial set.
    return blocked('witness-read-failed:' +
      (error instanceof Error ? error.message : 'unknown'))
  }
}
