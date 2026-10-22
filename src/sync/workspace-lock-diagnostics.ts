/** Read-only writer metadata. Never inspect learning tables or auth storage. */
import { WORKING_DB_LEASE_DATABASE, WORKING_DB_LOCK } from './workspace-lock'

async function inspectLease(): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: Record<string, unknown>) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timeout = window.setTimeout(() => finish({ state: 'unavailable', reason: 'timeout' }), 1500)
    const done = (value: Record<string, unknown>) => {
      window.clearTimeout(timeout)
      finish(value)
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(WORKING_DB_LEASE_DATABASE)
    } catch {
      done({ state: 'unavailable' })
      return
    }
    // Opening a nonexistent database would create it. Abort the upgrade instead.
    request.onupgradeneeded = () => {
      request.transaction?.abort()
    }
    request.onerror = () => done({ state: request.error?.name === 'AbortError' ? 'missing' : 'unavailable' })
    request.onblocked = () => done({ state: 'unavailable', reason: 'blocked' })
    request.onsuccess = () => {
      const db = request.result
      if (settled) {
        db.close()
        return
      }
      db.onversionchange = () => db.close()
      if (!db.objectStoreNames.contains('leases')) {
        db.close()
        done({ state: 'missing-store' })
        return
      }
      try {
        const tx = db.transaction('leases', 'readonly')
        const read = tx.objectStore('leases').get('working-db')
        let info: Record<string, unknown> = { state: 'missing' }
        read.onsuccess = () => {
          const row = read.result
          if (!row) return
          let sameTabOwner: boolean | null = null
          try {
            sameTabOwner = sessionStorage.getItem('qwerty.s1.writer-tab-token') === row.owner
          } catch {
            /* unavailable */
          }
          info = {
            state: 'present',
            kind: row.kind === 'native' || row.kind === 'fallback' ? row.kind : 'unknown',
            remainingMs: Number.isFinite(row.expiresAt) ? Math.round(row.expiresAt - Date.now()) : null,
            sameTabOwner,
          }
        }
        tx.oncomplete = () => {
          db.close()
          done(info)
        }
        tx.onerror = tx.onabort = () => {
          db.close()
          done({ state: 'unavailable' })
        }
      } catch {
        db.close()
        done({ state: 'unavailable' })
      }
    }
  })
}

export async function inspectWorkspaceWriter(): Promise<Record<string, unknown>> {
  let native: Record<string, unknown> = { supported: Boolean(navigator.locks) }
  if (navigator.locks?.query) {
    try {
      const state = await Promise.race([
        navigator.locks.query(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 1500)),
      ])
      native = {
        supported: true,
        held: state.held?.filter((lock) => lock.name === WORKING_DB_LOCK).length ?? 0,
        pending: state.pending?.filter((lock) => lock.name === WORKING_DB_LOCK).length ?? 0,
      }
    } catch {
      native = { supported: true, state: 'unavailable' }
    }
  }
  return { observedAt: new Date().toISOString(), native, lease: await inspectLease() }
}
