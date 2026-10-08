/** S1 protocol kernel. NOT connected to the legacy V1 working DB. */
export type Workspace = { kind: 'anonymous' } | { kind: 'account'; accountId: string }
export type SwitchJournal = { from: Workspace; to: Workspace; transactionId: number }
export type Registry = {
  version: 1
  generation: number
  active: Workspace
  pending: SwitchJournal | null
}
/** Atomic, durable CAS; caller must additionally hold an exclusive cross-tab writer lock. */
export interface RegistryPort {
  read(): Promise<Registry>
  compareAndSwap(expectedGeneration: number, next: Registry): Promise<void>
}
/** Vault is independent of the working IndexedDB. Restore must be idempotent. */
export interface ReplicaPort {
  flush(): Promise<void>
  saveSource(source: Workspace): Promise<void>
  restoreTarget(target: Workspace): Promise<void>
}
export type Phase = 'saving' | 'prepared' | 'restoring' | 'recovering' | 'complete' | 'failed'
export const ANONYMOUS: Workspace = { kind: 'anonymous' }
export const initialRegistry = (): Registry =>
  ({ version: 1, generation: 0, active: ANONYMOUS, pending: null })

export function keyOf(w: Workspace): string {
  if (w.kind === 'anonymous') return 'anonymous'
  if (
    w.kind !== 'account' ||
    typeof w.accountId !== 'string' ||
    !w.accountId.trim() ||
    w.accountId.trim() !== w.accountId
  ) throw new Error('Invalid immutable accountId')
  return 'account:' + encodeURIComponent(w.accountId)
}
export const same = (a: Workspace, b: Workspace): boolean => keyOf(a) === keyOf(b)

function check(r: Registry): void {
  if (r.version !== 1 || !Number.isSafeInteger(r.generation) || r.generation < 0) {
    throw new Error('Invalid workspace registry')
  }
  keyOf(r.active)
  if (r.pending) {
    keyOf(r.pending.from)
    keyOf(r.pending.to)
    if (!same(r.active, r.pending.from) || r.pending.transactionId !== r.generation)
      throw new Error('Inconsistent durable switch journal')
  }
}
function advance(g: number): number {
  if (g >= Number.MAX_SAFE_INTEGER - 2) throw new Error('Generation exhausted')
  return g + 1
}
function notify(cb: ((phase: Phase) => void) | undefined, phase: Phase): void {
  try { cb?.(phase) } catch { /* UI observers cannot abort transactions */ }
}

/**
 * Preconditions not implemented here: lock all tabs, quiesce DB writers,
 * validate authentication and finish any required pre-logout manual sync.
 * A -> B must go through a separate explicit logout to anonymous.
 */
export async function switchWorkspace(
  port: RegistryPort,
  replica: ReplicaPort,
  target: Workspace,
  onPhase?: (phase: Phase) => void,
): Promise<Registry> {
  let journalPersisted = false
  try {
    keyOf(target)
    const prior = await port.read()
    check(prior)
    if (prior.pending) throw new Error('Pending switch requires recovery')
    if (same(prior.active, target)) return prior
    if (prior.active.kind === 'account' && target.kind === 'account') {
      throw new Error('Account A to B requires explicit anonymous logout')
    }
    notify(onPhase, 'saving')
    await replica.flush()
    await replica.saveSource(prior.active)
    const preparedGeneration = advance(prior.generation)
    const pending: Registry = {
      ...prior,
      generation: preparedGeneration,
      pending: { from: prior.active, to: target, transactionId: preparedGeneration },
    }
    // Crash window begins here; never restore before durable journal commit.
    await port.compareAndSwap(prior.generation, pending)
    journalPersisted = true
    notify(onPhase, 'prepared')
    notify(onPhase, 'restoring')
    await replica.restoreTarget(target)
    const completed: Registry = {
      ...pending, generation: advance(preparedGeneration), active: target, pending: null,
    }
    await port.compareAndSwap(preparedGeneration, completed)
    notify(onPhase, 'complete')
    return completed
  } catch (error) {
    notify(onPhase, 'failed')
    if (journalPersisted) {
      throw new Error('Switch interrupted: recover before enabling any DB write', { cause: error })
    }
    throw error
  }
}

/** Invoke on startup BEFORE any React hydration or working DB writer. */
export async function recoverWorkspace(
  port: RegistryPort,
  replica: Pick<ReplicaPort, 'restoreTarget'>,
  onPhase?: (phase: Phase) => void,
): Promise<Registry> {
  try {
    const prior = await port.read()
    check(prior)
    if (!prior.pending) return prior
    notify(onPhase, 'recovering')
    await replica.restoreTarget(prior.pending.to)
    const completed: Registry = {
      ...prior, generation: advance(prior.generation),
      active: prior.pending.to, pending: null,
    }
    await port.compareAndSwap(prior.generation, completed)
    notify(onPhase, 'complete')
    return completed
  } catch (error) {
    notify(onPhase, 'failed')
    throw error
  }
}
