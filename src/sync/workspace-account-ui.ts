/**
 * S1 account controls are deliberately PRE-MOUNT: the React/RecordDB writer
 * tree must not exist while switching IndexedDB and per-workspace settings.
 * Only the active guarded entry may render this surface under the writer lease.
 */
import { SyncApiError, changePassword, login, register } from './api'
import { browserDeviceId, loadAuth } from './auth'
import { presentAccount } from './mobile-account-view'
import type { CloudAuthState } from './types'
import { reauthenticateSameWorkspace, switchAuthenticatedWorkspace } from './workspace-auth-transaction'
import { copyAnonymousWorkspaceForNewRegistration } from './workspace-coordinator'
import { same } from './workspace-transition'
import type { Phase, Workspace } from './workspace-transition'
import { workspaceRegistryPort } from './workspace-vault'

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag)
  if (text) result.textContent = text
  return result
}

function credential(result: { user: CloudAuthState['user']; token: string; expiresAt: number }): CloudAuthState {
  return { user: result.user, token: result.token, expiresAt: result.expiresAt }
}

/** No React, domain writer, or workspace IO is imported before S1 boot. */
export function renderS1AccountManagement(
  root: HTMLElement | null,
  active: Workspace,
  options: { mobile?: boolean; cloudDisabled?: boolean } = {},
): void {
  if (!root) throw new Error('Missing S1 account UI root')
  const mobile = options.mobile === true
  // The live learning application cannot stay mounted while S1 switches
  // databases. Render the shared account document before mounting React
  // so account transitions cannot race ongoing IndexedDB writers.
  const overlay = node('div')
  const main = node('section')
  main.setAttribute('aria-labelledby', 'account-dialog-title')
  const heading = node('h1')
  heading.id = 'account-dialog-title'
  const current = node('p')
  current.setAttribute('data-s1-current-owner', active.kind === 'account' ? active.accountId : 'anonymous')
  const accountAuth = loadAuth({ preserveExpired: true })
  const authState = node('p')
  const guidance = node('p')
  const status = node('p')
  status.setAttribute('role', 'status')
  const actions = node('div')
  const row = (text: string, type: HTMLInputElement['type'] = 'text'): HTMLInputElement => {
    const input = node('input')
    input.type = type
    input.placeholder = text
    input.setAttribute('aria-label', text)
    actions.append(input)
    return input
  }
  const button = (text: string, action: () => void) => {
    const el = node('button', text)
    el.type = 'button'
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
  let isBusy = false
  const setBusy = (busy: boolean, note: string) => {
    isBusy = busy
    status.textContent = note
    controls.forEach((control) => {
      control.disabled = busy
    })
    accountView?.setBusy(busy)
  }
  const safeRun = (action: () => Promise<void>) => {
    if (isBusy) return
    setBusy(true, '准备中…')
    void action().catch((error) => {
      let detail = error instanceof Error ? error.message : String(error)
      if (error instanceof SyncApiError) {
        detail =
          (
            {
              invalid_credentials: '用户名或密码不正确，请重新输入。',
              account_not_found: '账号不存在，请检查用户名或先注册。',
              incorrect_password: '密码不正确，请重新输入。',
              username_taken: '这个用户名已被使用，请换一个。',
              invalid_username: '用户名需为 3–32 个字符，不能包含空格或特殊路径字符。',
              invalid_password: '密码需为 4–128 位。',
              session_revoked: '登录状态已失效，请重新登录当前账号。',
              session_expired: '登录已过期，请重新登录当前账号。',
              invalid_token: '登录状态无效，请重新登录当前账号。',
              cloud_disabled: '此开发预览暂不提供登录和注册。',
            } as Record<string, string>
          )[error.code] || '暂时无法完成认证，请稍后重试。'
      } else if (error instanceof TypeError) detail = '暂时无法连接服务，请检查网络后重试。'
      setBusy(false, detail + ' 本机学习记录仍保留。')
    })
  }
  const phase = (p: Phase) =>
    setBusy(
      true,
      (
        {
          saving: '正在持久化当前完整学习记录…',
          prepared: '正在准备账号学习空间…',
          restoring: '正在恢复目标账户学习记录…',
          recovering: '正在故障恢复…',
          complete: '已完成，正在返回学习…',
          failed: '事务中断，需要验证恢复状态…',
        } as Record<Phase, string>
      )[p],
    )
  const navigate = (message?: string) => {
    if (message) sessionStorage.setItem('qwerty.s1.last-account-result', message)
    window.location.replace((REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner' : '') + (mobile ? '/mobile' : '/'))
  }
  // Authentication switches the isolated workspace under this document's S1
  // lease. The destination guarded boot is the SINGLE synchronization owner:
  // full V4 first, then M3/M4, before any learning writer mounts. Running that
  // pipeline here as well downloads/replays the same history twice.
  const finishAuthentication = () => {
    sessionStorage.removeItem('qwerty.etest.m4.idleBlocked')
    navigate()
  }
  const reauth = async () => {
    const signed = credential(await login(username.value.trim(), password.value, browserDeviceId()))
    await reauthenticateSameWorkspace(signed)
    finishAuthentication()
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
      await reauthenticateSameWorkspace(signed)
      finishAuthentication()
      return
    }
    if (!window.confirm('将从匿名工作区切换到“' + signed.user.username + '”。' + '匿名学习进度会独立保存，不合并到已有账户。确认继续？')) {
      setBusy(false, '用户已取消登录切换')
      return
    }
    await switchAuthenticatedWorkspace({ kind: 'account', accountId: signed.user.userId }, signed, phase)
    finishAuthentication()
  }
  const registerAction = async () => {
    if (active.kind !== 'anonymous') throw new Error('注册仅允许从匿名工作区进行')
    if (!username.value.trim() || password.value.length < 4 || password.value !== passwordConfirm?.value) {
      throw new Error('请检查用户名与两次输入的注册密码')
    }
    const copy = window.confirm('是否把本机匿名学习记录复制到新账号？\n确定：复制记录；取消：新账号从空白开始。本机匿名记录始终保留。')
    if (!window.confirm('确认使用该用户名注册新账户？注册成功后会切换到新账户。')) {
      setBusy(false, '用户已取消注册')
      return
    }
    const signed = credential(await register(username.value.trim(), password.value, browserDeviceId()))
    if (copy) {
      setBusy(true, '新账户已注册，正在复制匿名学习数据…')
      await copyAnonymousWorkspaceForNewRegistration(signed.user.userId)
    }
    await switchAuthenticatedWorkspace({ kind: 'account', accountId: signed.user.userId }, signed, phase)
    finishAuthentication()
  }
  const changePasswordAction = async (currentPassword: string, newPassword: string) => {
    const auth = loadAuth({ preserveExpired: true })
    if (active.kind !== 'account' || !auth || auth.user.userId !== active.accountId || auth.expiresAt * 1000 <= Date.now()) {
      throw new Error('请先重新登录当前账号，再修改密码。')
    }
    let signed: CloudAuthState
    try {
      signed = credential(await changePassword(auth.token, currentPassword, newPassword, browserDeviceId()))
    } catch (error) {
      if (error instanceof SyncApiError && error.code === 'invalid_credentials') throw new Error('当前密码不正确，请重新输入。')
      if (error instanceof SyncApiError && ['invalid_password', 'session_revoked', 'session_expired', 'invalid_token'].includes(error.code))
        throw error
      // A lost response does not prove the cloud password stayed unchanged.
      throw new Error('未能确认密码修改结果。请重新登录；若旧密码不可用，请尝试新密码。')
    }
    try {
      await reauthenticateSameWorkspace(signed)
    } catch {
      throw new Error('密码已修改，但本机登录状态未能更新。请使用新密码重新登录当前账号。')
    }
    navigate('密码修改成功，学习记录保持不变。')
  }
  const logoutAction = async () => {
    if (active.kind !== 'account') return
    const auth = loadAuth({ preserveExpired: true })
    // Logout is a local durability operation at S1, NOT a cloud preflight.
    // No fetch is permitted here: offline/stalled DNS/auth revocation must
    // never prevent the user from leaving a locally isolated account.
    let warning = '将退出当前账户并切换到本机匿名工作区。完整本地学习记录会保留在原账户工作区。'
    warning += '\n退出前的未同步学习进度仍只保存在本机。'
    if (!auth || auth.expiresAt * 1000 <= Date.now()) {
      warning += '\n云端会话已过期；离线退出仍可完成。'
    }
    if (!window.confirm(warning + '\n确定仍要安全退出？')) {
      setBusy(false, '用户已取消退出')
      return
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
    const logout = button('安全退出登录', () => safeRun(logoutAction))
    controls.push(logout)
  }
  // DOM event listeners receive PointerEvent; never stringify it as a toast.
  const back = button('取消并返回学习', () => navigate())
  controls.push(back)
  main.append(heading, current, authState, guidance, actions, status)
  overlay.append(main)
  root.replaceChildren(overlay)
  const accountView = presentAccount({
    mobile,
    reauthenticate: new URLSearchParams(window.location.search).get('s1-reauth') === '1',
    overlay,
    main,
    heading,
    current,
    authState,
    guidance,
    status,
    actions,
    username,
    password,
    passwordConfirm,
    controls,
    active,
    auth: accountAuth,
    cloudDisabled: options.cloudDisabled === true,
    onChangePassword: (currentPassword, newPassword) => safeRun(() => changePasswordAction(currentPassword, newPassword)),
  })
  // Keep focus inside the account surface rather than starting a typing
  // session in the background. Input focus does not send auth requests.
  void workspaceRegistryPort
    .read()
    .then((registry) => {
      if (registry.pending || !same(registry.active, active)) {
        controls.forEach((x) => {
          x.disabled = true
        })
        accountView?.setBusy(true)
        status.textContent = '状态：账户与本地工作区不一致，禁止操作。'
      }
    })
    .catch((error) => {
      controls.forEach((x) => {
        x.disabled = true
      })
      accountView?.setBusy(true)
      status.textContent = String(error)
    })
}
