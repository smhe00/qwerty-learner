import { M4RecoveryRequiredError, WorkspaceWriterOccupiedError } from './workspace-errors'
import type { Registry } from './workspace-transition'

export type WorkspaceBootStage = 'locking' | 'recovering' | 'restart-required' | 'checking-identity' | 'syncing' | 'ready' | 'blocked'

export type GuardedWorkspaceBoot = {
  mode: 'legacy' | 'isolated'
  registry: Registry
  passiveAccountReturn?: boolean
  /** Only call after all mounted writers have stopped and flushed. */
  release(): void
}

export type WorkspaceReloadReason = 's1-recovered' | 's2-pull-staged' | 's2-pull-recovered' | 'manual-v4-recovered' | 'm4-recovered'

export type WorkspaceBootStopped =
  | { kind: 'reload-required'; reason: WorkspaceReloadReason }
  | { kind: 'occupied'; error: unknown }
  | { kind: 'blocked'; reason: 'safety-check' | 'm4-recovery-required'; error: unknown }

/** Only ready transfers the writer lease to a caller. All other outcomes
 * leave the app unmounted and hold no successfully acquired lease.
 */
export type WorkspaceBootOutcome = { kind: 'ready'; boot: GuardedWorkspaceBoot } | WorkspaceBootStopped

export function workspaceBootFailure(error: unknown): Exclude<WorkspaceBootStopped, { kind: 'reload-required' }> {
  if (error instanceof WorkspaceWriterOccupiedError) return { kind: 'occupied', error }
  return { kind: 'blocked', reason: error instanceof M4RecoveryRequiredError ? 'm4-recovery-required' : 'safety-check', error }
}
