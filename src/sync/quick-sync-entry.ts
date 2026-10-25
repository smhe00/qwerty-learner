/**
 * A compact UI entry into the EXISTING guarded pre-mount S2 transaction.
 * No mounted React handler may run V4 capture, CAS, merge or restore.
 * Pending intent is tab-local and bound to the current account/return route.
 */
import { loadAuth } from './auth'

export type QuickSyncTarget = '/learn' | '/typing' | '/mobile' | '/mobile/study'
export type QuickSyncFeedback = { kind: 'ok' | 'failed' | 'unknown'; message: string }
type Intent = { accountId: string; target: QuickSyncTarget; createdAt: number; phase: 'requested' | 'recovering' }
type Notice = QuickSyncFeedback & { accountId: string; at: number }

const INTENT_KEY = 'qwerty.s2.quick-sync.intent.v1'
const NOTICE_KEY = 'qwerty.s2.quick-sync.notice.v1'
const LAST_PREFIX = 'qwerty.s2.quick-sync.last-ok.v1.'
const MAX_AGE = 15 * 60 * 1000
export const QUICK_SYNC_NOTICE_EVENT = 'qwerty:s2-quick-sync-notice'

const targetSet = new Set<string>(['/learn', '/typing', '/mobile', '/mobile/study'])
function allowedTarget(value: unknown): value is QuickSyncTarget {
  return typeof value === 'string' && targetSet.has(value)
}
function readIntent(): Intent | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(INTENT_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    const value = parsed as Partial<Intent>
    if (typeof value.accountId !== 'string' || !value.accountId ||
        !allowedTarget(value.target) ||
        !Number.isSafeInteger(value.createdAt) ||
        Math.abs(Date.now() - value.createdAt) > MAX_AGE ||
        (value.phase !== 'requested' && value.phase !== 'recovering')) return null
    return value as Intent
  } catch { return null }
}
export function quickSyncAllowed(): boolean {
  return REACT_APP_DEPLOY_ENV !== 'pages' &&
    import.meta.env.VITE_QWERTY_SYNC_DISABLED !== 'true' &&
    (import.meta.env.DEV || import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC === 'true')
}
export function getQuickSyncIntent(accountId: string): Intent | null {
  const intent = readIntent()
  return intent?.accountId === accountId ? intent : null
}
export function quickSyncReturnPath(accountId: string): string {
  const path = getQuickSyncIntent(accountId)?.target || '/learn'
  // One-shot marker suppresses mobile session autoplay after a guarded reload.
  // A mounted notice clears the URL marker without starting another Sync.
  return path + '?quick-sync-return=1'
}
export function markQuickSyncPullStaged(accountId: string): void {
  const intent = getQuickSyncIntent(accountId)
  if (!intent) throw new Error('Quick Sync owner changed before Pull recovery')
  sessionStorage.setItem(INTENT_KEY, JSON.stringify({ ...intent, phase: 'recovering' }))
}
function emitNotice(): void {
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame(() => window.dispatchEvent(new Event(QUICK_SYNC_NOTICE_EVENT)))
  }
}
export function postQuickSyncNotice(feedback: QuickSyncFeedback): void {
  // In-page failures (e.g. local flush refused) never imply any cloud attempt.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<QuickSyncFeedback>(QUICK_SYNC_NOTICE_EVENT, { detail: feedback }))
  }
}
export function finalizeQuickSync(accountId: string, feedback: QuickSyncFeedback): string {
  const intent = getQuickSyncIntent(accountId)
  if (!intent) return '/learn'
  const target = quickSyncReturnPath(accountId)
  sessionStorage.setItem(NOTICE_KEY, JSON.stringify({
    accountId, kind: feedback.kind, message: feedback.message, at: Date.now(),
  } satisfies Notice))
  if (feedback.kind === 'ok') {
    try { localStorage.setItem(LAST_PREFIX + accountId, String(Date.now())) } catch { /* presentation only */ }
  }
  sessionStorage.removeItem(INTENT_KEY)
  emitNotice()
  return target
}
export function finishQuickSyncRecovery(accountId: string, note: string | null): boolean {
  const intent = getQuickSyncIntent(accountId)
  if (!intent) return false
  if (intent.phase === 'recovering' && note === '已完成云端学习数据安全恢复。') {
    finalizeQuickSync(accountId, { kind: 'ok', message: '学习记录已安全同步。' })
  } else {
    // A lost response or incomplete recovery cannot be called success.
    finalizeQuickSync(accountId, { kind: 'unknown', message: '同步结果暂未确认，本机学习记录仍保留。' })
  }
  return true
}
export function takeQuickSyncNotice(accountId: string | null): QuickSyncFeedback | null {
  try {
    const raw = sessionStorage.getItem(NOTICE_KEY)
    if (!raw) return null
    sessionStorage.removeItem(NOTICE_KEY)
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const value = parsed as Partial<Notice>
    if (value.accountId !== accountId ||
        !['ok', 'failed', 'unknown'].includes(value.kind || '') ||
        typeof value.message !== 'string' || value.message.length > 220 ||
        !Number.isSafeInteger(value.at) || Math.abs(Date.now() - value.at) > MAX_AGE) return null
    return { kind: value.kind as QuickSyncFeedback['kind'], message: value.message }
  } catch { return null }
}
export function lastQuickSyncAt(accountId: string): number | null {
  try {
    const value = Number(localStorage.getItem(LAST_PREFIX + accountId))
    return Number.isSafeInteger(value) && value > 0 && value <= Date.now() ? value : null
  } catch { return null }
}
export class QuickSyncStartError extends Error {}

/** Never capture a V4 snapshot from a mounted UI. Save and navigate away. */
export async function startQuickSync(
  target: QuickSyncTarget,
  beforeSave?: () => void | Promise<void>,
): Promise<void> {
  if (!allowedTarget(target) || !quickSyncAllowed()) throw new QuickSyncStartError('当前站点未启用云同步。')
  const first = loadAuth({ preserveExpired: true })
  if (!first || first.expiresAt * 1000 <= Date.now()) throw new QuickSyncStartError('请先登录账号，再进行同步。')
  if (!navigator.onLine) throw new QuickSyncStartError('当前离线，学习记录仍保存在本机。')
  await beforeSave?.()
  const { flushLearnPersistence } = await import('@/learn/persistence')
  await flushLearnPersistence()
  const current = loadAuth({ preserveExpired: true })
  if (!current || current.user.userId !== first.user.userId ||
      current.token !== first.token || current.expiresAt * 1000 <= Date.now()) {
    throw new QuickSyncStartError('账号状态发生变化，请重新登录后同步。')
  }
  // Subsequent capture/merge happens solely in S1's exclusive pre-mount realm.
  sessionStorage.setItem(INTENT_KEY, JSON.stringify({
    accountId: current.user.userId, target, createdAt: Date.now(), phase: 'requested',
  } satisfies Intent))
  window.location.replace('/?s2-sync=run&quick-sync=1')
}
