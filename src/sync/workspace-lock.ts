/**
 * S1 single-writer ownership for the mounted working RecordDB.
 *
 * Web Locks is the preferred lifetime lock, but it is unavailable in some
 * otherwise supported browsers/webviews. All modern tabs also acquire an
 * IndexedDB transactional lease so a Web-Locks-less tab participates in the
 * SAME writer election. Never silently proceed without an exclusive lease.
 *
 * A short, renewed IDB lease allows recovery after a browser crash. On loss
 * of ownership (including background-tab suspension), the stale document is
 * reloaded before it can be used again. Neither the lock nor its renewal
 * touches learning tables or user data.
 */
export type WorkingDbLease = { release(): void }
export const WORKING_DB_LOCK = 'qwerty-plus.s1.working-db-writer'
export const WORKING_DB_LEASE_DATABASE = 'QwertyPlusWriterLeaseV1'

const STORE = 'leases'
const KEY = 'working-db'
const TAB_OWNER_KEY = 'qwerty.s1.writer-tab-token'
const PRESENCE_CHANNEL = 'qwerty-plus.s1.writer-presence'
const TTL_MS = 15_000
const RENEW_MS = 2_000

type LeaseRow = { key: string; owner: string; instance: string; expiresAt: number }

function randomToken(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Secure random API unavailable: S1 writer ownership refused')
  }
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),
    byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * sessionStorage survives reload in the SAME tab. A copied/duplicated tab
 * may inherit that token too: challenge the previous document over a
 * BroadcastChannel before accepting a same-tab reacquisition.
 */
async function tabOwner(): Promise<string> {
  if (typeof BroadcastChannel === 'undefined') return randomToken()
  const existing = sessionStorage.getItem(TAB_OWNER_KEY)
  if (existing && /^[0-9a-f]{32}$/.test(existing)) {
    const channel = new BroadcastChannel(PRESENCE_CHANNEL)
    const challenge = randomToken()
    const active = await new Promise<boolean>(resolve => {
      let finished = false
      const complete = (value: boolean) => {
        if (finished) return
        finished = true
        channel.close()
        resolve(value)
      }
      channel.onmessage = event => {
        const data = event.data as { kind?: string; owner?: string; challenge?: string }
        if (data?.kind === 'alive' && data.owner === existing &&
            data.challenge === challenge) complete(true)
      }
      channel.postMessage({ kind: 'probe', owner: existing, challenge })
      window.setTimeout(() => complete(false), 120)
    })
    if (active) throw new Error('Another tab owns the active workspace writer lease')
    return existing
  }
  return randomToken()
}
type LeaseAction = 'acquire' | 'renew' | 'release'

function openLeaseDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable: S1 writer ownership refused'))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKING_DB_LEASE_DATABASE, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ??
      Error('IndexedDB writer lease initialization failed'))
    request.onblocked = () => reject(Error('IndexedDB writer lease upgrade blocked by another tab'))
  })
}

/** A read/compare/write in ONE readwrite transaction is atomic across tabs. */
function updateLease(db: IDBDatabase, owner: string, instance: string, action: LeaseAction): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const request = store.get(KEY)
    let accepted = false
    request.onsuccess = () => {
      const current = request.result as LeaseRow | undefined
      if (action === 'release') {
        if (current?.owner === owner && current.instance === instance) store.delete(KEY)
        accepted = true
      } else if (action === 'renew') {
        if (current?.owner === owner && current.instance === instance) {
          store.put({ key: KEY, owner, instance, expiresAt: Date.now() + TTL_MS })
          accepted = true
        }
      } else if (!current || current.owner === owner ||
                 current.expiresAt <= Date.now()) {
        store.put({ key: KEY, owner, instance, expiresAt: Date.now() + TTL_MS })
        accepted = true
      }
    }
    request.onerror = () => reject(request.error ?? Error('Cannot inspect writer lease'))
    tx.oncomplete = () => resolve(accepted)
    tx.onerror = () => reject(tx.error ?? Error('Writer lease transaction failed'))
    tx.onabort = () => reject(tx.error ?? Error('Writer lease transaction aborted'))
  })
}

