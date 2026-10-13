/**
 * First-login S1 fresh-origin eligibility check.
 *
 * This is READ ONLY and must be called under the pre-mount Web Lock. It is
 * intentionally stricter than "no wordRecords": ANY old IndexedDB row,
 * pending Learn state, auth identity, unknown Qwerty storage marker, or
 * uncertainty requires the existing explicit V1 ownership confirmation.
 *
 * A new EdgeOne origin with empty data must not claim it migrated a V1
 * learning history that never existed.
 */
import { DAILY_SESSION_PREFIX, S1_MIGRATION_WITNESS_KEY, WORKSPACE_SETTING_KEYS } from './workspace-v4'

const SAFE_PREFERENCES = new Set<string>([
  ...WORKSPACE_SETTING_KEYS,
  'currentDict',
  'currentChapter',
  'reviewModeInfo',
])
const KNOWN_DATABASES = new Set(['RecordDB', 'QwertyPlusWorkspaceVaultV1'])

async function storeIsEmpty(db: IDBDatabase, name: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readonly')
    const request = tx.objectStore(name).count()
    let result = false
    request.onsuccess = () => { result = request.result === 0 }
    request.onerror = () => reject(request.error ?? Error('Cannot count legacy IndexedDB records'))
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(tx.error ?? Error('Legacy IndexedDB check aborted'))
    tx.onerror = () => reject(tx.error ?? Error('Legacy IndexedDB check failed'))
  })
}

async function databaseIsEmpty(name: string): Promise<boolean> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? Error('Cannot open legacy IndexedDB'))
    request.onblocked = () => reject(Error('Legacy IndexedDB is blocked by another tab'))
  })
  try {
    // Inspect *every* store, including legacy revision and future tables.
    // Never infer a safe migration from an empty wordRecords table alone.
    for (const store of Array.from(db.objectStoreNames)) {
      if (!await storeIsEmpty(db, store)) return false
    }
    return true
  } finally {
    db.close()
  }
}

/**
 * Returns false (fail closed) on unsupported IDB introspection, malformed
 * local state or any inspection error. This never modifies or clears data.
 */
export async function isFreshEmptyLegacyWorkspace(): Promise<boolean> {
  try {
    if (localStorage.getItem(S1_MIGRATION_WITNESS_KEY) !== null ||
        localStorage.getItem('qwerty.cloudAuth.v1') !== null ||
        localStorage.getItem('qwerty.s1.auth-transition.v1') !== null ||
        sessionStorage.getItem('qwerty.s1.foreign-storage-clear-blocked') === '1') {
      return false
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) return false
      if (key.startsWith(DAILY_SESSION_PREFIX)) return false
      // Unknown Qwerty persisted state can hold old learning ownership.
      if (key.startsWith('qwerty.') && !SAFE_PREFERENCES.has(key)) return false
    }
    const reviewRaw = localStorage.getItem('reviewModeInfo')
    if (reviewRaw !== null) {
      const parsed = JSON.parse(reviewRaw) as unknown
      // Jotai JSON.stringify omits reviewRecord when it is undefined.
      // Both an absent field and an explicit null mean no active checkpoint.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
          typeof (parsed as { isReviewMode?: unknown }).isReviewMode !== 'boolean' ||
          ('reviewRecord' in parsed &&
            (parsed as { reviewRecord?: unknown }).reviewRecord != null)) {
        return false
      }
    }
    // In a browser without databases() we cannot prove no legacy data.
    if (typeof indexedDB.databases !== 'function') return false
    const databases = await indexedDB.databases()
    for (const entry of databases) {
      if (!entry.name || !KNOWN_DATABASES.has(entry.name)) return false
      if (!await databaseIsEmpty(entry.name)) return false
    }
    return true
  } catch {
    return false
  }
}
