/**
 * S1 guarded bootstrap primitive. Call this BEFORE dynamically importing the
 * mounted app and BEFORE any working-DB or Jotai writers can initialize.
 *
 * The V1-compatible entry uses allowLegacy only for an uninitialized
 * registry. It never migrates or switches an account implicitly.
 */
import { loadAuth, setIsolatedAuthRetention } from './auth'
import { S1_MIGRATION_WITNESS_KEY } from './workspace-v4'
import {
  assertWorkspaceMigrationWitness,
  installWorkspaceStorageWriterGuard,
  refreshWorkspaceMigrationWitness,
} from './workspace-storage-witness'
import { acquireWorkspaceWriterLease } from './workspace-lock'
import { same } from './workspace-transition'
import type { Registry, Workspace } from './workspace-transition'
import { workspaceRegistryPort } from './workspace-vault'

export type WorkspaceBootStage =
  | 'locking'
  | 'recovering'
  | 'restart-required'
  | 'checking-identity'
  | 'ready'
  | 'blocked'

export type GuardedWorkspaceBoot = {
  mode: 'legacy' | 'isolated'
  registry: Registry
  /** Only call after all mounted writers have stopped and flushed. */
  release(): void
}

function report(
  onStage: ((stage: WorkspaceBootStage) => void) | undefined,
  stage: WorkspaceBootStage,
): void {
  try { onStage?.(stage) } catch { /* Observers cannot bypass safety gates. */ }
}

/**
 * Fail closed for a never-migrated V1 working DB or an auth/registry mismatch.
 * A pending journal is recovered without mounting; a new page load is then
 * mandatory to discard any module-level storage caches initialized by restore.
 * The exclusive lease is held until the owning tab explicitly releases it.
 */
export async function prepareGuardedWorkspaceBoot(
  onStage?: (stage: WorkspaceBootStage) => void,
  options: { allowLegacy?: boolean } = {},
): Promise<GuardedWorkspaceBoot> {
  report(onStage, 'locking')
  const lease = await acquireWorkspaceWriterLease().catch(error => {
    report(onStage, 'blocked')
    throw error
  })

  let recovered = false
  try {
    const before = await workspaceRegistryPort.read()
    if (before.generation === 0) {
      // An already-migrated browser must never silently fall back to V1
      // when its isolated IndexedDB registry has been removed or corrupted.
      if (localStorage.getItem(S1_MIGRATION_WITNESS_KEY) !== null) {
        throw new Error('S1 vault registry missing but migration witness remains: legacy fallback refused')
      }
      setIsolatedAuthRetention(false)
      if (before.pending) throw new Error('Invalid uninitialized workspace journal')
      if (!options.allowLegacy) {
        throw new Error('S1 workspace is not initialized: explicit V1 migration is required')
      }
      // One-writer V1 compatibility: never assign ownership or migrate here.
      // Login/logout retains V1 behavior until the explicit S1 consent flow.
      report(onStage, 'ready')
      return { mode: 'legacy', registry: before, release: () => lease.release() }
    }

    // A cross-tab localStorage.clear() has no old values in the event and
    // cannot be reversed. Never silently hydrate an empty/mixed workspace.
    // The flag lives in THIS TAB's sessionStorage, outside stale-tab reach.
    if (sessionStorage.getItem('qwerty.s1.foreign-storage-clear-blocked') === '1') {
      throw new Error('S1 detected an older tab clearing shared localStorage; automatic writes are blocked until data is manually recovered')
    }

    // A stale old-JS tab may erase localStorage even while the current
    // owner document is closed and therefore cannot receive storage events.
    // The migration witness persists across ordinary workspace restore
    // and must not disappear after registry generation has been committed.
    if (localStorage.getItem(S1_MIGRATION_WITNESS_KEY) === null) {
      throw new Error('S1 workspace migration witness missing: possible legacy-tab storage wipe; writes blocked')
    }

    // With no unfinished switch, any V5-only write since the owner closed
    // must be detected BEFORE reconciliation can touch working credentials.
    if (!before.pending) assertWorkspaceMigrationWitness()

    // Recover a previously committed workspace journal before auth
    // reconciliation; the intended target credentials may not yet be active.
    // Importing the restore adapter loads the legacy Jotai/store modules.
    // After a journal replay, their module-level caches may reflect the OLD
    // localStorage. Refuse hydration in this JS realm and require a reload.
    // In the no-journal path we never load those modules before app mount.
    if (before.pending) {
      report(onStage, 'recovering')
      const { recoverPendingWorkspace } = await import('./workspace-coordinator')
      await recoverPendingWorkspace()
      const { reconcileAuthTransition } = await import('./workspace-auth-transaction')
      await reconcileAuthTransition()
      // The immutable vault is the recovery authority, not stale V5 storage.
      refreshWorkspaceMigrationWitness()
      recovered = true
      throw new Error('S1 recovery completed; reload required before mounting app')
    }

    const { reconcileAuthTransition } = await import('./workspace-auth-transaction')
    // No domain writer is mounted yet. Handle both pre-journal rollback and
    // post-registry-CAS / pre-auth-write crashes from the previous page.
    const reconciliation = await reconcileAuthTransition()
    if (reconciliation === 'completed') refreshWorkspaceMigrationWitness()
    const registry = before
    report(onStage, 'checking-identity')
    const auth = loadAuth({ preserveExpired: true })
    const expected: Workspace = auth
      ? { kind: 'account', accountId: auth.user.userId }
      : { kind: 'anonymous' }
    if (!same(registry.active, expected)) {
      throw new Error('Active workspace and authenticated account differ: writes blocked')
    }

    // Re-check after any awaited reconciliation; fail closed if stale JS
    // cleared shared storage while we were verifying the registry.
    if (localStorage.getItem(S1_MIGRATION_WITNESS_KEY) === null) {
      throw new Error('S1 workspace migration witness vanished during boot; writes blocked')
    }
    // Also detect an ordinary stale V5 settings/auth write during awaited
    // reconciliation, not just disappearance of the witness key.
    assertWorkspaceMigrationWitness()
    // Upgrade old V1 witness profiles on first guarded entry. New migrations
    // are sealed before their registry CAS commits. A future stale V5 tab
    // cannot update this digest when the owner page is no longer alive.
    if (localStorage.getItem(S1_MIGRATION_WITNESS_KEY) === 'v1') {
      refreshWorkspaceMigrationWitness()
    }
    installWorkspaceStorageWriterGuard()
    setIsolatedAuthRetention(true)
    report(onStage, 'ready')
    return { mode: 'isolated', registry, release: () => lease.release() }
  } catch (error) {
    lease.release()
    report(onStage, recovered ? 'restart-required' : 'blocked')
    throw error
  }
}

/** The mount callback must perform any app import/hydration only when called. */
export async function mountGuardedWorkspaceApp(
  mount: (registry: Registry) => void | Promise<void>,
  onStage?: (stage: WorkspaceBootStage) => void,
): Promise<GuardedWorkspaceBoot> {
  const boot = await prepareGuardedWorkspaceBoot(onStage)
  try {
    await mount(boot.registry)
    return boot
  } catch (error) {
    boot.release()
    throw error
  }
}
