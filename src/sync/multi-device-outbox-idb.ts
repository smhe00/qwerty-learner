/**
 * M3.6 durable origin-local, account-scoped event queue.
 * Never use localStorage/sessionStorage for this evidence or clear the queue
 * on logout. IDB readwrite transactions serialize competing tabs.
 * This is a pilot port, NOT an automatic Learn/Typing capture hook.
 */
import type { IWordRecord } from '@/utils/db/record'
import {
  acknowledgeOutboxBatch, initialEventOutbox, reserveOutboxBatch,
  stageOutboxAttempts,
} from './multi-device-outbox'
import type { ChainedReceipt, EventOutboxState } from './multi-device-outbox'

const DB = 'QwertyPlusEventOutboxV1'
const STORE = 'outboxes'
const DEVICE = /^qwerty-web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function scope(accountId: string, deviceId: string): string {
  if (!accountId || !DEVICE.test(deviceId)) throw new Error('outbox-invalid-scope')
  return JSON.stringify([accountId, deviceId])
}

function requested<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('outbox-idb-request-failed'))
  })
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('outbox-idb-aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('outbox-idb-failed'))
  })
}

async function openOutbox(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB, 1)
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains(STORE)) {
      req.result.createObjectStore(STORE)
    }
  }
  return requested(req)
}

/** Synchronous reducer: no await between read and write in a transaction. */
async function mutate(
  accountId: string,
  deviceId: string,
  reduce: (old: EventOutboxState) => EventOutboxState,
): Promise<EventOutboxState> {
  const key = scope(accountId, deviceId)
  const db = await openOutbox()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const done = committed(tx)
    try {
      const store = tx.objectStore(STORE)
      const stored = await requested<EventOutboxState | undefined>(store.get(key))
      if (stored && (stored.accountId !== accountId ||
        stored.deviceId !== deviceId || stored.version !== 1)) {
        throw new Error('outbox-scoped-owner-mismatch')
      }
      const next = reduce(stored ?? initialEventOutbox(accountId, deviceId))
      store.put(next, key)
      await done
      return next
    } catch (error) {
      try { tx.abort() } catch { /* already committed or aborted */ }
      await done.catch(() => undefined)
      throw error
    }
  } finally {
    db.close()
  }
}

export async function inspectEventOutbox(
  accountId: string, deviceId: string,
): Promise<EventOutboxState> {
  const key = scope(accountId, deviceId)
  const db = await openOutbox()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const done = committed(tx)
    const state = await requested<EventOutboxState | undefined>(
      tx.objectStore(STORE).get(key))
    await done
    return state ?? initialEventOutbox(accountId, deviceId)
  } finally { db.close() }
}

export function stageDurableAttempts(
  accountId: string, deviceId: string, attempts: readonly IWordRecord[],
): Promise<EventOutboxState> {
  return mutate(accountId, deviceId, state => stageOutboxAttempts(state, attempts))
}

export function reserveDurableBatch(
  accountId: string, deviceId: string, batchId: string,
): Promise<EventOutboxState> {
  return mutate(accountId, deviceId, state => reserveOutboxBatch(state, batchId))
}

export function confirmDurableBatch(
  accountId: string, deviceId: string, receipt: ChainedReceipt,
): Promise<EventOutboxState> {
  return mutate(accountId, deviceId, state => acknowledgeOutboxBatch(state, receipt))
}
