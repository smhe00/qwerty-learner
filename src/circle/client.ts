import { isLegacyCircleInvite, normalizeCirclePassphrase } from '../../cloud-functions/_shared/circle/passphrase.js'
import { loadAuth } from '@/sync/auth'
import { secureLearningEntry } from '@/sync/learning-sync-policy'
import type { CloudAuthState } from '@/sync/types'

export { normalizeCirclePassphrase, isLegacyCircleInvite }

export type CircleItem = { circleId: string; name: string; role: 'owner' | 'member' }
export type CircleMember = { userId: string; role: 'owner' | 'member'; status: string }
export type CircleProgress = { authorUserId: string; day: string; completed: boolean; newWords: number }
export type CircleDay = {
  circleId: string
  day: string
  progress: CircleProgress[]
  reactionCounts: { authorUserId: string; day: string; count: number }[]
}
export type CircleView = CircleDay & {
  schemaVersion: 3
  ownerInviteCode?: string
  meta: { name: string; ownerUserId: string; softMemberLimit: number; inviteMode?: string; inviteRevision?: string }
  members: CircleMember[]
}
export class CircleError extends Error {
  constructor(public code: string, public status = 0) {
    super(code)
    this.name = 'CircleError'
  }
}
export function circleUnavailable(): string | null {
  if (REACT_APP_DEPLOY_ENV === 'pages' || import.meta.env.VITE_QWERTY_SYNC_DISABLED === 'true') return '当前预览版暂不支持圈子。'
  if (secureLearningEntry(window.location.href)) return '请使用 HTTPS 安全站点打开圈子。'
  return null
}
export function currentCircleAuth(): CloudAuthState | null {
  const auth = loadAuth({ preserveExpired: true })
  return auth && auth.expiresAt * 1000 > Date.now() ? auth : null
}
function assertSession(auth: CloudAuthState) {
  const current = currentCircleAuth()
  if (!current || current.token !== auth.token || current.user.userId !== auth.user.userId) throw new CircleError('session_changed', 401)
}
export async function circleRequest<T>(
  auth: CloudAuthState,
  path: string,
  { method = 'GET', body, signal }: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  if (circleUnavailable()) throw new CircleError('cloud_disabled')
  assertSession(auth)
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(path) && path !== '') throw new CircleError('invalid_path')
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = window.setTimeout(abort, method === 'GET' ? 20000 : 60000)
  try {
    // Deliberately same origin: never inherit a preview's cross-origin sync override.
    // There is exactly one request; ambiguous writes are never automatically replayed.
    const response = await fetch('/api/circle/v2' + path, {
      method,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: {
        Authorization: 'Bearer ' + auth.token,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    assertSession(auth)
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new CircleError(method === 'GET' ? 'read_failed' : 'write_unknown')
    }
    assertSession(auth)
    if (!response.ok || payload?.ok !== true) {
      throw new CircleError(typeof payload?.error === 'string' ? payload.error : 'request_failed', response.status)
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'result')) throw new CircleError(method === 'GET' ? 'read_failed' : 'write_unknown')
    return payload.result as T
  } catch (error) {
    if (error instanceof CircleError) throw error
    throw new CircleError(method === 'GET' ? 'read_failed' : 'write_unknown')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}
export function circleErrorText(error: unknown): string {
  if (error instanceof CircleError) {
    if (error.status === 401) return '登录已失效，请重新登录后使用圈子。'
    if (error.status === 429) return '操作有些频繁，请稍等一会儿再试。'
    const messages: Record<string, string> = {
      invalid_circle_passphrase: '口令请填写 2–32 个字符，支持中英文，不能包含控制字符。',
      circle_passphrase_taken: '这个口令已被其他圈子使用，请换一个。',
      circle_passphrase_conflict: '这个口令有冲突，请让圈主更换后再加入。',
      circle_invite_changed: '圈主刚刚修改了口令，请刷新后使用新口令。',
      request_body_unavailable: '这次提交未能送达，请再试一次。',
      invalid_body: '这次提交未能送达，请稍后再试。',
      invalid_content_length: '这次提交未能完整送达，请稍后再试。',
      circle_internal_error: '圈子服务暂时出错，创建还未确认。请稍后继续创建。',
      circle_unavailable: '圈子服务暂时不可用，请稍后再试。',
      circle_account_limit: '每人最多加入 3 个圈子，请先退出一个。',
      circle_member_limit: '这个圈子已经满员了，请换一个圈子。',
      invalid_invite: '口令不正确，请确认已粘贴完整口令。',
      legacy_invite: '这个口令属于旧版圈子，暂不支持在此加入。',
      not_circle_member: '你已不在这个圈子里，请刷新圈子列表。',
      circle_closed: '这个圈子已关闭，请刷新圈子列表。',
      not_circle_owner: '只有圈主可以进行这项操作。',
      circle_day_expired: '这个日期已不在最近 7 天内，请刷新后查看。',
      progress_not_found: '这位同学还没有可见的打卡，请稍后刷新。',
      circle_write_unknown: '操作结果还未确认，请先刷新查看。创建圈子可以用原信息重试。',
      write_unknown: '操作结果还未确认，请先刷新查看。创建圈子可以用原信息重试。',
      local_storage: '本机暂时无法保存创建信息，请检查浏览器存储后再试。',
      cloud_disabled: '当前页面暂不支持圈子。',
      invalid_progress: '请填写 0–256 之间的整数。',
      invalid_circle_input: '圈子名称请填写 1–32 个字。',
      circle_operation_conflict: '创建信息与上次不同，请使用原信息重试。',
    }
    if (messages[error.code]) return messages[error.code]
  }
  return '暂时没能完成，请稍后刷新重试。'
}
export function circleDays(now = Date.now()): string[] {
  const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10)
  return Array.from({ length: 7 }, (_, i) => new Date(Date.parse(today + 'T00:00:00Z') - i * 86400000).toISOString().slice(0, 10))
}
export function memberLabel(id: string, ownId: string): string {
  return id === ownId ? '我' : '同学 ' + id.slice(-6)
}

