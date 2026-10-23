/**
 * S1 guarded bootstrap primitive. Call this BEFORE dynamically importing the
 * mounted app and BEFORE any working-DB or Jotai writers can initialize.
 *
 * The V1-compatible entry uses allowLegacy only for an uninitialized
 * registry. It never migrates or switches an account implicitly.
 */
import { loadAuth, setIsolatedAuthRetention } from './auth'
import { timePerfStage } from './perf-diagnostics'
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
import { learningEventSyncEnabled } from './learning-sync-policy'
import { shouldCheckAccountV4AtStartup } from './account-startup-v4'

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
  options: { allowLegacy?: boolean; writerWaitMs?: number } = {},
): Promise<GuardedWorkspaceBoot> {
  report(onStage, 'locking')
  const lease = await timePerfStage('startup', 'writer-lease', () =>
    acquireWorkspaceWriterLease({ waitMs: options.writerWaitMs })).catch(error => {
    report(onStage, 'blocked')
    throw error
  })

  let recovered = false
  try {
    const before = await timePerfStage('startup', 'registry-read', () =>
      workspaceRegistryPort.read())
    // An S2 Pull may have partially restored shared settings. Its immutable
    // staged V4 snapshot is the recovery authority before app hydration.
    const { syncV2PullJournalPort } = await import('./v2-pull-journal')
    const { manualV4ImportJournalPort } = await import('./manual-v4-import-journal')
    const { m4MergeJournalPort } = await import('./m4-merge-journal')
    const [pendingPull, pendingImport, pendingMerge] = await timePerfStage(
      'startup', 'journal-check',
      () => Promise.all([
        syncV2PullJournalPort.read(),
        manualV4ImportJournalPort.read(),
        m4MergeJournalPort.read(),
      ]),
    )
    if ((pendingPull && pendingImport) ||
        (before.pending && (pendingPull || pendingImport || pendingMerge)) ||
        (pendingMerge && (pendingPull || pendingImport))) {
      throw new Error('Conflicting S1, S2, manual V4 or M4 recovery journals')
    }
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

    // A completed registry CAS can legitimately precede the final auth
    // write. In that narrow crash window the verified S1 intent authorizes
    // reconciliation and resealing; without such an intent stale V5 changes
    // must be rejected before any credential mutation.
    const hasAuthIntent = localStorage.getItem('qwerty.s1.auth-transition.v1') !== null
    if (!before.pending && !hasAuthIntent && !pendingPull && !pendingImport && !pendingMerge) {
      assertWorkspaceMigrationWitness()
    }

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
    const reconciliation = await timePerfStage('startup', 'auth-reconcile', () =>
      reconcileAuthTransition())
    if (reconciliation === 'completed') {
      // This recovery follows a validated durable S1 auth transition intent
      // whose target is already the committed registry owner.
      refreshWorkspaceMigrationWitness()
    } else if (!pendingPull && !pendingImport && !pendingMerge) {
      // A staged Pull or V4 file restore may change settings before its
      // journal finalizes. Otherwise enforce stale-V5 writer detection.
      assertWorkspaceMigrationWitness()
    }
    const registry = before
    report(onStage, 'checking-identity')
    const auth = loadAuth({ preserveExpired: true })
    const expected: Workspace = auth
      ? { kind: 'account', accountId: auth.user.userId }
      : { kind: 'anonymous' }
    if (!same(registry.active, expected)) {
      throw new Error('Active workspace and authenticated account differ: writes blocked')
    }

    if (pendingMerge) {
      // Under the exclusive pre-mount S1 writer lock, reapply the exact
      // staged target. No untrusted remote read or new merge happens here.
      if (registry.pending ||
          registry.generation !== pendingMerge.registryGeneration ||
          registry.active.kind !== 'account' ||
          registry.active.accountId !== pendingMerge.accountId) {
        throw new Error('M4 recovery owner or S1 generation changed: writes blocked')
      }
      report(onStage, 'recovering')
      const { recoverPendingM4Merge } = await import('./m4-merge-browser-recovery')
      if (!(await recoverPendingM4Merge('apply'))) {
        throw new Error('M4 recovery journal disappeared: writes blocked')
      }
      sessionStorage.setItem('qwerty.s2.last-sync-result',
        '本机学习数据事务已安全恢复；其他设备是否完成同步尚未确认。')
      recovered = true
      // Reload discards any pre-restore module-level storage caches.
      throw new Error('M4 merge recovery completed; reload required before mounting app')
    }

    if (pendingPull) {
      report(onStage, 'recovering')
      const { recoverPendingSyncV2Pull } = await import('./v2-pull-recovery')
      await recoverPendingSyncV2Pull()
      // Success acknowledgement is emitted only after full durable replay,
      // witness reseal and atomic baseline finalization, never at staging.
      sessionStorage.setItem('qwerty.s2.last-sync-result',
        '已完成云端学习数据安全恢复。')
      recovered = true
      throw new Error('S2 Pull recovery completed; reload required before mounting app')
    }
    if (pendingImport) {
      report(onStage, 'recovering')
      const { recoverPendingManualV4Import } = await import('./manual-v4-import-recovery')
      await recoverPendingManualV4Import()
      recovered = true
      throw new Error('Manual V4 import recovery completed; reload required before mounting app')
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
    // Inspect the FULL cloud account before event-prefix adoption. A clean
    // single-sided remote update is downloaded and durably journaled; a
    // divergent history remains pending and neither side is overwritten.
    if (
      shouldCheckAccountV4AtStartup({
        pathname: window.location.pathname,
        search: window.location.search,
        account: registry.active.kind === 'account',
        liveAuth: !!auth?.token && auth.expiresAt * 1000 > Date.now(),
        enabled: learningEventSyncEnabled() && import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC === 'true',
        online: navigator.onLine,
      })
    ) {
      const { checkAccountV4AfterAuthentication } = await import('./account-login-v4-check')
      const result = await checkAccountV4AfterAuthentication()
      // Fixed status only: no identity, token, payload or private error.
      sessionStorage.setItem('qwerty.s2.startup-check.v1', result.status)
      if (result.status !== 'noop') {
        sessionStorage.setItem('qwerty.s2.last-sync-result', result.detail)
      }
      if (result.status === 'pull-staged') {
        recovered = true
        throw new Error('S2 Pull staged; reload required before mounting app')
      }
      if (!result.canContinue) throw new Error('S2 startup workspace is not ready')
    }
    // On approved origins, under the S1 exclusive pre-mount writer lease, drain
    // this device's immutable offline events, then optionally adopt a strictly
    // verified, monotonic remote PREFIX through an M4 undo journal. Never use
    // Blob listing as evidence of whole-account convergence.
    if (registry.active.kind === 'account' && learningEventSyncEnabled()) {
      try {
        const { adoptWitnessedM3AtGuardedBoot } =
          await import('./m4-witnessed-prefix-browser')
        const adoption = await adoptWitnessedM3AtGuardedBoot(registry)
        if (adoption.status === 'adopted') {
          recovered = true
          // The restore initialized Dexie/atoms before the React mount. A
          // fresh JS realm avoids using stale in-memory state after recovery.
          throw new Error('M4 merge recovery completed; reload required before mounting app')
        }
        if (adoption.status === 'blocked') {
          console.warn('M4 witnessed prefix was NOT applied:', adoption.reason)
          if (window.location.search === '?m4-reconcile=1') {
            // Do not repeatedly disrupt an idle user on a deterministic
            // blocker. Retry only after explicit reauthentication.
            sessionStorage.setItem('qwerty.etest.m4.idleBlocked', '1')
          }
        }
        if (window.location.search === '?m4-reconcile=1') {
          window.history.replaceState(null, '', '/')
        }
      } catch (error) {
        if (error instanceof Error &&
            (error.message.includes('M4 merge recovery completed; reload required') ||
             error.message.includes('m4-merge-interrupted-recovery-required'))) {
          recovered = true
          throw error
        }
        // Network/read failures leave the full local workspace and durable
        // outbox intact; offline etest users must still be able to learn.
        console.warn('M4 witnessed prefix adoption deferred:', error)
      }
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
