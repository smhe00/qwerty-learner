/**
 * Production-shaped S2 adapter for use ONLY during the guarded pre-mount
 * S1 writer lease. Importing this module initializes RecordDB/Jotai; its
 * caller MUST require a fresh navigation after the Sync outcome.
 *
 * Deliberately not called by Cloud Sync V1 UI or mounted React handlers.
 */
import { getSyncV2Meta, getSyncV2Snapshot, putSyncV2 } from './api'
import { loadAuth } from './auth'
import { compareAndSwapSyncV2Baseline, loadSyncV2Baseline } from './v2-baseline'
import { executeManualSyncV2 } from './v2-manual-executor'
import type { S2ExecutionResult } from './v2-manual-executor'
import { syncV2PullJournalPort } from './v2-pull-journal'
import { assertWorkspaceMigrationWitness, refreshWorkspaceMigrationWitness } from './workspace-storage-witness'
import { captureWorkingWorkspaceV4, restoreWorkingWorkspaceV4 } from './workspace-v4-browser'
import { saveWorkspaceToVault, workspaceRegistryPort } from './workspace-vault'
import type { GuardedWorkspaceBoot } from './workspace-bootstrap'
import { flushReviewRecordWrites } from '@/store/reviewInfoAtom'

export async function executePreMountManualSyncV2(
  boot: GuardedWorkspaceBoot,
): Promise<S2ExecutionResult> {
  const owner = boot.registry.active
  if (boot.mode !== 'isolated' || boot.registry.pending ||
      owner.kind !== 'account' || boot.registry.generation < 1) {
    throw new Error('S2 Sync requires an initialized, isolated account workspace')
  }
  const accountId = owner.accountId
  const auth = loadAuth({ preserveExpired: true })
  if (!auth || auth.user.userId !== accountId ||
      !auth.token || auth.expiresAt * 1000 <= Date.now()) {
    throw new Error('S2 account session is missing, expired or mismatched: reauthenticate first')
  }
  const recheck = async () => {
    const now = await workspaceRegistryPort.read()
    if (now.generation !== boot.registry.generation || now.pending !== null ||
        now.active.kind !== 'account' || now.active.accountId !== accountId) {
      throw new Error('S2 isolated working DB owner/generation changed')
    }
    const activeAuth = loadAuth({ preserveExpired: true })
    if (!activeAuth || activeAuth.user.userId !== accountId ||
        activeAuth.token !== auth.token || activeAuth.expiresAt * 1000 <= Date.now()) {
      throw new Error('S2 account authentication changed during Sync')
    }
    assertWorkspaceMigrationWitness()
  }
  await recheck()
  const identity = { kind: 'account' as const, accountId }
  return executeManualSyncV2({
    accountId,
    registryGeneration: boot.registry.generation,
    assertQuiescentOwner: recheck,
    flush: () => flushReviewRecordWrites(),
    capture: () => captureWorkingWorkspaceV4(identity),
    readBaseline: () => loadSyncV2Baseline(accountId),
    compareAndSwapBaseline: (expected, next) =>
      compareAndSwapSyncV2Baseline(accountId, expected, next),
    getMeta: () => getSyncV2Meta(auth.token),
    getSnapshot: () => getSyncV2Snapshot(auth.token),
    put: input => putSyncV2(auth.token, { ...input, deviceId: 'qwerty-web-s2-manual' }),
    saveSource: snapshot => saveWorkspaceToVault(identity, snapshot),
    journal: syncV2PullJournalPort,
    replica: {
      restore: (snapshot, expectedOwnerId) =>
        restoreWorkingWorkspaceV4(snapshot, { kind: 'account', accountId: expectedOwnerId }),
      seal: async () => { refreshWorkspaceMigrationWitness() },
    },
  })
}
