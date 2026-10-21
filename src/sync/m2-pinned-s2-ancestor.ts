/**
 * M2.8 local S2 Pull ancestor witness. Data is written only by the S2 Pull
 * journal's atomic (archive + baseline + journal-delete) finalize.
 *
 * Authenticated pull origin is warranted by the existing S2 transport,
 * account-bound remote readback and pre-mount recovery. This record proves
 * ONLY this browser's historical checkout; never assume a second device
 * checked out the same V4, or that a Blob listing is authoritative.
 */
import { openWorkspaceVault } from './workspace-vault'
import { assertRestorableWorkspaceV4, parseWorkspaceV4,
  workspaceFingerprintV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'

const REGISTRY = 'registry'
const SNAPSHOTS = 'snapshots'
const HEAD = 'head'
const BASELINE_PREFIX = 'sync-v2-baseline:'
const ANCESTOR_PREFIX = 'm2-s2pull-ancestor:'
const SHA = /^[0-9a-f]{64}$/

type StoredAncestor = {
  key: string
  version: 1
  accountId: string
  revision: number
  fingerprint: string
  registryGeneration: number
  snapshotJson: string
  storedAt: string
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('M2 ancestor vault read failed'))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('M2 ancestor vault tx aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('M2 ancestor vault tx failed'))
  })
}

export type LocalS2PullAncestor = {
  status: 'pinned-local-s2-pull-only'
  publishReady: false
  convergenceComplete: false
  accountId: string
  revision: number
  fingerprint: string
  snapshot: WorkspaceSnapshotV4
}

/** A null result means no historical S2 Pull pin was ever captured.
 * A mismatch or corrupt archive THROWS; it must not degrade into an
 * apparently empty ancestor that could silently delete valid history. */
export async function loadPinnedLocalS2PullAncestor(
  accountId: string,
): Promise<LocalS2PullAncestor | null> {
  if (!accountId || accountId.trim() !== accountId) {
    throw new Error('m2-ancestor-invalid-account')
  }
  const key = ANCESTOR_PREFIX + encodeURIComponent(accountId)
  const db = await openWorkspaceVault()
  let stored: unknown
  let registry: any
  let baseline: any
  try {
    const tx = db.transaction([REGISTRY, SNAPSHOTS], 'readonly')
    const complete = done(tx)
    const [pin, head, base] = await Promise.all([
      request<unknown>(tx.objectStore(SNAPSHOTS).get(key)),
      request<unknown>(tx.objectStore(REGISTRY).get(HEAD)),
      request<unknown>(tx.objectStore(REGISTRY).get(
        BASELINE_PREFIX + encodeURIComponent(accountId))),
    ])
    await complete
    stored = pin
    registry = head
    baseline = base
  } finally { db.close() }
  if (stored === undefined) return null
  const p = stored as Partial<StoredAncestor>
  if (!p || p.key !== key || p.version !== 1 ||
      p.accountId !== accountId ||
      !Number.isSafeInteger(p.revision) || Number(p.revision) < 1 ||
      !SHA.test(p.fingerprint ?? '') ||
      !Number.isSafeInteger(p.registryGeneration) ||
      Number(p.registryGeneration) < 1 ||
      typeof p.snapshotJson !== 'string' ||
      typeof p.storedAt !== 'string') {
    throw new Error('m2-ancestor-corrupt-archive')
  }
  if (!registry || registry.pending !== null ||
      !Number.isSafeInteger(registry.generation) ||
      registry.generation < p.registryGeneration! ||
      registry.active?.kind !== 'account' ||
      registry.active.accountId !== accountId) {
    throw new Error('m2-ancestor-registry-owner-changed')
  }
  if (!baseline || baseline.version !== 1 ||
      baseline.accountId !== accountId ||
      baseline.baseRevision !== p.revision ||
      baseline.logicalFingerprint !== p.fingerprint) {
    // A newer S2 Push/Noop/M4 restore invalidates the old active pin.
    throw new Error('m2-ancestor-stale-s2-baseline')
  }
  const snapshot = parseWorkspaceV4(p.snapshotJson!)
  assertRestorableWorkspaceV4(snapshot)
  if (snapshot.metadata.source.kind !== 'account' ||
      snapshot.metadata.source.accountId !== accountId ||
      await workspaceFingerprintV4(snapshot) !== p.fingerprint) {
    throw new Error('m2-ancestor-fingerprint-or-account-mismatch')
  }
  return {
    status: 'pinned-local-s2-pull-only',
    publishReady: false, convergenceComplete: false,
    accountId, revision: p.revision!, fingerprint: p.fingerprint!,
    snapshot,
  }
}