export type CreateDraft = { name: string; operationId: string; passphrase?: string }
type Hints = { pending?: CreateDraft; invites: Record<string, string>; inviteRevisions?: Record<string, string> }
const hintsKey = (userId: string) => 'qwerty.circle-ui.v1.' + userId
export function readCircleHints(userId: string): Hints {
  try {
    const value = JSON.parse(localStorage.getItem(hintsKey(userId)) || 'null')
    const invites: Record<string, string> = {}
    for (const [id, code] of Object.entries(value?.invites || {})) {
      if (
        /^[a-f0-9]{24}$/.test(id) &&
        typeof code === 'string' &&
        ((isLegacyCircleInvite(code) && code.startsWith('QC3-' + id + '-')) || normalizeCirclePassphrase(code) === code)
      )
        invites[id] = code
    }
    const pending = value?.pending
    return {
      invites,
      inviteRevisions: Object.fromEntries(
        Object.entries(value?.inviteRevisions || {}).filter(
          (entry): entry is [string, string] => /^[a-f0-9]{24}$/.test(entry[0]) && typeof entry[1] === 'string' && entry[1].length <= 80,
        ),
      ),
      ...(pending &&
      typeof pending.name === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(pending.operationId)
        ? {
            pending: {
              name: pending.name,
              operationId: pending.operationId,
              ...(typeof pending.passphrase === 'string' ? { passphrase: pending.passphrase } : {}),
            },
          }
        : {}),
    }
  } catch {
    return { invites: {} }
  }
}
export function saveCircleHints(userId: string, hints: Hints): void {
  try {
    localStorage.setItem(hintsKey(userId), JSON.stringify(hints))
  } catch {
    throw new CircleError('local_storage')
  }
}
