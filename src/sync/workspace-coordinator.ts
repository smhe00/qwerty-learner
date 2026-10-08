/**
 * S1 opt-in workspace IO coordinator. These methods MUST ONLY be used while
 * the caller owns acquireWorkspaceWriterLease() and the application is not
 * mounted (or all domain writers are quiesced).
 *
 * Deliberately not called by legacy V1 account UI or app bootstrap.
 */
import { loadAuth } from './auth'
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
  const auth = loadAuth()
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
