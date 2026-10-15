/**
 * Durable, local-only V4 import journal. Import is independent of S2 remote
 * revision; NEVER synthesize a cloud baseline from a local backup.
 *
 * Call stage/finalize exclusively pre-mount with the S1 Web Lock held.
 * The rollback backup and journal are committed in one IndexedDB transaction.
 */
import { openWorkspaceVault, workspaceRegistryPort } from './workspace-vault'
import { assertRestorableWorkspaceV4, parseWorkspaceV4, workspaceFingerprintV4 } from './workspace-v4'
import type { WorkspaceIdentityV4, WorkspaceSnapshotV4 } from './workspace-v4'
import { same } from './workspace-transition'
import { secureRandomUuid } from './sha256-compat'

const REGISTRY = 'registry'
const SNAPSHOTS = 'snapshots'
const HEAD = 'head'
const JOURNAL = 'manual-v4-import-journal:v1'
const S2_PULL = 'sync-v2-pull-journal:v1'
const BASELINE = 'sync-v2-baseline:'
const SHA256 = /^[a-f0-9]{64}$/

export type PendingManualV4Import = {
  version: 1
  /** Optional operation label; old journals without it remain fully valid. */
  purpose?: 'clear-local-learning'
  owner: WorkspaceIdentityV4
  originalOwner: WorkspaceIdentityV4
  registryGeneration: number
  fingerprint: string
  originalFingerprint: string
  rollbackKey: string
  snapshot: WorkspaceSnapshotV4
}

type StoredImport = Omit<PendingManualV4Import, 'snapshot'> & {
  snapshotJson: string
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('Manual V4 import IndexedDB error'))
  })
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Manual V4 import transaction failed'))
    tx.onerror = () => reject(tx.error ?? new Error('Manual V4 import transaction failed'))
  })
}
function parseStored(value: unknown): StoredImport {
  if (!value || typeof value !== 'object') throw new Error('Corrupt manual V4 import journal')
  const record = value as Partial<StoredImport>
  if (record.version !== 1 ||
      (record.purpose !== undefined && record.purpose !== 'clear-local-learning') ||
      !record.owner || !record.originalOwner ||
      !Number.isSafeInteger(record.registryGeneration) ||
      Number(record.registryGeneration) < 1 ||
      !SHA256.test(record.fingerprint ?? '') ||
      !SHA256.test(record.originalFingerprint ?? '') ||
      typeof record.rollbackKey !== 'string' ||
      !record.rollbackKey.startsWith('manual-import-rollback:') ||
      typeof record.snapshotJson !== 'string') {
    throw new Error('Invalid manual V4 import journal; writes blocked')
  }
  return record as StoredImport
}
async function checked(stored: StoredImport): Promise<PendingManualV4Import> {
  const snapshot = parseWorkspaceV4(stored.snapshotJson)
  assertRestorableWorkspaceV4(snapshot)
  if (!same(snapshot.metadata.source, stored.owner) ||
      await workspaceFingerprintV4(snapshot) !== stored.fingerprint) {
    throw new Error('Manual V4 journal payload or immutable owner mismatch')
  }
  const registry = await workspaceRegistryPort.read()
  if (registry.pending || registry.generation !== stored.registryGeneration ||
      !same(registry.active, stored.owner)) {
    throw new Error('Manual V4 import journal registry or owner changed')
  }
  return { ...stored, snapshot }
}

