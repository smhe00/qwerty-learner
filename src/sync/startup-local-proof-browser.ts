import { startupLocalDigest } from './startup-local-proof'
import type { StartupLocalProof } from './startup-local-proof'
import { DAILY_SESSION_PREFIX, REQUIRED_RESTORABLE_V4_TABLES, WORKSPACE_SETTING_KEYS } from './workspace-v4'
import { openWorkspaceVault } from './workspace-vault'
import { db } from '@/utils/db/core'

/** No schema upgrade and no portable backup/user rows in this disposable cache. */
async function access(accountId: string, value?: StartupLocalProof): Promise<StartupLocalProof | null> {
  const vault = await openWorkspaceVault()
  try {
    return await new Promise((resolve, reject) => {
      const tx = vault.transaction('registry', value ? 'readwrite' : 'readonly')
      const store = tx.objectStore('registry')
      const key = 'startup-local-proof:v1:' + encodeURIComponent(accountId)
      const request = value ? store.put(value, key) : store.get(key)
      let result: StartupLocalProof | null = null
      request.onsuccess = () => { if (!value) result = request.result ?? null }
      tx.oncomplete = () => resolve(result)
      tx.onabort = tx.onerror = () => reject(Error('startup-local-proof-unavailable'))
    })
  } finally {
    vault.close()
  }
}
export const startupLocalProofCache = {
  read: (accountId: string) => access(accountId),
  save: (accountId: string, value: StartupLocalProof) => access(accountId, value),
}

export async function readStartupLocalDigest(): Promise<string | null> {
  const tables = [...db.tables].sort((a, b) => a.name.localeCompare(b.name))
  if (REQUIRED_RESTORABLE_V4_TABLES.some(name => !tables.some(table => table.name === name))) return null
  // One read transaction includes every live table and its schema. No mapped
  // class constructors, Dexie export, gzip, scratch import or remote payload.
  const database = await db.transaction('r', tables, () => Promise.all(tables.map(async table => ({
    name: table.name,
    primaryKey: table.schema.primKey.src,
    indexes: table.schema.indexes.map(index => index.src),
    rows: await table.toCollection().raw().toArray(),
  }))))
  const keys = new Set<string>([...WORKSPACE_SETTING_KEYS, 'currentDict', 'currentChapter', 'reviewModeInfo'])
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key?.startsWith(DAILY_SESSION_PREFIX)) keys.add(key)
  }
  return startupLocalDigest({
    databaseVersion: db.verno,
    database,
    storage: Array.from(keys).sort().map(key => [key, localStorage.getItem(key)]),
  })
}
