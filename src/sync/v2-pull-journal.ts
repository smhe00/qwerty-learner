/**
 * Browser journal for S2 Pull, isolated from the S1 account-switch journal.
 *
 * Stages a fully verified V4 snapshot in the existing S1 vault registry
 * object store. No schema upgrade. Single journal per working RecordDB.
 * CAS+delete at completion is atomic with the account-specific baseline.
 * Must be called only while holding the exclusive S1 writer lease with
 * all RecordDB writers stopped. NEVER from legacy V1/UI directly.
 */
import { assertNextSyncV2Baseline, assertValidSyncV2Baseline } from './v2-baseline'
import { openWorkspaceVault, workspaceRegistryPort } from './workspace-vault'
import { parseWorkspaceV4, workspaceFingerprintV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import { same } from './workspace-transition'
import type { SyncV2Baseline } from './v2-policy'
import type { PendingSyncV2Pull, PullJournalPort } from './v2-pull-transaction'

const STORE = 'registry'
const HEAD = 'head'
const JOURNAL = 'sync-v2-pull-journal:v1'
const BASE_PREFIX = 'sync-v2-baseline:'
const SHA256 = /^[a-f0-9]{64}$/

type StoredPull = Omit<PendingSyncV2Pull, 'snapshot'> & { snapshotJson: string }
type RawBaseline = SyncV2Baseline & { version: 1; syncedAt: string }

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('V2 Pull vault request failed'))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('V2 Pull vault transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('V2 Pull vault transaction failed'))
  })
}
const baselineKey = (id: string) => BASE_PREFIX + encodeURIComponent(id)

function readBaseline(value: unknown, accountId: string): SyncV2Baseline | null {
  if (value === undefined) return null
  assertValidSyncV2Baseline(value, accountId)
  const record = value as RawBaseline
  if (record.version !== 1 || typeof record.syncedAt !== 'string') {
    throw new Error('Corrupt S2 baseline in Pull journal transaction')
  }
  return {
    accountId: record.accountId,
    baseRevision: record.baseRevision,
    logicalFingerprint: record.logicalFingerprint,
  }
}
function equalBaseline(a: SyncV2Baseline | null, b: SyncV2Baseline | null): boolean {
  return a === null ? b === null : b !== null &&
    a.accountId === b.accountId &&
    a.baseRevision === b.baseRevision &&
    a.logicalFingerprint === b.logicalFingerprint
}

function parseStored(value: unknown): StoredPull {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid S2 Pull journal record')
  }
  const record = value as Partial<StoredPull>
  if (record.version !== 1 ||
      typeof record.accountId !== 'string' || !record.accountId.trim() ||
      record.accountId.trim() !== record.accountId ||
      !Number.isSafeInteger(record.registryGeneration) || Number(record.registryGeneration) < 1 ||
      !Number.isSafeInteger(record.revision) || Number(record.revision) < 1 ||
      typeof record.fingerprint !== 'string' || !SHA256.test(record.fingerprint) ||
      typeof record.snapshotJson !== 'string') {
    throw new Error('Corrupt S2 Pull journal: write access blocked')
  }
  if (record.oldBaseline !== null) {
    assertValidSyncV2Baseline(record.oldBaseline, record.accountId)
    if (record.oldBaseline!.baseRevision >= record.revision!) {
      throw new Error('S2 Pull revision must advance the old baseline')
    }
  }
  return record as StoredPull
}

async function checked(record: StoredPull): Promise<PendingSyncV2Pull> {
  const snapshot = parseWorkspaceV4(record.snapshotJson)
  if (snapshot.metadata.source.kind !== 'account' ||
      snapshot.metadata.source.accountId !== record.accountId ||
      await workspaceFingerprintV4(snapshot) !== record.fingerprint) {
    throw new Error('S2 Pull journal snapshot integrity or immutable owner mismatch')
  }
  const registry = await workspaceRegistryPort.read()
  if (registry.generation !== record.registryGeneration ||
      registry.pending !== null ||
      !same(registry.active, { kind: 'account', accountId: record.accountId })) {
    throw new Error('S2 Pull journal conflicts with S1 account ownership')
  }
  return {
    version: 1, accountId: record.accountId,
    registryGeneration: record.registryGeneration,
    revision: record.revision,
    fingerprint: record.fingerprint,
    oldBaseline: record.oldBaseline,
    snapshot,
  }
}