export const manualV4ImportJournalPort = {
  async read(): Promise<PendingManualV4Import | null> {
    const db = await openWorkspaceVault()
    let value: unknown
    try {
      const tx = db.transaction(REGISTRY, 'readonly')
      const done = complete(tx)
      value = await req<unknown>(tx.objectStore(REGISTRY).get(JOURNAL))
      await done
    } finally { db.close() }
    return value === undefined ? null : checked(parseStored(value))
  },

  async stage(input: {
    owner: WorkspaceIdentityV4
    originalOwner: WorkspaceIdentityV4
    registryGeneration: number
    original: WorkspaceSnapshotV4
    candidate: WorkspaceSnapshotV4
    purpose?: 'clear-local-learning'
  }): Promise<PendingManualV4Import> {
    const { owner, originalOwner, registryGeneration, original, candidate, purpose } = input
    assertRestorableWorkspaceV4(original)
    assertRestorableWorkspaceV4(candidate)
    if (!same(original.metadata.source, owner) ||
        !same(candidate.metadata.source, owner) ||
        !Number.isSafeInteger(registryGeneration) || registryGeneration < 1) {
      throw new Error('Manual V4 import destination ownership changed')
    }
    const [fingerprint, originalFingerprint] = await Promise.all([
      workspaceFingerprintV4(candidate), workspaceFingerprintV4(original),
    ])
    const rollbackKey = 'manual-import-rollback:' +
      (owner.kind === 'account' ? encodeURIComponent(owner.accountId) : 'anonymous') +
      ':' + secureRandomUuid()
    const stored: StoredImport = {
      version: 1, purpose, owner, originalOwner, registryGeneration, fingerprint,
      originalFingerprint, rollbackKey, snapshotJson: JSON.stringify(candidate),
    }
    const db = await openWorkspaceVault()
    try {
      const tx = db.transaction([REGISTRY, SNAPSHOTS], 'readwrite')
      const done = complete(tx)
      try {
        const registryStore = tx.objectStore(REGISTRY)
        const [head, pending, pendingPull] = await Promise.all([
          req<any>(registryStore.get(HEAD)),
          req<unknown>(registryStore.get(JOURNAL)),
          req<unknown>(registryStore.get(S2_PULL)),
        ])
        if (!head || head.generation !== registryGeneration || head.pending ||
            !same(head.active, owner) ||
            pending !== undefined || pendingPull !== undefined) {
          throw new Error('Manual V4 import conflicts with another S1/S2 transaction')
        }
        tx.objectStore(SNAPSHOTS).put({
          key: rollbackKey, json: JSON.stringify(original),
          fingerprint: originalFingerprint, storedAt: new Date().toISOString(),
        })
        registryStore.put(stored, JOURNAL)
        await done
      } catch (error) {
        try { tx.abort() } catch { /* transaction already finished */ }
        await done.catch(() => undefined)
        throw error
      }
    } finally { db.close() }
    return { ...stored, snapshot: candidate }
  },

  /**
   * Only after real RecordDB + settings have been re-read and verified.
   * Clear the target's prior cloud baseline ATOMICALLY with journal removal.
   * The independent rollback copy remains in the snapshots store.
   */
  async finalize(expected: PendingManualV4Import): Promise<void> {
    const db = await openWorkspaceVault()
    try {
      const tx = db.transaction([REGISTRY, SNAPSHOTS], 'readwrite')
      const done = complete(tx)
      try {
        const store = tx.objectStore(REGISTRY)
        const [raw, head, rollback] = await Promise.all([
          req<unknown>(store.get(JOURNAL)),
          req<any>(store.get(HEAD)),
          req<any>(tx.objectStore(SNAPSHOTS).get(expected.rollbackKey)),
        ])
        const stored = parseStored(raw)
        if (!head || head.pending ||
            head.generation !== expected.registryGeneration ||
            !same(head.active, expected.owner) ||
            stored.registryGeneration !== expected.registryGeneration ||
            !same(stored.owner, expected.owner) ||
            stored.fingerprint !== expected.fingerprint ||
            stored.originalFingerprint !== expected.originalFingerprint ||
            stored.rollbackKey !== expected.rollbackKey ||
            typeof rollback?.json !== 'string' ||
            rollback.fingerprint !== expected.originalFingerprint) {
          throw new Error('Manual V4 import finalize CAS/rollback safety check failed')
        }
        store.delete(JOURNAL)
        if (expected.owner.kind === 'account') {
          store.delete(BASELINE + encodeURIComponent(expected.owner.accountId))
        }
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already finished */ }
        await done.catch(() => undefined)
        throw error
      }
    } finally { db.close() }
  },
}
