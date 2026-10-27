/** Disposable cache only. Never a workspace journal or authority to merge. */
import type { WitnessedBatchReadback } from './m3-witnessed-receiver'
import type { ChainedReceipt } from './multi-device-outbox'

export type HistoryCheckpoint = {
  scope: string
  ownerScope: string
  heads: ChainedReceipt[]
  cursor?: string
  verified: number
  total: number
  batches: Record<string, WitnessedBatchReadback>
}
export interface HistoryCachePort {
  read(accountId: string): Promise<HistoryCheckpoint | undefined>
  save(accountId: string, value: HistoryCheckpoint): Promise<void>
}
async function access<T>(accountId: string, value?: HistoryCheckpoint): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('QwertyHistoryVerificationV1', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('checkpoints')
    open.onerror = () => reject(Error('verification-local-checkpoint-failed'))
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('checkpoints', value ? 'readwrite' : 'readonly')
      const store = tx.objectStore('checkpoints')
      const request = value ? store.put(value, accountId) : store.get(accountId)
      let result: T
      request.onsuccess = () => {
        result = request.result as T
      }
      tx.oncomplete = () => {
        db.close()
        resolve(result)
      }
      tx.onabort = tx.onerror = () => {
        db.close()
        reject(Error('verification-local-checkpoint-failed'))
      }
    }
  })
}
export const historyCache: HistoryCachePort = {
  read: (accountId) => access(accountId),
  save: async (accountId, value) => {
    await access(accountId, value)
  },
}
