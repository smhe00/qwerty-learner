/**
 * S2-P2a durable, immutable-account-scoped cloud sync baseline.
 *
 * Baselines are synchronization metadata, NOT part of Backup V4 portable
 * workspaceData, and NOT the legacy V1 localStorage baseline. Store alongside
 * the S1 registry in the existing vault object store using a separate key;
 * avoid any IndexedDB schema upgrade or loss of the S1 pending journal.
 *
 * Only a future guarded executor (owning the S1 writer lease and completing
 * its remote transfer/restore) may commit a new baseline.
 */
import { openWorkspaceVault } from './workspace-vault'
import type { SyncV2Baseline } from './v2-policy'

const STORE = 'registry'
const KEY_PREFIX = 'sync-v2-baseline:'
type RecordV1 = SyncV2Baseline & { version: 1; syncedAt: string }

function key(accountId: string): string {
  if (!accountId || !accountId.trim() || accountId !== accountId.trim()) {
    throw new Error('S2 baseline needs a canonical immutable account ID')
  }
  return KEY_PREFIX + encodeURIComponent(accountId)
}

export function assertValidSyncV2Baseline(
  baseline: unknown,
  accountId: string,
): asserts baseline is SyncV2Baseline {
  key(accountId)
  if (typeof baseline !== 'object' || baseline === null) {
    throw new Error('S2 baseline is missing or corrupt')
  }
  const item = baseline as Partial<SyncV2Baseline>
  if (item.accountId !== accountId ||
      !Number.isSafeInteger(item.baseRevision) || Number(item.baseRevision) < 0 ||
      typeof item.logicalFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.logicalFingerprint)) {
    throw new Error('S2 account-scoped baseline is corrupt or mismatched')
  }
}

function decode(value: unknown, accountId: string): RecordV1 | null {
  if (value === undefined) return null
  assertValidSyncV2Baseline(value, accountId)
  const record = value as RecordV1
  if (record.version !== 1 || typeof record.syncedAt !== 'string') {
    throw new Error('Unknown/corrupt S2 baseline format')
  }
  return record
}

export function assertNextSyncV2Baseline(
  accountId: string,
  previous: SyncV2Baseline | null,
  next: SyncV2Baseline,
): void {
  assertValidSyncV2Baseline(next, accountId)
  if (previous) {
    assertValidSyncV2Baseline(previous, accountId)
    if (next.baseRevision < previous.baseRevision) {
      throw new Error('S2 baseline revision regression refused')
    }
    if (next.baseRevision === previous.baseRevision &&
        next.logicalFingerprint !== previous.logicalFingerprint) {
      throw new Error('S2 baseline fingerprint changed without cloud revision')
    }
  }
}

function request<T>(item: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    item.onsuccess = () => resolve(item.result)
    item.onerror = () => reject(item.error ?? new Error('S2 baseline IDB request failed'))
  })
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('S2 baseline transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('S2 baseline transaction failed'))
  })
}

export async function loadSyncV2Baseline(
  accountId: string,
): Promise<SyncV2Baseline | null> {
  const k = key(accountId)
  const db = await openWorkspaceVault()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const done = completed(tx)
    const stored = await request<unknown>(tx.objectStore(STORE).get(k))
    await done
    const record = decode(stored, accountId)
    return record === null ? null : {
      accountId: record.accountId,
      baseRevision: record.baseRevision,
      logicalFingerprint: record.logicalFingerprint,
    }
  } finally { db.close() }
}

/**
 * CAS of both revision and logical hash prevents committing a remote result
 * derived from a stale local baseline (including same-revision corruption).
 * The caller must own the S1 writer lease. No network is performed here.
 */
export async function compareAndSwapSyncV2Baseline(
  accountId: string,
  expected: SyncV2Baseline | null,
  next: SyncV2Baseline,
): Promise<void> {
  const k = key(accountId)
  if (expected) assertValidSyncV2Baseline(expected, accountId)
  assertNextSyncV2Baseline(accountId, expected, next)
  const db = await openWorkspaceVault()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const done = completed(tx)
    try {
      const store = tx.objectStore(STORE)
      const actual = decode(await request<unknown>(store.get(k)), accountId)
      if ((actual === null) !== (expected === null) ||
          (actual !== null && expected !== null &&
           (actual.baseRevision !== expected.baseRevision ||
            actual.logicalFingerprint !== expected.logicalFingerprint))) {
        throw new Error('S2 baseline CAS conflict')
      }
      store.put({ ...next, version: 1, syncedAt: new Date().toISOString() }, k)
      await done
    } catch (error) {
      if (tx.readyState === 'active') tx.abort()
      await done.catch(() => undefined)
      throw error
    }
  } finally { db.close() }
}
