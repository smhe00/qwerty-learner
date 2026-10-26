/** One network budget across automatic recovery navigations. Never authorizes mount. */
import { secureRandomUuid } from './sha256-compat'

export const STARTUP_SYNC_BUDGET_MS = 60_000
export const STARTUP_SYNC_BUDGET_KEY = 'qwerty.startup-sync-budget.v1'
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Owner = { accountId: string; generation: number }
type Saved = Owner & { version: 1; attemptId: string; startedAt: number; deadline: number; reloads: number }
export type StartupSyncBudget = {
  remainingMs(): number
  continueAfterReload(): void
  finish(): void
  evidence(): { attemptId: string; elapsedMs: number; reloads: number; remainingMs: number }
}
export function createStartupSyncBudget(owner: Owner, storage: StoragePort, now: () => number = Date.now): StartupSyncBudget {
  const time = now()
  let saved: Saved | undefined
  const raw = storage.getItem(STARTUP_SYNC_BUDGET_KEY)
  storage.removeItem(STARTUP_SYNC_BUDGET_KEY)
  if (raw) {
    try {
      const value = JSON.parse(raw) as Saved
      if (
        value.version === 1 &&
        value.accountId === owner.accountId &&
        value.generation === owner.generation &&
        typeof value.attemptId === 'string' &&
        /^[a-f0-9-]{36}$/.test(value.attemptId) &&
        Number.isSafeInteger(value.startedAt) &&
        value.startedAt >= 0 &&
        value.deadline - value.startedAt === STARTUP_SYNC_BUDGET_MS &&
        Number.isSafeInteger(value.reloads) &&
        value.reloads >= 0
      )
        saved = value
    } catch {
      /* Malformed continuation grants no extra time. */
    }
    if (!saved) {
      let differentOwner = false
      try {
        const v = JSON.parse(raw)
        differentOwner = typeof v.accountId === 'string' && (v.accountId !== owner.accountId || v.generation !== owner.generation)
      } catch {
        /* Fail closed for malformed continuation. */
      }
      if (!differentOwner)
        saved = {
          ...owner,
          version: 1,
          attemptId: secureRandomUuid(),
          startedAt: time - STARTUP_SYNC_BUDGET_MS,
          deadline: time,
          reloads: 0,
        }
    }
  }
  const state: Saved = saved ?? {
    ...owner,
    version: 1,
    attemptId: secureRandomUuid(),
    startedAt: time,
    deadline: time + STARTUP_SYNC_BUDGET_MS,
    reloads: 0,
  }
  let continuing = false
  const remainingMs = () => {
    const t = now()
    return t < state.startedAt ? 0 : Math.max(0, state.deadline - t)
  }
  return {
    remainingMs,
    continueAfterReload() {
      storage.setItem(STARTUP_SYNC_BUDGET_KEY, JSON.stringify({ ...state, reloads: state.reloads + 1 }))
      continuing = true
    },
    finish() {
      if (!continuing) storage.removeItem(STARTUP_SYNC_BUDGET_KEY)
    },
    evidence: () => ({
      attemptId: state.attemptId,
      elapsedMs: Math.max(0, now() - state.startedAt),
      reloads: state.reloads,
      remainingMs: remainingMs(),
    }),
  }
}
let active: StartupSyncBudget | undefined
function recordBudgetPhase(phase: 'begin' | 'reload' | 'finish'): void {
  try {
    const previous = JSON.parse(sessionStorage.getItem('qwerty.startup-sync-trace.v1') || '[]')
    const entries = Array.isArray(previous) ? previous.slice(-23) : []
    entries.push({ phase, ...active?.evidence() })
    sessionStorage.setItem('qwerty.startup-sync-trace.v1', JSON.stringify(entries))
  } catch {
    /* Diagnostics never grant or remove ownership. */
  }
}
export function beginStartupSyncBudget(owner: Owner): void {
  if (active) throw Error('startup-sync-budget-already-active')
  active = createStartupSyncBudget(owner, sessionStorage)
  recordBudgetPhase('begin')
}
export function startupSyncBudgetActive(): boolean {
  return !!active
}
export function startupSyncTimeRemaining(): boolean {
  return !active || active.remainingMs() > 0
}
export function preserveStartupSyncBudgetForReload(): void {
  active?.continueAfterReload()
  recordBudgetPhase('reload')
}
export function finishStartupSyncBudget(): void {
  if (active) recordBudgetPhase('finish')
  active?.finish()
  active = undefined
}
export function startupSyncBudgetEvidence() {
  return active?.evidence() ?? null
}
/** Call before fetch. No Promise.race: the actual fetch/body reader must settle. */
export function startupSyncRequestTimeout(defaultMs: number): number {
  if (!active) return defaultMs
  const remaining = active.remainingMs()
  if (remaining <= 0) throw Error('startup-sync-budget-exhausted')
  return Math.min(defaultMs, remaining)
}
