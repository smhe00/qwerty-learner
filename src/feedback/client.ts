import { loadAuth } from '@/sync/auth'

export const feedbackEnabled = REACT_APP_DEPLOY_ENV !== 'pages' && import.meta.env.VITE_QWERTY_SYNC_DISABLED !== 'true'
export const openFeedback = () => window.dispatchEvent(new Event('qwerty:feedback-open'))
const GUESTS = 'qwerty.feedback.guests.v1'
const ACTIVE = 'qwerty.feedback.active.v1'
export const randomKey = (length = 32) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (x) => x.toString(16).padStart(2, '0')).join('')
export type Identity = { token: string; owner: string } | { secret: string }
export type Item = { owner: string; id: string; title: string; createdAt: number }
export type Message = { id: string; text: string; role: 'user' | 'admin'; createdAt: number; status: Status }
export type Status = 'waiting' | 'handling' | 'resolved'
export type Thread = Item & { text: string; messages: Message[]; status: Status }
export type Pending = { path: string; body: { operationId: string; text: string; title?: string; status?: Status } }
export const statusText: Record<Status, string> = { waiting: '待回复', handling: '处理中', resolved: '已解决' }
export function currentAccount(): Extract<Identity, { token: string }> | null {
  const auth = loadAuth({ preserveExpired: true })
  // Preserve an expired account as an error instead of silently posting anonymously.
  return auth ? { token: auth.token, owner: auth.user.userId } : null
}
export function guestKeys(): string[] {
  const values: unknown = JSON.parse(localStorage.getItem(GUESTS) || '[]')
  return Array.isArray(values) ? values.filter((x): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)) : []
}
export function selectGuest(secret?: string): string {
  const keys = guestKeys()
  const selected = secret || localStorage.getItem(ACTIVE) || keys[0] || randomKey()
  if (!/^[a-f0-9]{64}$/.test(selected)) throw new Error('匿名入口无法读取。')
  if (!keys.includes(selected)) localStorage.setItem(GUESTS, JSON.stringify([...keys, selected]))
  localStorage.setItem(ACTIVE, selected)
  return selected
}
function pendingKey(identity: Identity) {
  return 'qwerty.feedback.pending.v1.' + ('token' in identity ? identity.owner : identity.secret)
}
export function readPending(identity: Identity): Pending | null {
  const value = localStorage.getItem(pendingKey(identity))
  return value ? JSON.parse(value) : null
}
export function savePending(identity: Identity, value: Pending | null) {
  if (value) localStorage.setItem(pendingKey(identity), JSON.stringify(value))
  else localStorage.removeItem(pendingKey(identity))
}
export class FeedbackRejectedError extends Error {}
export async function feedbackRequest<T>(identity: Identity, path: string, body?: Pending['body']): Promise<T> {
  if (!feedbackEnabled) throw new Error('预览站不提供在线反馈，请前往正式站。')
  const account = currentAccount()
  if (account ? !('token' in identity) || account.token !== identity.token || account.owner !== identity.owner : 'token' in identity) {
    throw new Error('登录状态已改变，请关闭后重新打开反馈。')
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch('/api/feedback' + path, {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...('token' in identity ? { Authorization: 'Bearer ' + identity.token } : { 'X-Feedback-Key': identity.secret }),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const result = await response.json()
    if (!response.ok) {
      if (response.status === 401) throw new Error('登录已失效，请重新登录后查看或发送反馈。')
      const message = typeof result.message === 'string' ? result.message : '暂时无法读取反馈，请稍后重试。'
      if (response.status >= 400 && response.status < 500 && response.status !== 429 && result.ok === false)
        throw new FeedbackRejectedError(message)
      throw new Error(message)
    }
    if (!result || result.ok !== true) throw new SyntaxError('Unconfirmed feedback response')
    return result as T
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError || (error instanceof Error && error.name === 'AbortError')) {
      throw new Error(body ? '发送结果尚未确认。内容已保留，请重试发送。' : '网络暂时不可用，请稍后刷新。')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}