export const syncV2PullJournalPort: PullJournalPort = {
  async read() {
    const db = await openWorkspaceVault()
    let value: unknown
    try {
      const tx = db.transaction(STORE, 'readonly')
      const complete = done(tx)
      value = await req<unknown>(tx.objectStore(STORE).get(JOURNAL))
      await complete
    } finally { db.close() }
    if (value === undefined) return null
    return checked(parseStored(value))
  },

  async stage(pending: PendingSyncV2Pull): Promise<void> {
    if (pending.snapshot.metadata.source.kind !== 'account' ||
        pending.snapshot.metadata.source.accountId !== pending.accountId ||
        !SHA256.test(pending.fingerprint) ||
        await workspaceFingerprintV4(pending.snapshot) !== pending.fingerprint ||
        !Number.isSafeInteger(pending.revision) || pending.revision < 1 ||
        !Number.isSafeInteger(pending.registryGeneration) ||
        pending.registryGeneration < 1 ||
        pending.version !== 1) {
      throw new Error('Invalid verified V4 Pull target')
    }
    const nextBase = { accountId: pending.accountId,
      baseRevision: pending.revision, logicalFingerprint: pending.fingerprint }
    assertNextSyncV2Baseline(pending.accountId, pending.oldBaseline, nextBase)
    const db = await openWorkspaceVault()
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const complete = done(tx)
      try {
        const store = tx.objectStore(STORE)
        const [existing, registry, base] = await Promise.all([
          req<unknown>(store.get(JOURNAL)),
          req<any>(store.get(HEAD)),
          req<unknown>(store.get(baselineKey(pending.accountId))),
        ])
        if (existing !== undefined ||
            !registry || registry.generation !== pending.registryGeneration ||
            registry.pending !== null ||
            !same(registry.active, { kind: 'account', accountId: pending.accountId }) ||
            !equalBaseline(readBaseline(base, pending.accountId), pending.oldBaseline)) {
          throw new Error('S2 Pull journal staging CAS/ownership conflict')
        }
        const stored: StoredPull = {
          version: 1, accountId: pending.accountId,
          registryGeneration: pending.registryGeneration,
          revision: pending.revision, fingerprint: pending.fingerprint,
          oldBaseline: pending.oldBaseline,
          snapshotJson: JSON.stringify(pending.snapshot),
        }
        store.put(stored, JOURNAL)
        await complete
      } catch (error) {
        try { tx.abort() } catch { /* finished */ }
        await complete.catch(() => undefined)
        throw error
      }
    } finally { db.close() }
  },

  async finalize(pending: PendingSyncV2Pull): Promise<void> {
    const db = await openWorkspaceVault()
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const complete = done(tx)
      try {
        const store = tx.objectStore(STORE)
        const [storedRaw, registry, baseRaw] = await Promise.all([
          req<unknown>(store.get(JOURNAL)),
          req<any>(store.get(HEAD)),
          req<unknown>(store.get(baselineKey(pending.accountId))),
        ])
        const stored = parseStored(storedRaw)
        if (stored.accountId !== pending.accountId ||
            stored.registryGeneration !== pending.registryGeneration ||
            stored.revision !== pending.revision ||
            stored.fingerprint !== pending.fingerprint ||
            !equalBaseline(stored.oldBaseline, pending.oldBaseline) ||
            !registry || registry.generation !== stored.registryGeneration ||
            registry.pending !== null ||
            !same(registry.active, { kind: 'account', accountId: pending.accountId }) ||
            !equalBaseline(readBaseline(baseRaw, pending.accountId), pending.oldBaseline)) {
          throw new Error('S2 Pull completion CAS/ownership conflict')
        }
        const nextBaseline: RawBaseline = {
          version: 1, accountId: pending.accountId,
          baseRevision: pending.revision, logicalFingerprint: pending.fingerprint,
          syncedAt: new Date().toISOString(),
        }
        assertNextSyncV2Baseline(pending.accountId, pending.oldBaseline, nextBaseline)
        store.put(nextBaseline, baselineKey(pending.accountId))
        store.delete(JOURNAL)
        await complete
      } catch (error) {
        try { tx.abort() } catch { /* finished */ }
        await complete.catch(() => undefined)
        throw error
      }
    } finally { db.close() }
  },
}
