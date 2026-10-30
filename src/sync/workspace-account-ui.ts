import { administratorPath, rememberAdministratorSession } from '../admin/session'
import { administrationRequest } from '../admin/client'
/**
 * S1 account controls are deliberately PRE-MOUNT: the React/RecordDB writer
 * tree must not exist while switching IndexedDB and per-workspace settings.
 * Only the active guarded entry may render this surface under the writer lease.
 */
import { claimAccountVisit, finishPassiveAccountVisit } from './account-passive-return'
import { beginAccountReturn } from './account-journey'
import { mountSelfDeleteControls } from './account-self-delete'
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
  options: { mobile?: boolean; cloudDisabled?: boolean; registryGeneration?: number } = {},
): void {
  if (!root) throw new Error('Missing S1 account UI root')
  const mobile = options.mobile === true
  const entryRegistry = { version: 1 as const, generation: options.registryGeneration ?? 0, active, pending: null }
  let passiveVisit = claimAccountVisit(entryRegistry, mobile)
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
  let authenticationAccepted = false
  const setBusy = (busy: boolean, note: string) => {
    isBusy = busy
    status.textContent = note
    controls.forEach((control) => {
      control.disabled = busy
    })
    accountView?.setBusy(busy)
    selfDeleteView?.setBusy(busy)
  }
  const safeRun = (action: () => Promise<void>) => {
    if (isBusy) return
    passiveVisit = null // Even failed/cancelled authentication may have an unknown server outcome.
    setBusy(true, '准备中…')
    void action().catch((error) => {
      if (authenticationAccepted) {
        status.textContent = '学习数据准备未完成，本机记录仍保留。重新检查后可继续。'
        accountView?.showPreparationError?.()
        return
      }
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
              account_cleanup_pending: '账号正在进行到期维护，已请求取消清理；请稍后重试。',
              environment_password_managed: '此账号暂不支持在这里修改密码。',
              administrator_protected: '此账号不支持删除。',
              administrator_account_reserved: '管理员账号无需注册，请使用 admin 登录。',
              administrator_login_name: '管理员请使用 admin 登录。',
              administrator_password_unconfigured: '管理员登录尚未配置，请联系站点维护者。',
              administrator_name_conflict: '管理员用户名与已有账号冲突，请联系站点维护者。',
              administrator_binding_unavailable: '管理员身份暂时不可用，请联系站点维护者。',
              username_cleanup_pending: '该用户名正在完成到期清理，请24小时后重试注册。',
              invalid_token: '登录状态无效，请重新登录当前账号。',
              https_required: '请打开 HTTPS 安全站点后登录和同步。',
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
          saving: '正在保存学习记录…',
          prepared: '正在准备学习进度…',
          restoring: '正在加载学习记录…',
          recovering: '正在恢复学习记录…',
          complete: '已完成，正在返回学习…',
          failed: '操作未完成，正在检查…',
        } as Record<Phase, string>
      )[p],
    )
  const navigate = (message?: string) => {
    if (message) sessionStorage.setItem('qwerty.s1.last-account-result', message)
    beginAccountReturn(mobile, authenticationAccepted ? 'preparing' : 'returning')
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
  const enterAdministration = async (signed: CloudAuthState) => {
    if (!/^admin$/i.test(signed.user.username)) return false
    const access = await administrationRequest<{ administrator: boolean }>('/api/admin/access', { token: signed.token, anonymous: true })
    if (access.administrator !== true) throw new Error('该账号未通过管理员权限核验。')
    rememberAdministratorSession(signed)
    window.location.replace(administratorPath())
    return true
  }
  const reauth = async () => {
    const signed = credential(await login(username.value.trim(), password.value, browserDeviceId()))
    if (await enterAdministration(signed)) return
    if (active.kind !== 'account' || signed.user.userId !== active.accountId) throw new Error('请使用当前账号重新登录。')
    authenticationAccepted = true
    accountView?.setPreparing?.()
    await reauthenticateSameWorkspace(signed)
    finishAuthentication()
  }
  const loginAction = async () => {
    if (!username.value.trim() || password.value.length < 4) {
      throw new Error('请输入用户名和至少四位密码')
    }
    const signed = credential(await login(username.value.trim(), password.value, browserDeviceId()))
    if (await enterAdministration(signed)) return
    if (active.kind === 'account') {
      if (active.accountId !== signed.user.userId) {
        throw new Error('请先退出当前账号，再登录其他账号。')
      }
      await reauthenticateSameWorkspace(signed)
      finishAuthentication()
      return
    }
    authenticationAccepted = true
    accountView?.setPreparing?.()
    await switchAuthenticatedWorkspace({ kind: 'account', accountId: signed.user.userId }, signed, phase)
    finishAuthentication()
  }
  const registerAction = async () => {
    if (active.kind !== 'anonymous') throw new Error('注册仅允许从匿名工作区进行')
    if (!username.value.trim() || password.value.length < 4 || password.value !== passwordConfirm?.value) {
      throw new Error('请检查用户名与两次输入的注册密码')
    }
    const copy = accountView?.copyAnonymousRecords?.() === true
    const signed = credential(await register(username.value.trim(), password.value, browserDeviceId()))
    authenticationAccepted = true
    accountView?.setPreparing?.()
    if (copy) {
      setBusy(true, '新账户已注册，正在复制本机学习记录…')
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
    let warning = '退出账号后，已有学习记录仍会保留。'
    warning += '\n未同步的记录仍只保存在这台设备上。'
    if (!auth || auth.expiresAt * 1000 <= Date.now()) {
      warning += '\n登录已过期，仍可退出。'
    }
    if (!window.confirm(warning + '\n确定仍要安全退出？')) {
      setBusy(false, '用户已取消退出')
      return
    }
    await switchAuthenticatedWorkspace({ kind: 'anonymous' }, null, phase)
    setBusy(true, '已退出登录。')
    navigate('已退出登录，学习记录已保留。')
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
  const back = button('取消并返回学习', () => {
    finishPassiveAccountVisit(passiveVisit, entryRegistry)
    passiveVisit = null
    navigate()
  })
  controls.push(back)
  // Pre-login presentation must not start any cloud request.
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
  const selfDeleteView = mountSelfDeleteControls({
    main,
    status,
    controls,
    active,
    generation: entryRegistry.generation,
    cloudDisabled:
      options.cloudDisabled === true || REACT_APP_DEPLOY_ENV === 'pages' || import.meta.env.VITE_QWERTY_SYNC_DISABLED === 'true',
    run: safeRun,
    setBusy,
    navigate,
    invalidatePassiveReturn: () => {
      passiveVisit = null
    },
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
