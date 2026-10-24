/** Immutable, account-scoped pre-merge originals and candidate. No cloud IO. */
import { assertRestorableWorkspaceV4, parseWorkspaceV4, workspaceFingerprintV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import { openWorkspaceVault } from './workspace-vault'

export async function archiveAutomaticV4Merge(
  accountId: string,
  generation: number,
  local: WorkspaceSnapshotV4,
  remote: WorkspaceSnapshotV4,
  candidate: WorkspaceSnapshotV4,
): Promise<void> {
  const records = await Promise.all(
    [local, remote, candidate].map(async (snapshot) => {
      assertRestorableWorkspaceV4(snapshot)
      if (snapshot.metadata.source.kind !== 'account' || snapshot.metadata.source.accountId !== accountId) {
        throw Error('auto-merge-archive-owner-mismatch')
      }
      const fingerprint = await workspaceFingerprintV4(snapshot)
      return {
        key: 'auto-v4-merge:' + encodeURIComponent(accountId) + ':' + fingerprint,
        accountId,
        fingerprint,
        json: JSON.stringify(snapshot),
        storedAt: new Date().toISOString(),
      }
    }),
  )
  const vault = await openWorkspaceVault()
  try {
    const verified = new Map<string, string>()
    const existing = await new Promise<Array<(typeof records)[number]>>((resolve, reject) => {
      const tx = vault.transaction('snapshots', 'readonly')
      const found: Array<(typeof records)[number]> = []
      tx.oncomplete = () => resolve(found)
      tx.onabort = () => reject(tx.error ?? Error('auto-merge-archive-read-failed'))
      tx.onerror = () => reject(tx.error ?? Error('auto-merge-archive-read-failed'))
      for (const record of records) {
        const read = tx.objectStore('snapshots').get(record.key)
        read.onsuccess = () => {
          if (read.result) found.push(read.result)
        }
      }
    })
    for (const record of existing) {
      const snapshot = parseWorkspaceV4(record.json)
      if (
        snapshot.metadata.source.kind !== 'account' ||
        snapshot.metadata.source.accountId !== accountId ||
        record.accountId !== accountId ||
        (await workspaceFingerprintV4(snapshot)) !== record.fingerprint ||
        record.key !== 'auto-v4-merge:' + encodeURIComponent(accountId) + ':' + record.fingerprint
      ) {
        throw Error('auto-merge-original-archive-corrupt')
      }
      verified.set(record.key, record.json)
    }
    await new Promise<void>((resolve, reject) => {
      const tx = vault.transaction(['registry', 'snapshots'], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? Error('auto-merge-archive-aborted'))
      tx.onerror = () => reject(tx.error ?? Error('auto-merge-archive-failed'))
      const registry = tx.objectStore('registry').get('head')
      registry.onsuccess = () => {
        const value = registry.result
        if (
          value?.generation !== generation ||
          value.pending !== null ||
          value.active?.kind !== 'account' ||
          value.active.accountId !== accountId
        ) {
          tx.abort()
          return
        }
        const store = tx.objectStore('snapshots')
        for (const record of records) {
          const prior = store.get(record.key)
          prior.onsuccess = () => {
            // Existing content-addressed archive is retained, never replaced by
            // a later snapshot metadata timestamp.
            if (!prior.result) store.put(record)
            else if (
              prior.result.fingerprint !== record.fingerprint ||
              prior.result.accountId !== accountId ||
              prior.result.json !== verified.get(record.key)
            )
              tx.abort()
          }
        }
      }
    })
  } finally {
    vault.close()
  }
}
