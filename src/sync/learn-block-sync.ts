/**
 * Device-local, account-scoped opt-in for V4 sync at visible Learn Block
 * milestones.  This is NOT workspace learning data and is intentionally
 * excluded from cloud Backup V4: restoring/switching accounts must never
 * silently enable background cloud writes.
 *
 * A pending handoff is tab-local.  The guarded pre-mount S2 executor remains
 * the sole owner of Dexie capture/Cloud CAS (never mounted React).
 */
export const LEARN_BLOCK_PENDING_KEY = 'qwerty.learn.block-sync.pending.v1'
export const LEARN_BLOCK_RESULT_KEY = 'qwerty.learn.block-sync.result.v1'

export type LearnBlockSyncHandoff = {
  accountId: string
  at: number
  dailyComplete: boolean
  milestone: number | null
}

const PREF_PREFIX = 'qwerty.learn.block-sync.enabled.v1.'
const MAX_AGE_MS = 20 * 60 * 1000

export function blockAutoSyncEnabled(accountId: string): boolean {
  if (!accountId) return false
  try { return localStorage.getItem(PREF_PREFIX + accountId) === '1' }
  catch { return false }
}

export function setBlockAutoSyncEnabled(accountId: string, enabled: boolean): void {
  if (!accountId) throw new Error('Cannot change Block auto-sync without a bound account')
  if (enabled) localStorage.setItem(PREF_PREFIX + accountId, '1')
  else localStorage.removeItem(PREF_PREFIX + accountId)
}

export function isVisibleLearnBlockBoundary(input: {
  dailyComplete: boolean
  milestone?: number
}): boolean {
  return input.dailyComplete || input.milestone !== undefined
}

function valid(value: unknown): value is LearnBlockSyncHandoff {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<LearnBlockSyncHandoff>
  return typeof v.accountId === 'string' && v.accountId.length > 0 &&
    typeof v.at === 'number' && Number.isSafeInteger(v.at) &&
    v.at <= Date.now() + 60000 && Date.now() - v.at <= MAX_AGE_MS &&
    typeof v.dailyComplete === 'boolean' &&
    (v.milestone === null || (typeof v.milestone === 'number' &&
      Number.isSafeInteger(v.milestone) && v.milestone >= 0))
}

export function stageLearnBlockSync(accountId: string, input: {
  dailyComplete: boolean
  milestone?: number
}): void {
  if (!blockAutoSyncEnabled(accountId) || !isVisibleLearnBlockBoundary(input)) {
    throw new Error('Block auto-sync is not enabled for this visible milestone')
  }
  const pending: LearnBlockSyncHandoff = {
    accountId,
    at: Date.now(),
    dailyComplete: input.dailyComplete,
    milestone: input.milestone ?? null,
  }
  sessionStorage.removeItem(LEARN_BLOCK_RESULT_KEY)
  sessionStorage.setItem(LEARN_BLOCK_PENDING_KEY, JSON.stringify(pending))
}

export function readLearnBlockSyncPending(accountId: string): LearnBlockSyncHandoff | null {
  try {
    const raw = sessionStorage.getItem(LEARN_BLOCK_PENDING_KEY)
    if (!raw) return null
    const pending: unknown = JSON.parse(raw)
    return valid(pending) && pending.accountId === accountId ? pending : null
  } catch { return null }
}

export type LearnBlockSyncOutcome =
  | { kind: 'ok'; message: string }
  | { kind: 'failed'; message: string }

export function saveLearnBlockSyncOutcome(outcome: LearnBlockSyncOutcome): void {
  // Pending intent is retained only for explicit retry if result failed.
  sessionStorage.setItem(LEARN_BLOCK_RESULT_KEY, JSON.stringify(outcome))
}

export function readLearnBlockSyncOutcome(): LearnBlockSyncOutcome | null {
  try {
    const raw = sessionStorage.getItem(LEARN_BLOCK_RESULT_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<LearnBlockSyncOutcome>
    return (value?.kind === 'ok' || value?.kind === 'failed') &&
      typeof value.message === 'string' && value.message.length <= 500
      ? value as LearnBlockSyncOutcome : null
  } catch { return null }
}

export function clearLearnBlockSyncHandoff(): void {
  sessionStorage.removeItem(LEARN_BLOCK_PENDING_KEY)
  sessionStorage.removeItem(LEARN_BLOCK_RESULT_KEY)
}
