/**
 * S1 pre-mount account identity transaction.
 *
 * DO NOT call while React or RecordDB writers are mounted. The caller must
 * retain the exclusive app writer lease until document navigation. A local
 * durable intent bridges the unavoidable IndexedDB-registry / localStorage
 * auth atomicity boundary, and MUST be reconciled before app hydration.
 */
import { loadAuth, replaceAuthAfterWorkspaceCommit } from './auth'
import { keyOf, same } from './workspace-transition'
import type { Phase, Workspace, Registry } from './workspace-transition'
import { workspaceRegistryPort } from './workspace-vault'
import type { CloudAuthState } from './types'

const INTENT_KEY = 'qwerty.s1.auth-transition.v1'
type AuthIntent = {
  version: 1
  from: Workspace
  to: Workspace
  nextAuth: CloudAuthState | null
}

function storage(): Storage { return window.localStorage }

function validIntent(value: unknown): value is AuthIntent {
  if (!value || typeof value !== 'object') return false
  const intent = value as Partial<AuthIntent>
  if (intent.version !== 1 || !intent.from || !intent.to ||
      !Object.prototype.hasOwnProperty.call(intent, 'nextAuth')) return false
  try {
    keyOf(intent.from)
    keyOf(intent.to)
    if (same(intent.from, intent.to)) return false
    if (intent.from.kind === 'account' && intent.to.kind === 'account') return false
  } catch { return false }
  const auth = intent.nextAuth
  if (intent.to.kind === 'anonymous') return auth === null
  return !!auth && typeof auth.token === 'string' && auth.token.length > 0 &&
    typeof auth.expiresAt === 'number' &&
    auth.user?.userId === intent.to.accountId &&
    typeof auth.user.username === 'string'
}

function readIntent(): AuthIntent | null {
  const raw = storage().getItem(INTENT_KEY)
  if (raw === null) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch {
    throw new Error('Corrupt S1 auth transition intent: write access blocked')
  }
  if (!validIntent(value)) {
    throw new Error('Invalid S1 auth transition intent: write access blocked')
  }
  return value
}

function activeOwnerForAuth(): Workspace {
  const auth = loadAuth({ preserveExpired: true })
  return auth
    ? { kind: 'account', accountId: auth.user.userId }
    : { kind: 'anonymous' }
}

/**
 * A completed workspace switch owns the target only when auth is finalized.
 * If a crash occurs before the pending journal, source remains active and
 * the abandoned intent is discarded. Corrupt or conflicting identity blocks.
 */
export async function reconcileAuthTransition(): Promise<'none' | 'rolled-back' | 'completed'> {
  const intent = readIntent()
  if (!intent) return 'none'
  const registry = await workspaceRegistryPort.read()
  if (registry.pending) {
    throw new Error('S1 pending workspace journal requires recovery before auth reconciliation')
  }
  if (same(registry.active, intent.to)) {
    replaceAuthAfterWorkspaceCommit(intent.nextAuth)
    storage().removeItem(INTENT_KEY)
    return 'completed'
  }
  if (same(registry.active, intent.from)) {
    if (!same(activeOwnerForAuth(), intent.from)) {
      throw new Error('S1 auth/source identity mismatch: write access blocked')
    }
    storage().removeItem(INTENT_KEY)
    return 'rolled-back'
  }
  throw new Error('S1 registry and auth intent disagree: write access blocked')
}

/**
 * Transaction entry: authentication against the cloud happens BEFORE this
 * function, without mutating local credentials. A->B direct transitions are
 * forbidden by the kernel; logout to anonymous is required first.
 */
export async function switchAuthenticatedWorkspace(
  target: Workspace,
  nextAuth: CloudAuthState | null,
  onPhase?: (phase: Phase) => void,
): Promise<Registry> {
  if (readIntent()) throw new Error('Previous S1 auth intent must be recovered')
  const before = await workspaceRegistryPort.read()
  if (before.pending || before.generation === 0) throw new Error('S1 workspace not ready for account switch')
  if (!same(before.active, activeOwnerForAuth())) {
    throw new Error('S1 active owner differs from local authenticated identity')
  }
  if (same(before.active, target)) {
    throw new Error('Use reauthentication for an existing account; no workspace switch required')
  }
  const intent: AuthIntent = { version: 1, from: before.active, to: target, nextAuth }
  if (!validIntent(intent)) throw new Error('Target account ID does not match authenticated user')
  if (before.active.kind === 'account' && target.kind === 'account') {
    throw new Error('Explicit logout to anonymous is required before switching accounts')
  }
  storage().setItem(INTENT_KEY, JSON.stringify(intent))
  try {
    const { transitionWorkingWorkspace } = await import('./workspace-coordinator')
    const registry = await transitionWorkingWorkspace(target, onPhase)
    await reconcileAuthTransition()
    return registry
  } catch (error) {
    // The durable pending journal, if present, is the recovery authority.
    // If failure preceded it, rollback intent; NEVER change source auth.
    const registry = await workspaceRegistryPort.read()
    if (!registry.pending && same(registry.active, before.active)) {
      await reconcileAuthTransition()
    }
    throw error
  }
}

/** Renew a revoked/expired session only for the same immutable account. */
export async function reauthenticateSameWorkspace(auth: CloudAuthState): Promise<void> {
  if (readIntent()) throw new Error('Pending S1 transition must be resolved first')
  const registry = await workspaceRegistryPort.read()
  if (registry.pending || registry.active.kind !== 'account' ||
      registry.active.accountId !== auth.user.userId ||
      !same(registry.active, activeOwnerForAuth())) {
    throw new Error('Reauthentication may not change workspace identity')
  }
  replaceAuthAfterWorkspaceCommit(auth)
}

/** Used by deterministic browser injection tests, never export credentials. */
export const S1_AUTH_INTENT_KEY = INTENT_KEY
