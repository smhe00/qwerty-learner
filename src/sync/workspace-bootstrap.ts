/**
 * S1 guarded bootstrap primitive. Call this BEFORE dynamically importing the
 * mounted app and BEFORE any working-DB or Jotai writers can initialize.
 *
 * NOT installed in the V1 production entry point: legacy tabs still bypass
 * S1 ownership, so this primitive alone does not authorize S1 activation.
 */
import { loadAuth } from './auth'
import { recoverPendingWorkspace } from './workspace-coordinator'
import { acquireWorkspaceWriterLease } from './workspace-lock'
import { same } from './workspace-transition'
import type { Registry, Workspace } from './workspace-transition'
import { workspaceRegistryPort } from './workspace-vault'

export type WorkspaceBootStage =
  | 'locking'
  | 'recovering'
  | 'checking-identity'
  | 'ready'
  | 'blocked'

export type GuardedWorkspaceBoot = {
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
 * A pending journal always recovers before checking the active identity.
 * The exclusive lease is held until the owning tab explicitly releases it.
 */
export async function prepareGuardedWorkspaceBoot(
  onStage?: (stage: WorkspaceBootStage) => void,
): Promise<GuardedWorkspaceBoot> {
  report(onStage, 'locking')
  const lease = await acquireWorkspaceWriterLease().catch(error => {
    report(onStage, 'blocked')
    throw error
  })

  try {
    const before = await workspaceRegistryPort.read()
    if (before.generation === 0) {
      throw new Error('S1 workspace is not initialized: explicit V1 migration is required')
    }

    report(onStage, 'recovering')
    const registry = await recoverPendingWorkspace()

    report(onStage, 'checking-identity')
    const auth = loadAuth()
    const expected: Workspace = auth
      ? { kind: 'account', accountId: auth.user.userId }
      : { kind: 'anonymous' }
    if (!same(registry.active, expected)) {
      throw new Error('Active workspace and authenticated account differ: writes blocked')
    }

    report(onStage, 'ready')
    return { registry, release: () => lease.release() }
  } catch (error) {
    lease.release()
    report(onStage, 'blocked')
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