async function acquireIndexedDbWriterLease(): Promise<WorkingDbLease> {
  const owner = await tabOwner()
  const instance = randomToken()
  const db = await openLeaseDatabase()
  let acquired = false
  try {
    acquired = await updateLease(db, owner, instance, 'acquire')
  } catch (error) {
    db.close()
    throw error
  }
  if (!acquired) {
    db.close()
    throw new Error('Another tab owns the active workspace writer lease')
  }

  const presence = typeof BroadcastChannel === 'undefined'
    ? undefined : new BroadcastChannel(PRESENCE_CHANNEL)
  if (presence) {
    presence.onmessage = event => {
      const data = event.data as { kind?: string; owner?: string; challenge?: string }
      if (data?.kind === 'probe' && data.owner === owner) {
        presence.postMessage({ kind: 'alive', owner, challenge: data.challenge })
      }
    }
    sessionStorage.setItem(TAB_OWNER_KEY, owner)
  }

  let released = false
  let checking = false
  const release = () => {
    if (released) return
    released = true
    clearInterval(interval)
    presence?.close()
    window.removeEventListener('unload', release)
    window.removeEventListener('focus', check)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    void updateLease(db, owner, instance, 'release').catch(() => {
      // Abandoned leases expire after TTL; never mutate learning data here.
    }).finally(() => db.close())
  }
  const ownershipLost = () => {
    if (released) return
    // Never keep a possibly stale mounted writer alive after lease loss.
    released = true
    clearInterval(interval)
    presence?.close()
    window.removeEventListener('unload', release)
    window.removeEventListener('focus', check)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    db.close()
    window.location.reload()
  }
  const check = () => {
    if (released || checking) return
    checking = true
    void updateLease(db, owner, instance, 'renew')
      .then(ok => { if (!ok) ownershipLost() })
      .catch(() => ownershipLost())
      .finally(() => { checking = false })
  }
  const onVisibilityChange = () => {
    if (!document.hidden) check()
  }
  const interval = window.setInterval(check, RENEW_MS)
  // Do not release on pagehide: a BFCache page can retain pending DB writers.
  // Unload runs only for torn-down documents; TTL handles crashes and mobile.
  window.addEventListener('unload', release)
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', onVisibilityChange)
  return { release }
}

function acquireNativeWebLock(): Promise<WorkingDbLease> {
  let releaseHold: (() => void) | undefined
  const hold = new Promise<void>(resolve => { releaseHold = resolve })
  let resolved = false

  return new Promise<WorkingDbLease>((resolve, reject) => {
    void navigator.locks.request(
      WORKING_DB_LOCK,
      { mode: 'exclusive', ifAvailable: true },
      async lock => {
        if (!lock) {
          resolved = true
          reject(new Error('Another tab owns the active workspace writer lease'))
          return
        }
        let released = false
        resolved = true
        resolve({
          release: () => {
            if (released) return
            released = true
            releaseHold?.()
          },
        })
        await hold
      },
    ).catch(error => {
      if (!resolved) reject(error)
    })
  })
}

export async function acquireWorkspaceWriterLease(): Promise<WorkingDbLease> {
  // Acquire this for BOTH supported and unsupported Web Locks browsers.
  // Otherwise one class of tabs could write while the other held a lock.
  const idbLease = await acquireIndexedDbWriterLease()
  if (typeof navigator === 'undefined' || !navigator.locks) return idbLease

  let nativeLease: WorkingDbLease
  try {
    nativeLease = await acquireNativeWebLock()
  } catch (error) {
    if (error instanceof Error &&
        error.message === 'Another tab owns the active workspace writer lease') {
      idbLease.release()
      throw error
    }
    // API may exist yet be disabled by a browser policy. The transactional
    // IndexedDB lease still provides shared writer election.
    return idbLease
  }
  return {
    release: () => {
      nativeLease.release()
      idbLease.release()
    },
  }
}
