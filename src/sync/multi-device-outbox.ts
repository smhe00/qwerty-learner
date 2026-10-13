/**
 * M3.6 deterministic client-side immutable-event outbox state machine.
 * This module never sends network requests or changes any V4 snapshot.
 * A browser IDB adapter persists every transition atomically; absence of an
 * exact GET-verified receipt MUST retain an in-flight batch for identical retry.
 */
import type { IWordRecord } from '@/utils/db/record'
import { stableWorkspaceJson } from './workspace-v4'

export type ChainedReceipt = {
  deviceId: string
  sequence: number
  batchId: string
  sha256: string
}

export type ChainedBatch = {
  deviceId: string
  sequence: number
  batchId: string
  previous: null | { batchId: string; sha256: string }
  events: IWordRecord[]
}

export type EventOutboxState = {
  version: 1
  accountId: string
  deviceId: string
  pending: IWordRecord[]
  inflight: ChainedBatch | null
  confirmedHead: ChainedReceipt | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEVICE = /^qwerty-web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[a-f0-9]{64}$/
export const MAX_OUTBOX_BATCH_ROWS = 32
export const MAX_OUTBOX_BATCH_BYTES = 80 * 1024

function assertScope(state: EventOutboxState): void {
  if (!state.accountId || !DEVICE.test(state.deviceId) || state.version !== 1) {
    throw new Error('outbox-invalid-account-or-device')
  }
}
export function initialEventOutbox(accountId: string, deviceId: string): EventOutboxState {
  const result: EventOutboxState = {
    version: 1, accountId, deviceId, pending: [], inflight: null, confirmedHead: null,
  }
  assertScope(result)
  return result
}

/**
 * Never silently identify attempts from numeric Dexie IDs. The canonical
 * queue excludes local primary keys and derived scheduler state.
 */
export function immutableAttempt(row: IWordRecord): IWordRecord {
  const { id: _localId, fsrsShadow: _fsrs,
    reviewPolicyShadow: _proposal, ...core } = row
  if (!UUID.test(core.attemptId || '') ||
      typeof core.dict !== 'string' || !core.dict || core.dict.length > 128 ||
      typeof core.word !== 'string' || !core.word || core.word.length > 128 ||
      !Number.isSafeInteger(core.timeStamp) ||
      core.timeStamp < 0 || core.timeStamp > 86_400_000_000 ||
      (core.sourceMode !== 'learn' && core.sourceMode !== 'typing')) {
    throw new Error('outbox-invalid-immutable-attempt')
  }
  // JSON round trip removes optional undefined fields and any mutable proxy
  // wrappers, enforcing exactly serializable evidence before local commit.
  const plain = JSON.parse(JSON.stringify(core)) as IWordRecord
  stableWorkspaceJson(plain)
  return plain
}

export function stageOutboxAttempts(
  state: EventOutboxState, attempts: readonly IWordRecord[],
): EventOutboxState {
  assertScope(state)
  const evidence = new Map<string, string>()
  for (const row of [...state.pending, ...(state.inflight?.events ?? [])]) {
    if (!row.attemptId) throw new Error('outbox-corrupt-attempt')
    evidence.set(row.attemptId, stableWorkspaceJson(row))
  }
  const pending = [...state.pending]
  for (const row of attempts) {
    const next = immutableAttempt(row)
    const id = next.attemptId!
    const content = stableWorkspaceJson(next)
    const previous = evidence.get(id)
    if (previous !== undefined && previous !== content) {
      throw new Error('outbox-contradictory-attempt')
    }
    if (previous === undefined) {
      pending.push(next)
      evidence.set(id, content)
    }
  }
  return { ...state, pending }
}

export function reserveOutboxBatch(
  state: EventOutboxState, batchId: string,
): EventOutboxState {
  assertScope(state)
  if (state.inflight || state.pending.length === 0) return state
  if (!UUID.test(batchId)) throw new Error('outbox-invalid-batch-id')
  const chosen: IWordRecord[] = []
  for (const event of state.pending.slice(0, MAX_OUTBOX_BATCH_ROWS)) {
    const candidate = [...chosen, event]
    const bytes = new TextEncoder().encode(stableWorkspaceJson(candidate)).length
    if (bytes > MAX_OUTBOX_BATCH_BYTES) {
      if (!chosen.length) throw new Error('outbox-attempt-too-large')
      break
    }
    chosen.push(event)
  }
  const previous = state.confirmedHead
  return {
    ...state,
    inflight: {
      deviceId: state.deviceId,
      sequence: (previous?.sequence ?? 0) + 1,
      batchId,
      previous: previous ? { batchId: previous.batchId, sha256: previous.sha256 } : null,
      events: chosen,
    },
  }
}

/** Called ONLY after both POST and exact-key GET evidence have been validated. */
export function acknowledgeOutboxBatch(
  state: EventOutboxState, receipt: ChainedReceipt,
): EventOutboxState {
  assertScope(state)
  const batch = state.inflight
  if (!batch || !SHA.test(receipt.sha256) ||
      batch.deviceId !== receipt.deviceId ||
      batch.sequence !== receipt.sequence ||
      batch.batchId !== receipt.batchId) {
    throw new Error('outbox-receipt-does-not-match-inflight')
  }
  if (state.confirmedHead &&
      (state.confirmedHead.sequence + 1 !== receipt.sequence ||
       batch.previous?.batchId !== state.confirmedHead.batchId ||
       batch.previous?.sha256 !== state.confirmedHead.sha256)) {
    throw new Error('outbox-broken-predecessor-chain')
  }
  const committedIds = new Set(batch.events.map(row => row.attemptId))
  if (committedIds.size !== batch.events.length ||
      !batch.events.every(event =>
        state.pending.some(pending => pending.attemptId === event.attemptId &&
          stableWorkspaceJson(pending) === stableWorkspaceJson(event)))) {
    throw new Error('outbox-pending-evidence-missing')
  }
  return {
    ...state, inflight: null, confirmedHead: { ...receipt },
    pending: state.pending.filter(row => !committedIds.has(row.attemptId)),
  }
}
