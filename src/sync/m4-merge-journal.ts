/**
 * M4 browser journal port: stage a complete V4 rollback + candidate in one
 * atomic IndexedDB transaction in the existing S1 vault.
 *
 * NOT yet wired into boot or Learn. MUST NOT stage until authenticated
 * ancestry, complete six-table candidate, writer quiescence and S1 exclusive
 * lock have been verified by an independent caller. Vault CAS alone cannot
 * serialize RecordDB, localStorage or multi-POP EdgeOne operations.
 */
import { openWorkspaceVault } from './workspace-vault'
import { parseWorkspaceV4, workspaceFingerprintV4 } from './workspace-v4'
import { validatePendingM4Merge } from './m4-merge-transaction'
import { secureRandomUuid } from './sha256-compat'
import type { M4Decision, M4JournalPort, PendingM4Merge } from './m4-merge-transaction'

const REGISTRY = 'registry'
const SNAPSHOTS = 'snapshots'
const HEAD = 'head'
const JOURNAL = 'sync-m4-merge-journal:v1'
const MANUAL = 'manual-v4-import-journal:v1'
const PULL = 'sync-v2-pull-journal:v1'
const BASELINE = 'sync-v2-baseline:'
const ROLLBACK = 'm4-merge-rollback:'
const SHA = /^[0-9a-f]{64}$/

type Stored = Omit<PendingM4Merge, 'candidate' | 'original'> & {
  candidateJson: string
  rollbackKey: string
}
type SnapshotStored = {
  key: string
  json: string
  fingerprint: string
  storedAt: string
}
function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('M4 vault request failed'))
  })
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('M4 vault transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('M4 vault transaction failed'))
  })
}
function sameAccount(head: any, p: {
  accountId: string; registryGeneration: number
}): boolean {
  return !!head && head.pending === null &&
    head.generation === p.registryGeneration &&
    head.active?.kind === 'account' &&
    head.active.accountId === p.accountId
}
function parseStored(input: unknown): Stored {
  if (!input || typeof input !== 'object') {
    throw new Error('m4-corrupt-journal')
  }
  const p = input as Partial<Stored>
  if (p.version !== 1 || typeof p.accountId !== 'string' ||
      !p.accountId.trim() || p.accountId.trim() !== p.accountId ||
      !Number.isSafeInteger(p.registryGeneration) ||
      (p.registryGeneration ?? 0) < 1 ||
      !SHA.test(p.originalFingerprint ?? '') ||
      !SHA.test(p.candidateFingerprint ?? '') ||
      typeof p.candidateJson !== 'string' ||
      typeof p.rollbackKey !== 'string' ||
      !p.rollbackKey.startsWith(ROLLBACK + encodeURIComponent(p.accountId) + ':')) {
    throw new Error('m4-corrupt-journal')
  }
  return p as Stored
}
function parseRollback(input: unknown, key: string, fingerprint: string): SnapshotStored {
  if (!input || typeof input !== 'object') {
    throw new Error('m4-rollback-archive-missing')
  }
  const record = input as Partial<SnapshotStored>
  if (record.key !== key || typeof record.json !== 'string' ||
      record.fingerprint !== fingerprint) {
    throw new Error('m4-rollback-archive-corrupt')
  }
  return record as SnapshotStored
}
function journalMatches(record: Stored, expected: PendingM4Merge): boolean {
  return record.version === expected.version &&
    record.accountId === expected.accountId &&
    record.registryGeneration === expected.registryGeneration &&
    record.originalFingerprint === expected.originalFingerprint &&
    record.candidateFingerprint === expected.candidateFingerprint
}

