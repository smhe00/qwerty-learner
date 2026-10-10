/**
 * S1 global forced-session logout adapter.
 *
 * Detects ONLY server-authenticated session_revoked. Never treats network
 * failures, server outages or normal expiry as a second-device takeover.
 * The mounted app may show the warning, but the actual owner transition is
 * performed exclusively by the NEXT pre-mount WebLock-protected document.
 */
import { SyncApiError, getMe } from './api'
import { loadAuth } from './auth'
import type { GuardedWorkspaceBoot } from './workspace-bootstrap'
import type { Registry } from './workspace-transition'

const HANDOFF_KEY = 'qwerty.s1.revoked-logout-intent.v1'
const REVOKED_EVENT = 'qwerty:cloud-session-revoked'
const PROBE_INTERVAL_MS = 30_000
const FOCUS_THROTTLE_MS = 5_000

type ConfirmedLogoutIntent = {
  version: 1
  accountId: string
  generation: number
}

function readHandoff(): ConfirmedLogoutIntent | null {
  const raw = sessionStorage.getItem(HANDOFF_KEY)
  if (!raw) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw Error('Corrupt revoked-session handoff') }
  if (!value || typeof value !== 'object') throw Error('Invalid revoked-session handoff')
  const intent = value as Partial<ConfirmedLogoutIntent>
  if (intent.version !== 1 || typeof intent.accountId !== 'string' ||
      !intent.accountId.trim() || !Number.isSafeInteger(intent.generation) ||
      (intent.generation ?? 0) < 1) {
    throw Error('Invalid revoked-session account ownership handoff')
  }
  return intent as ConfirmedLogoutIntent
}

function addText<K extends keyof HTMLElementTagNameMap>(
  tag: K, text: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.textContent = text
  return node
}

export function startSessionRevocationMonitor(registry: Registry): () => void {
  if (registry.pending || registry.active.kind !== 'account' ||
      registry.generation < 1) return () => undefined
  const accountId = registry.active.accountId
  const currentToken = loadAuth({ preserveExpired: true })?.token
  if (!currentToken) return () => undefined
  let busy = false
  let stopped = false
  let revealed = false
  let lastProbeAt = 0
  let modal: HTMLDivElement | undefined

  const currentAuth = () => {
    const auth = loadAuth({ preserveExpired: true })
    return auth?.user.userId === accountId && auth.token === currentToken ? auth : null
  }
  const stop = () => {
    stopped = true
    window.clearInterval(interval)
    window.removeEventListener(REVOKED_EVENT, onApiRevoked)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisible)
  }
  const reveal = () => {
    if (stopped || revealed || !currentAuth()) return
    revealed = true
    stop()
    const shell = document.createElement('div')
    modal = shell
    shell.setAttribute('role', 'alertdialog')
    shell.setAttribute('aria-modal', 'true')
    shell.setAttribute('aria-labelledby', 'qwerty-revoked-title')
    shell.style.cssText = 'position:fixed;inset:0;z-index:2147483647;' +
      'display:flex;align-items:center;justify-content:center;padding:24px;' +
      'background:rgba(9,17,31,.76);font:16px/1.7 system-ui,sans-serif'
    const panel = document.createElement('section')
    panel.style.cssText = 'max-width:520px;background:#fff;color:#0f172a;' +
      'padding:28px;border-radius:12px;box-shadow:0 12px 44px #0006'
    const title = addText('h2', '账号已在其他设备登录')
    title.id = 'qwerty-revoked-title'
    title.style.cssText = 'font-size:22px;font-weight:650;margin:0 0 12px'
    const detail = addText('p',
      '此设备的云端会话已被新登录取代。确认后，将完整保存本机属于原账号的学习记录，并安全切换到本机匿名工作区。未同步进度不会自动上传或合并，也不会被删除。')
    const note = addText('p', '请确认退出；切换过程中不要关闭页面。')
    note.setAttribute('role', 'status')
    const confirm = addText('button', '确认退出并切换到本机匿名工作区')
    confirm.type = 'button'
    confirm.style.cssText = 'margin-top:12px;padding:10px 16px;' +
      'border:0;border-radius:7px;color:#fff;background:#334155;cursor:pointer'
    confirm.addEventListener('click', () => {
      if (!currentAuth()) {
        note.textContent = '会话或工作区身份已改变；请刷新以重新检查。'
        confirm.disabled = true
        return
      }
      try {
        const intent: ConfirmedLogoutIntent = {
          version: 1, accountId, generation: registry.generation,
        }
        sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(intent))
        confirm.disabled = true
        note.textContent = '已确认；正在进入安全事务页面保存原账号学习进度…'
        // Never run the S1 transaction from a mounted React/RecordDB context.
        window.location.replace('/?s1-session-revoked=confirm')
      } catch {
        note.textContent = '无法保存切换意图；原账号数据仍保留。请重新尝试。'
        confirm.disabled = false
      }
    })
    panel.append(title, detail, note, confirm)
    shell.append(panel)
    document.body.append(shell)
    confirm.focus()
  }
  const onApiRevoked = () => reveal()
  const probe = async (throttled: boolean) => {
    if (stopped || revealed || busy || document.visibilityState === 'hidden') return
    if (throttled && Date.now() - lastProbeAt < FOCUS_THROTTLE_MS) return
    const auth = currentAuth()
    if (!auth) return
    if (auth.expiresAt * 1000 <= Date.now()) return // ordinary expiry != takeover
    busy = true
    lastProbeAt = Date.now()
    const checkedToken = auth.token
    try {
      const result = await getMe(checkedToken)
      if (result.user.userId !== accountId) {
        // Suspicious identity response must not trigger an automatic logout.
        console.error('Current cloud session returned a different immutable account ID')
      }
    } catch (error) {
      if (error instanceof SyncApiError &&
          error.status === 401 && error.code === 'session_revoked' &&
          currentAuth()?.token === checkedToken) reveal()
      // No forced logout for network errors, 429/503, or session_expired.
    } finally { busy = false }
  }
  const onFocus = () => { void probe(true) }
  const onVisible = () => {
    if (document.visibilityState === 'visible') void probe(true)
  }
  window.addEventListener(REVOKED_EVENT, onApiRevoked)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisible)
  const interval = window.setInterval(() => { void probe(false) }, PROBE_INTERVAL_MS)
  void probe(false)
  return () => {
    stop()
    modal?.remove()
  }
}

