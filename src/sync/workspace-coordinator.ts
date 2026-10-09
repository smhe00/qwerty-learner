/**
 * S1 opt-in workspace IO coordinator. These methods MUST ONLY be used while
 * the caller owns acquireWorkspaceWriterLease() and the application is not
 * mounted (or all domain writers are quiesced).
 *
 * Deliberately not called by legacy V1 account UI or app bootstrap.
 */
import { loadAuth } from './auth'
import { S1_MIGRATION_WITNESS_KEY } from './workspace-v4'
import {
  ANONYMOUS,
  recoverWorkspace,
  same,
  switchWorkspace,
} from './workspace-transition'
import type { Phase, Registry, ReplicaPort, Workspace } from './workspace-transition'
import {
  captureWorkingWorkspaceV4,
  resetWorkingWorkspaceToEmpty,
  restoreWorkingWorkspaceV4,
} from './workspace-v4-browser'
import {
  loadWorkspaceFromVault,
  saveWorkspaceToVault,
  workspaceRegistryPort,
} from './workspace-vault'
import { flushReviewRecordWrites } from '@/store/reviewInfoAtom'

const replica: ReplicaPort = {
  flush: () => flushReviewRecordWrites(),
  saveSource: async (source) => {
    const snapshot = await captureWorkingWorkspaceV4(source)
    await saveWorkspaceToVault(source, snapshot)
  },
  restoreTarget: async (target) => {
    const snapshot = await loadWorkspaceFromVault(target)
    if (snapshot) await restoreWorkingWorkspaceV4(snapshot, target)
    else await resetWorkingWorkspaceToEmpty()
  },
}

function assertLegacyIdentity(owner: Workspace) {
  const auth = loadAuth({ preserveExpired: true })
  const expected: Workspace = auth
    ? { kind: 'account', accountId: auth.user.userId }
    : ANONYMOUS
  if (!same(expected, owner)) {
    throw new Error('Legacy workspace ownership requires explicit account migration consent')
  }
}

/**
 * One-time initialization while writes are locked. Never infer ownership from
 * a username. Do not call on app startup without an explicit migration decision.
 */
export async function initializeLegacyWorkspace(
  owner: Workspace,
): Promise<Registry> {
  assertLegacyIdentity(owner)
  const registry = await workspaceRegistryPort.read()
  if (registry.generation !== 0 || registry.pending ||
      !same(registry.active, ANONYMOUS)) {
    throw new Error('Workspace registry already initialized')
  }
  // Persist complete existing progress before changing the active identity.
  await replica.flush()
  await replica.saveSource(owner)
  const initialized: Registry = { version: 1, active: owner, pending: null, generation: 1 }
  // Write the witness BEFORE publishing generation 1. An old pre-S1 tab
  // that later calls localStorage.clear() deletes this sentinel, so the
  // next guarded boot refuses to accept an apparently empty anonymous
  // workspace. No existing V1 storage is deleted or overwritten.
  localStorage.setItem(S1_MIGRATION_WITNESS_KEY, 'v1')
  await workspaceRegistryPort.compareAndSwap(0, initialized)
  return initialized
}

/** MUST run on startup before any DB writer or React hydration. */
export function recoverPendingWorkspace(onPhase?: (phase: Phase) => void): Promise<Registry> {
  return recoverWorkspace(workspaceRegistryPort, replica, onPhase)
}

/** Caller owns UI preflight (dirty Sync, explicit logout, auth, consent). */
export function transitionWorkingWorkspace(
  target: Workspace,
  onPhase?: (phase: Phase) => void,
): Promise<Registry> {
  return switchWorkspace(workspaceRegistryPort, replica, target, onPhase)
}


/**
 * Registration-only, explicit anonymous-copy choice. Call before switching
 * to the newly allocated immutable account ID and only in the pre-mount
 * writer-locked phase. An existing target is never overwritten.
 */
export async function copyAnonymousWorkspaceForNewRegistration(
  accountId: string,
): Promise<void> {
  const target: Workspace = { kind: 'account', accountId }
  const registry = await workspaceRegistryPort.read()
  if (registry.pending || registry.generation === 0 ||
      !same(registry.active, ANONYMOUS) || loadAuth({ preserveExpired: true })) {
    throw new Error('Account registration copy requires an isolated anonymous workspace')
  }
  if (await loadWorkspaceFromVault(target)) {
    throw new Error('New registration already has a local workspace; copy refused')
  }
  await replica.flush()
  const snapshot = await captureWorkingWorkspaceV4(target)
  await saveWorkspaceToVault(target, snapshot)
}
