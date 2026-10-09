/**
 * S1 account controls are deliberately PRE-MOUNT: the React/RecordDB writer
 * tree must not exist while switching IndexedDB and per-workspace settings.
 * Only the active guarded entry may render this surface under the writer lease.
 */
import { login, register } from './api'
import { browserDeviceId, loadAuth } from './auth'
import { reauthenticateSameWorkspace, switchAuthenticatedWorkspace } from './workspace-auth-transaction'
import { copyAnonymousWorkspaceForNewRegistration } from './workspace-coordinator'
import { same } from './workspace-transition'
import type { Phase, Workspace } from './workspace-transition'
import type { CloudAuthState } from './types'
import { workspaceRegistryPort } from './workspace-vault'

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K, text = '',
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag)
  if (text) result.textContent = text
  return result
}

function credential(result: {
  user: CloudAuthState['user']
  token: string
  expiresAt: number
}): CloudAuthState {
  return { user: result.user, token: result.token, expiresAt: result.expiresAt }
}

const explanation = '切换账户前，本机完整 V4 工作区将安全保存。不会自动上传，也不会合并两个账号的数据。' +
  '如果登录账号在本机没有旧工作区，将创建一个空工作区；后续由 S2 同步云端数据。'

/** No React, domain writer, or workspace IO is imported before S1 boot. */
export function renderS1AccountManagement(root: HTMLElement | null, active: Workspace): void {
  if (!root) throw new Error('Missing S1 account UI root')
  const main = node('section')
  main.style.cssText = 'max-width:620px;margin:6vh auto;padding:26px;font-family:system-ui,sans-serif;color:#334155;line-height:1.7'
  const heading = node('h1','安全账户管理（S1）')
  heading.style.cssText = 'font-size:23px;font-weight:600'
  const current = node('p', active.kind === 'account'
    ? '当前工作区：账户 ID ' + active.accountId
    : '当前工作区：本机匿名账户')
  current.setAttribute('data-s1-current-owner', active.kind === 'account' ? active.accountId : 'anonymous')
  const accountAuth = loadAuth({ preserveExpired: true })
  const authState = node('p', active.kind === 'anonymous'
    ? '身份状态：匿名工作区，未关联云端会话。'
    : !accountAuth || accountAuth.user.userId !== active.accountId
      ? '身份状态：账户所有权待验证；禁止以其他账号覆盖本机数据。'
      : accountAuth.expiresAt * 1000 <= Date.now()
        ? '身份状态：云端会话已过期，本机学习记录继续归属于当前账户；请重新认证。'
        : '身份状态：已保存当前账户会话。本机工作区与云端会话相互独立。')
  const guidance = node('p', explanation)
  guidance.style.cssText = 'margin:16px 0'
  const status = node('p', '状态：就绪')
  status.setAttribute('role', 'status')
  status.style.cssText = 'margin:16px 0;white-space:pre-wrap'
  const actions = node('div')
  actions.style.cssText = 'display:grid;gap:12px;max-width:440px'
  const row = (text: string, type: HTMLInputElement['type'] = 'text'): HTMLInputElement => {
    const input = node('input')
    input.type = type
    input.placeholder = text
    input.setAttribute('aria-label', text)
    input.style.cssText = 'border:1px solid #94a3b8;border-radius:6px;padding:9px'
    actions.append(input)
    return input
  }
  const button = (text: string, action: () => void) => {
    const el = node('button', text)
    el.type = 'button'
    el.style.cssText = 'padding:9px;border-radius:6px;border:1px solid #64748b'
    el.addEventListener('click', action)
    actions.append(el)
    return el
  }
  const username = row('用户名')
  username.autocomplete = 'username'
  const password = row('账户密码', 'password')
  password.autocomplete = 'current-password'
  let passwordConfirm: HTMLInputElement | undefined
  if (active.kind === 'anonymous') {
    passwordConfirm = row('注册密码确认', 'password')
    passwordConfirm.autocomplete = 'new-password'
  }

  const controls: HTMLButtonElement[] = []
  const setBusy = (busy: boolean, note: string) => {
    status.textContent = '状态：' + note
    controls.forEach(control => { control.disabled = busy })
  }
  const safeRun = (action: () => Promise<void>) => {
    setBusy(true, '准备中…')
    void action().catch(error => {
      setBusy(false, '操作未完成，当前工作区不应被删除。' +
        (error instanceof Error ? error.message : String(error)) +
        '。如提示事务中断，请重新加载以执行恢复。')
    })
  }
  const phase = (p: Phase) => setBusy(true,
    ({
      saving: '正在持久化当前完整学习记录…',
      prepared: '事务日志已提交，正在准备目标工作区…',
      restoring: '正在恢复目标账户学习记录…',
      recovering: '正在故障恢复…',
      complete: '工作区切换成功，正在重新载入…',
      failed: '事务中断，需要验证恢复状态…',
    } as Record<Phase,string>)[p])
  const navigate = (message?: string) => {
    if (message) sessionStorage.setItem('qwerty.s1.last-account-result', message)
    window.location.replace('/')
  }
  const reauth = async () => {
    const signed = credential(await login(username.value.trim(), password.value, browserDeviceId()))
    await reauthenticateSameWorkspace(signed)
    setBusy(true, '账户会话更新成功，工作区保持不变。')
    navigate('重新登录成功，工作区身份与学习数据保持不变。')
  }
  const loginAction = async () => {
    if (!username.value.trim() || password.value.length < 4) {
      throw new Error('请输入用户名和至少四位密码')
    }
    const signed = credential(await login(username.value.trim(), password.value, browserDeviceId()))
    if (active.kind === 'account') {
      if (active.accountId !== signed.user.userId) {
        throw new Error('当前属于另一账户，必须先明确退出到匿名工作区')
      }
      return reauthenticateSameWorkspace(signed).then(() => navigate('当前账户已重新认证，学习进度未改变。'))
    }
    if (!window.confirm(
      '将从匿名工作区切换到“' + signed.user.username + '”。' +
      '匿名学习进度会独立保存，不合并到已有账户。确认继续？'
    )) { setBusy(false, '用户已取消登录切换'); return }
    await switchAuthenticatedWorkspace({ kind: 'account', accountId: signed.user.userId }, signed, phase)
    setBusy(true, '登录及本地隔离工作区切换完成。')
    navigate('登录成功，已进入独立的账户学习工作区。')
  }
  const registerAction = async () => {
    if (active.kind !== 'anonymous') throw new Error('注册仅允许从匿名工作区进行')
    if (!username.value.trim() || password.value.length < 4 || password.value !== passwordConfirm?.value) {
      throw new Error('请检查用户名与两次输入的注册密码')
    }
    const copy = window.confirm(
      '是否将当前匿名工作区的全部学习数据复制到新账户？\n' +
      '确定：复制完整 V4 数据；取消：新账户从空白开始。匿名原记录始终保留。'
    )
    if (!window.confirm('确认使用该用户名注册新账户？注册成功后会切换到新账户。')) {
      setBusy(false, '用户已取消注册'); return
    }
    const signed = credential(await register(username.value.trim(), password.value, browserDeviceId()))
    if (copy) {
      setBusy(true, '新账户已注册，正在复制匿名学习数据…')
      await copyAnonymousWorkspaceForNewRegistration(signed.user.userId)
    }
    await switchAuthenticatedWorkspace({ kind: 'account', accountId: signed.user.userId }, signed, phase)
    setBusy(true, '注册成功，当前工作区已切换。')
    navigate(copy ? '注册成功，匿名学习记录已复制，新旧工作区分别保留。' : '注册成功，已建立独立空白工作区。')
  }
  const logoutAction = async () => {
    if (active.kind !== 'account') return
    const auth = loadAuth({ preserveExpired: true })
    // Logout is a local durability operation at S1, NOT a cloud preflight.
    // No fetch is permitted here: offline/stalled DNS/auth revocation must
    // never prevent the user from leaving a locally isolated account.
    let warning = '将退出当前账户并切换到本机匿名工作区。完整本地学习记录会保留在原账户工作区。'
    warning += '\nS1 不自动上传：本次退出前的未同步学习进度仍只保存在本机。'
    if (!auth || auth.expiresAt * 1000 <= Date.now()) {
      warning += '\n云端会话已过期；离线退出仍可完成。'
    }
    if (!window.confirm(warning + '\n确定仍要安全退出？')) {
      setBusy(false, '用户已取消退出'); return
    }
    await switchAuthenticatedWorkspace({ kind: 'anonymous' }, null, phase)
    setBusy(true, '退出成功，已恢复匿名工作区。')
    navigate('安全退出成功，原账户的本地学习进度已保存，当前为匿名工作区。')
  }
  if (active.kind === 'anonymous') {
    controls.push(button('登录已有账户', () => safeRun(loginAction)))
    controls.push(button('注册新账户', () => safeRun(registerAction)))
  } else {
    controls.push(button('重新登录当前账户', () => safeRun(reauth)))
    controls.push(button('退出到匿名工作区', () => safeRun(logoutAction)))
  }
  const back = button('返回学习', navigate)
  controls.push(back)
  main.append(heading,current,authState,guidance,actions,status)
  root.replaceChildren(main)
  void workspaceRegistryPort.read().then(registry => {
    if (registry.pending || !same(registry.active, active)) {
      controls.forEach(x => { x.disabled = true })
      status.textContent = '状态：账户与本地工作区不一致，禁止操作。'
    }
  }).catch(error => {
    controls.forEach(x => { x.disabled = true })
    status.textContent = String(error)
  })
}