/** Does not mutate local state or delete corrupted journals on read. */
export const m4MergeJournalPort: M4JournalPort = {
  async read(): Promise<PendingM4Merge | null> {
    const db = await openWorkspaceVault()
    let stored: Stored | undefined
    let rollback: SnapshotStored | undefined
    try {
      const tx = db.transaction([REGISTRY, SNAPSHOTS], 'readonly')
      const finished = done(tx)
      const raw = await request<unknown>(tx.objectStore(REGISTRY).get(JOURNAL))
      if (raw === undefined) {
        await finished
        return null
      }
      stored = parseStored(raw)
      const [snap, head] = await Promise.all([
        request<unknown>(tx.objectStore(SNAPSHOTS).get(stored.rollbackKey)),
        request<any>(tx.objectStore(REGISTRY).get(HEAD)),
      ])
      rollback = parseRollback(snap, stored.rollbackKey, stored.originalFingerprint)
      if (!sameAccount(head, stored)) {
        throw new Error('m4-registry-owner-changed')
      }
      await finished
    } finally { db.close() }
    // A complete SHA check is independent of registry metadata.
    const pending: PendingM4Merge = {
      version: 1,
      accountId: stored!.accountId,
      registryGeneration: stored!.registryGeneration,
      originalFingerprint: stored!.originalFingerprint,
      candidateFingerprint: stored!.candidateFingerprint,
      original: parseWorkspaceV4(rollback!.json),
      candidate: parseWorkspaceV4(stored!.candidateJson),
    }
    await validatePendingM4Merge(pending)
    return pending
  },

  async stage(pending: PendingM4Merge): Promise<void> {
    await validatePendingM4Merge(pending)
    const rollbackKey = ROLLBACK + encodeURIComponent(pending.accountId) +
      ':' + secureRandomUuid()
    const stored: Stored = {
      version: 1, accountId: pending.accountId,
      registryGeneration: pending.registryGeneration,
      originalFingerprint: pending.originalFingerprint,
      candidateFingerprint: pending.candidateFingerprint,
      candidateJson: JSON.stringify(pending.candidate),
      rollbackKey,
    }
    const original: SnapshotStored = {
      key: rollbackKey,
      json: JSON.stringify(pending.original),
      fingerprint: pending.originalFingerprint,
      storedAt: new Date().toISOString(),
    }
    const db = await openWorkspaceVault()
    try {
      const tx = db.transaction([REGISTRY, SNAPSHOTS], 'readwrite')
      const finished = done(tx)
      try {
        const registry = tx.objectStore(REGISTRY)
        const [head, self, manual, pull] = await Promise.all([
          request<any>(registry.get(HEAD)),
          request<unknown>(registry.get(JOURNAL)),
          request<unknown>(registry.get(MANUAL)),
          request<unknown>(registry.get(PULL)),
        ])
        if (!sameAccount(head, pending) || self !== undefined ||
            manual !== undefined || pull !== undefined) {
          throw new Error('m4-conflicting-s1-or-s2-journal')
        }
        tx.objectStore(SNAPSHOTS).put(original)
        registry.put(stored, JOURNAL)
        await finished
      } catch (error) {
        try { tx.abort() } catch { /* transaction settled */ }
        await finished.catch(() => undefined)
        throw error
      }
    } finally { db.close() }
  },

  async finalize(pending: PendingM4Merge, decision: M4Decision): Promise<void> {
    if (decision !== 'apply' && decision !== 'rollback') {
      throw new Error('m4-invalid-recovery-decision')
    }
    await validatePendingM4Merge(pending)
    const db = await openWorkspaceVault()
    try {
      const tx = db.transaction([REGISTRY, SNAPSHOTS], 'readwrite')
      const finished = done(tx)
      try {
        const registry = tx.objectStore(REGISTRY)
        const raw = await request<unknown>(registry.get(JOURNAL))
        const record = parseStored(raw)
        const [head, rollback, manual, pull] = await Promise.all([
          request<any>(registry.get(HEAD)),
          request<unknown>(tx.objectStore(SNAPSHOTS).get(record.rollbackKey)),
          request<unknown>(registry.get(MANUAL)),
          request<unknown>(registry.get(PULL)),
        ])
        const rollbackStored = parseRollback(
          rollback, record.rollbackKey, pending.originalFingerprint,
        )
        // Never await a SHA computation inside a live IDB transaction.
        // Exact serialization matches the same staged snapshots that were
        // already fingerprint-verified before this transaction opened.
        if (!sameAccount(head, pending) || !journalMatches(record, pending) ||
            manual !== undefined || pull !== undefined ||
            rollbackStored.json !== JSON.stringify(pending.original) ||
            record.candidateJson !== JSON.stringify(pending.candidate)) {
          throw new Error('m4-finalize-cas-conflict')
        }
        // Rollback archive is RETAINED after the journal is removed.
        // Applying a merge invalidates the old S2 full-snapshot baseline;
        // this does NOT publish to cloud or claim remote convergence.
        registry.delete(JOURNAL)
        if (decision === 'apply') {
          registry.delete(BASELINE + encodeURIComponent(pending.accountId))
        }
        await finished
      } catch (error) {
        try { tx.abort() } catch { /* transaction settled */ }
        await finished.catch(() => undefined)
        throw error
      }
    } finally { db.close() }
  },
}