/**
 * Only called after guarded S1 bootstrap, before importing the mounted app.
 * Page route is a continuation of an explicit button confirmation, not
 * authorization to change an arbitrary account workspace.
 */
export async function completeConfirmedRevokedLogout(
  boot: GuardedWorkspaceBoot,
  onStatus: (title: string, text: string) => void,
): Promise<void> {
  const intent = readHandoff()
  if (!intent) throw Error('Missing confirmed forced-logout handoff')
  if (boot.mode !== 'isolated' || boot.registry.pending ||
      boot.registry.generation < intent.generation) {
    throw Error('S1 forced logout requires a recovered isolated workspace')
  }
  if (boot.registry.active.kind === 'anonymous') {
    // Only a single completed account->anonymous generation increment can
    // confirm this handoff. Never accept an unrelated anonymous registry.
    if (boot.registry.generation !== intent.generation + 1) {
      throw Error('S1 revoked-session handoff does not match completed logout')
    }
    // A previous attempt may have committed before navigation/reload.
    sessionStorage.removeItem(HANDOFF_KEY)
    sessionStorage.setItem('qwerty.s1.last-account-result',
      '已安全退出失效会话，原账号本机学习记录已保存，当前是匿名工作区。')
    window.location.replace('/')
    return
  }
  if (boot.registry.active.accountId !== intent.accountId ||
      boot.registry.generation !== intent.generation ||
      loadAuth({ preserveExpired: true })?.user.userId !== intent.accountId) {
    throw Error('S1 forced logout account identity/generation mismatch; data unchanged')
  }
  onStatus('正在安全退出失效账号', '正在保存原账号完整 V4 本地学习数据，请不要关闭页面。')
  const { switchAuthenticatedWorkspace } = await import('./workspace-auth-transaction')
  await switchAuthenticatedWorkspace({ kind: 'anonymous' }, null, phase => {
    const messages: Record<string, string> = {
      saving: '正在保存原账号本机完整学习数据…',
      prepared: '安全事务已提交，正在切换匿名工作区…',
      restoring: '正在恢复本地匿名工作区…',
      recovering: '正在恢复中断的安全事务…',
      complete: '原账号数据保存完成；正在重新进入匿名工作区…',
    }
    onStatus('正在安全退出失效账号', messages[phase] ?? '正在执行安全切换…')
  })
  sessionStorage.removeItem(HANDOFF_KEY)
  sessionStorage.setItem('qwerty.s1.last-account-result',
    '账号在其他设备登录，本机现已安全退出到匿名工作区；原账号学习记录已独立保存。')
  window.location.replace('/')
}
