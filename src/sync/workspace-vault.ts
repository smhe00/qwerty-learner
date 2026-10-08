/**
 * Durable isolated workspace registry/snapshot vault for S1.
 * It does not activate account switching or modify the existing RecordDB.
 * Cross-tab exclusive lock and writer quiescence remain mandatory callers'
 * responsibilities. Atomic CAS protects only registry metadata.
 */
import {
  parseWorkspaceV4,
  workspaceFingerprintV4,
} from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import {
  ANONYMOUS,
  initialRegistry,
  keyOf,
} from './workspace-transition'
import type { Registry, RegistryPort, Workspace } from './workspace-transition'

const DB_NAME = 'QwertyPlusWorkspaceVaultV1'
const VERSION = 1
const REGISTRY_STORE = 'registry'
const SNAPSHOTS_STORE = 'snapshots'
const HEAD = 'head'

type StoredSnapshot = {
  key: string
  json: string
  fingerprint: string
  storedAt: string
}

function request<T>(idbRequest: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result)
    idbRequest.onerror = () =>
      reject(idbRequest.error ?? new Error('IndexedDB request failed'))
  })
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

export async function openWorkspaceVault(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable')
  const open = indexedDB.open(DB_NAME, VERSION)
  open.onupgradeneeded = () => {
    const database = open.result
    if (!database.objectStoreNames.contains(REGISTRY_STORE)) {
      database.createObjectStore(REGISTRY_STORE)
    }
    if (!database.objectStoreNames.contains(SNAPSHOTS_STORE)) {
      database.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'key' })
    }
  }
  return request(open)
}

async function withVault<T>(
  body: (database: IDBDatabase) => Promise<T>,
): Promise<T> {
  const db = await openWorkspaceVault()
  try { return await body(db) } finally { db.close() }
}

export const workspaceRegistryPort: RegistryPort = {
  async read(): Promise<Registry> {
    return withVault(async database => {
      const tx = database.transaction(REGISTRY_STORE, 'readonly')
      const pending = completed(tx)
      const stored = await request<Registry | undefined>(
        tx.objectStore(REGISTRY_STORE).get(HEAD),
      )
      await pending
      return stored ?? initialRegistry()
    })
  },

  async compareAndSwap(expectedGeneration: number, next: Registry): Promise<void> {
    return withVault(async database => {
      const tx = database.transaction(REGISTRY_STORE, 'readwrite')
      const done = completed(tx)
      const store = tx.objectStore(REGISTRY_STORE)
      const prior = await request<Registry | undefined>(store.get(HEAD))
      const actual = prior ?? initialRegistry()
      if (actual.generation !== expectedGeneration ||
          next.generation !== expectedGeneration + 1 ||
          next.version !== 1) {
        tx.abort()
        await done.catch(() => undefined)
        throw new Error('Workspace registry CAS conflict')
      }
      store.put(next, HEAD)
      await done
    })
  },
}

/** Vault entries are never indexed by mutable usernames. */
export async function saveWorkspaceToVault(
  workspace: Workspace,
  snapshot: WorkspaceSnapshotV4,
): Promise<void> {
  const key = keyOf(workspace)
  const checked = parseWorkspaceV4(JSON.stringify(snapshot))
  if (keyOf(checked.metadata.source) !== key) {
    throw new Error('Workspace vault identity mismatch')
  }
  const record: StoredSnapshot = {
    key,
    json: JSON.stringify(checked),
    fingerprint: await workspaceFingerprintV4(checked),
    storedAt: new Date().toISOString(),
  }
  await withVault(async database => {
    const tx = database.transaction(SNAPSHOTS_STORE, 'readwrite')
    const done = completed(tx)
    tx.objectStore(SNAPSHOTS_STORE).put(record)
    await done
  })
}

/**
 * Null means never initialized; corruption raises and MUST NOT be interpreted
 * as an empty workspace. The caller must stop the switch and preserve data.
 */
export async function loadWorkspaceFromVault(
  workspace: Workspace,
): Promise<WorkspaceSnapshotV4 | null> {
  const key = keyOf(workspace)
  return withVault(async database => {
    const tx = database.transaction(SNAPSHOTS_STORE, 'readonly')
    const done = completed(tx)
    const record = await request<StoredSnapshot | undefined>(
      tx.objectStore(SNAPSHOTS_STORE).get(key),
    )
    await done
    if (!record) return null
    if (record.key !== key || typeof record.json !== 'string' ||
        typeof record.fingerprint !== 'string') {
      throw new Error('Corrupt workspace vault record')
    }
    const snapshot = parseWorkspaceV4(record.json)
    if (keyOf(snapshot.metadata.source) !== key ||
        await workspaceFingerprintV4(snapshot) !== record.fingerprint) {
      throw new Error('Workspace vault integrity mismatch')
    }
    return snapshot
  })
}

/** Metadata snapshot only. No account/auth side effects. */
export async function currentVaultRegistry(): Promise<Registry> {
  const registry = await workspaceRegistryPort.read()
  if (!registry.active) return { ...registry, active: ANONYMOUS }
  return registry
}
