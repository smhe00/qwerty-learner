import './mobile-account.css'
import type { CloudAuthState } from './types'
import type { Workspace } from './workspace-transition'
import logo from '@/assets/logo.svg'

type AccountView = {
  overlay: HTMLDivElement
  main: HTMLElement
  heading: HTMLHeadingElement
  current: HTMLParagraphElement
  authState: HTMLParagraphElement
  guidance: HTMLParagraphElement
  status: HTMLParagraphElement
  actions: HTMLDivElement
  username: HTMLInputElement
  password: HTMLInputElement
  passwordConfirm?: HTMLInputElement
  controls: HTMLButtonElement[]
  active: Workspace
  auth: CloudAuthState | null
  cloudDisabled: boolean
  mobile?: boolean
  reauthenticate?: boolean
  onChangePassword?: (currentPassword: string, newPassword: string) => void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag)
  node.textContent = text
  node.className = className
  return node
}

/** Presentation only. Authentication and workspace transitions stay in S1. */
export function presentAccount(view: AccountView) {
  const {
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
    auth,
    cloudDisabled,
    mobile = true,
    reauthenticate = false,
    onChangePassword,
  } = view
  const anonymous = active.kind === 'anonymous'
  const expired = !!auth && auth.expiresAt * 1000 <= Date.now()
  const [authenticate, secondary, back] = controls
  const authButtons = anonymous ? [authenticate, secondary] : [authenticate]
  const fields = [username, password, ...(passwordConfirm ? [passwordConfirm] : [])]
  let mode: 'login' | 'register' = 'login'
  let busy = false
  let credentialsVisible = anonymous || expired || reauthenticate
  let dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  try {
    const saved = JSON.parse(localStorage.getItem('isOpenDarkModeAtom') || 'null')
    if (typeof saved === 'boolean') dark = saved
  } catch {
    /* use system theme */
  }
  for (const node of [overlay, main, heading, current, authState, guidance, status, actions, ...fields, ...controls])
    node.style.cssText = ''
  document.body.classList.add('mobile-account-document')
  overlay.className = 'mobile-account-page'
  overlay.dataset.account = ''
  overlay.dataset.accountLayout = mobile ? 'mobile' : 'desktop'
  if (mobile) overlay.dataset.mobileAccount = ''
  else overlay.dataset.desktopAccount = ''
  overlay.dataset.theme = dark ? 'dark' : 'light'
  overlay.setAttribute('role', 'presentation')
  main.className = 'mobile-account-card'
  main.setAttribute('role', 'dialog')
  main.setAttribute('aria-modal', 'true')
  main.setAttribute('aria-labelledby', heading.id)
  const top = el('header', '', 'mobile-account-top')
  const mark = el('div', '', 'mobile-account-brand')
  const image = el('img')
  image.src = logo
  image.alt = ''
  image.width = 32
  image.height = 32
  mark.append(image, el('span', 'QWERTY Plus'))
  const goBack = el('button', '返回', 'mobile-account-back')
  goBack.type = 'button'
  goBack.addEventListener('click', () => back.click())
  controls.push(goBack)
  top.append(goBack, mark)
  main.prepend(top)
  const eyebrow = el('p', anonymous ? 'YOUR LEARNING SPACE' : 'MY ACCOUNT', 'mobile-account-eyebrow')
  heading.textContent = anonymous ? '登录 QWERTY Plus' : '我的账号'
  heading.tabIndex = -1
  current.textContent = anonymous ? '把每天的积累，留在自己的学习空间。' : auth?.user.username || '当前账号'
  current.className = 'mobile-account-description'
  authState.textContent = anonymous
    ? ''
    : reauthenticate
    ? '请验证密码，重新连接当前账号'
    : expired
    ? '登录已过期 · 本机学习记录仍保留'
    : '已登录 · 正在使用独立的账号学习空间'
  authState.className = 'mobile-account-state'
  authState.hidden = anonymous
  guidance.textContent = anonymous
    ? '本机匿名学习记录会单独保留，登录已有账号不会自动合并这些记录。'
    : '退出后，本机学习记录仍保存在这个账号的学习空间中。'
  guidance.className = 'mobile-account-guidance'
  status.className = 'mobile-account-status'
  status.setAttribute('aria-live', 'polite')
  status.textContent = ''
  main.prepend(eyebrow)
  const form = el('form', '', 'mobile-account-form')
  const tabs = el('div', '', 'mobile-account-tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', '账号操作')
  const loginTab = el('button', '登录')
  const registerTab = el('button', '注册')
  for (const tab of [loginTab, registerTab]) {
    tab.type = 'button'
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', 'mobile-account-fields')
    controls.push(tab)
  }
  loginTab.id = 'mobile-account-login-tab'
  registerTab.id = 'mobile-account-register-tab'
  tabs.append(loginTab, registerTab)
  const inputs = el('div')
  inputs.id = 'mobile-account-fields'
  inputs.setAttribute('role', anonymous ? 'tabpanel' : 'group')
  if (!anonymous) inputs.setAttribute('aria-label', '重新登录')
  const labelField = (input: HTMLInputElement, title: string, id: string) => {
    input.id = id
    input.required = true
    const wrapper = el('div', '', 'mobile-account-field')
    const label = el('label', title)
    label.htmlFor = id
    wrapper.append(label, input)
    inputs.append(wrapper)
    return wrapper
  }
  labelField(username, '用户名', 'mobile-account-username')
  username.placeholder = '输入用户名'
  username.minLength = 3
  username.maxLength = 32
  username.autocapitalize = 'none'
  username.spellcheck = false
  username.setAttribute('autocorrect', 'off')
  username.value = anonymous ? '' : auth?.user.username || ''
  const passwordField = labelField(password, '密码', 'mobile-account-password')
  password.placeholder = '输入密码（4–128 位）'
  password.minLength = 4
  password.maxLength = 128
  const passwordRow = el('div', '', 'mobile-account-password-row')
  const visibility = el('button', '显示', 'mobile-account-visibility')
  visibility.type = 'button'
  visibility.setAttribute('aria-label', '显示密码')
  visibility.setAttribute('aria-pressed', 'false')
  visibility.addEventListener('click', () => {
    const show = password.type === 'password'
    password.type = show ? 'text' : 'password'
    visibility.textContent = show ? '隐藏' : '显示'
    visibility.setAttribute('aria-label', show ? '隐藏密码' : '显示密码')
    visibility.setAttribute('aria-pressed', String(show))
  })
  passwordRow.append(password, visibility)
  passwordField.append(passwordRow)
  controls.push(visibility)
  const confirmField = passwordConfirm ? labelField(passwordConfirm, '确认密码', 'mobile-account-confirm') : null
  if (passwordConfirm) {
    passwordConfirm.minLength = 4
    passwordConfirm.maxLength = 128
    passwordConfirm.placeholder = '再次输入密码'
  }
  const registrationNotice = el('aside', '', 'mobile-account-registration-notice')
  registrationNotice.id = 'account-registration-notice'
  registrationNotice.setAttribute('aria-label', '注册须知')
  registrationNotice.append(
    el('strong', '注册须知'),
    el('p', '暂不支持账号找回或密码重置，请妥善保存用户名和密码。登录后可在“我的账号”中修改密码。'),
    el('p', '连续超过 6 个月未使用的账号将自动删除。'),
  )
  form.append(inputs, registrationNotice, actions)
  for (const button of authButtons) {
    button.className = 'mobile-account-primary'
    button.addEventListener(
      'click',
      (event) => {
        if (!form.reportValidity()) {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
      },
      true,
    )
  }
  form.addEventListener('submit', (event) => event.preventDefault())
  const updateMode = () => {
    const registration = anonymous && mode === 'register'
    registrationNotice.hidden = !registration
    if (registration) form.setAttribute('aria-describedby', registrationNotice.id)
    else form.removeAttribute('aria-describedby')
    loginTab.setAttribute('aria-selected', String(!registration))
    registerTab.setAttribute('aria-selected', String(registration))
    loginTab.tabIndex = registration ? -1 : 0
    registerTab.tabIndex = registration ? 0 : -1
    if (anonymous) inputs.setAttribute('aria-labelledby', registration ? registerTab.id : loginTab.id)
    if (confirmField) confirmField.hidden = !registration
    if (passwordConfirm) {
      passwordConfirm.disabled = !registration || busy || cloudDisabled
      passwordConfirm.required = registration
    }
    password.autocomplete = registration ? 'new-password' : 'current-password'
    authenticate.hidden = anonymous ? registration : !credentialsVisible
    authenticate.type = anonymous && registration ? 'button' : 'submit'
    authenticate.textContent = anonymous ? '登录' : '确认重新登录'
    if (anonymous) {
      secondary.hidden = !registration
      secondary.type = registration ? 'submit' : 'button'
      secondary.textContent = '注册并登录'
    }
    form.hidden = !credentialsVisible
  }
  const chooseMode = (next: 'login' | 'register') => {
    if (busy) return
    mode = next
    status.textContent = ''
    passwordConfirm?.setCustomValidity('')
    updateMode()
  }
  loginTab.addEventListener('click', () => chooseMode('login'))
  registerTab.addEventListener('click', () => chooseMode('register'))
  tabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (busy) return
    chooseMode(event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : mode === 'login' ? 'register' : 'login')
    ;(mode === 'login' ? loginTab : registerTab).focus()
  })
  const validateConfirmation = () =>
    passwordConfirm?.setCustomValidity(mode === 'register' && passwordConfirm.value !== password.value ? '两次输入的密码不一致' : '')
  password.addEventListener('input', validateConfirmation)
  passwordConfirm?.addEventListener('input', validateConfirmation)
  if (anonymous) main.insertBefore(tabs, status)
  main.insertBefore(form, status)
  // Move the original action buttons into their form without changing their S1 listeners.
  if (!anonymous) {
    const reauthToggle = el('button', expired ? '重新登录' : '重新验证登录', 'mobile-account-secondary')
    reauthToggle.type = 'button'
    reauthToggle.setAttribute('aria-expanded', String(credentialsVisible))
    reauthToggle.addEventListener('click', () => {
      credentialsVisible = !credentialsVisible
      reauthToggle.setAttribute('aria-expanded', String(credentialsVisible))
      updateMode()
    })
    secondary.className = 'mobile-account-logout'
    secondary.textContent = '安全退出登录'
    main.insertBefore(reauthToggle, form)
    main.insertBefore(secondary, form)
    controls.push(reauthToggle)
  }
  if (!anonymous && onChangePassword) {
    const passwordToggle = el('button', '修改密码', 'mobile-account-secondary')
    passwordToggle.type = 'button'
    passwordToggle.setAttribute('aria-expanded', 'false')
    passwordToggle.setAttribute('aria-controls', 'account-change-password')
    const passwordForm = el('form', '', 'mobile-account-change-password')
    passwordForm.id = 'account-change-password'
    passwordForm.setAttribute('aria-label', '修改密码')
    passwordForm.hidden = true
    passwordForm.append(el('p', '修改密码需要验证当前密码；修改后其他设备需要重新登录。', 'mobile-account-description'))
    const passwordInput = (title: string, id: string, autocomplete: string) => {
      const wrapper = el('div', '', 'mobile-account-field')
      const label = el('label', title)
      label.htmlFor = id
      const input = el('input')
      input.id = id
      input.type = 'password'
      input.autocomplete = autocomplete
      input.required = true
      input.minLength = 4
      input.maxLength = 128
      wrapper.append(label, input)
      passwordForm.append(wrapper)
      fields.push(input)
      return input
    }
    const currentPassword = passwordInput('当前密码', 'account-current-password', 'current-password')
    const newPassword = passwordInput('新密码', 'account-new-password', 'new-password')
    const confirmPassword = passwordInput('确认新密码', 'account-confirm-new-password', 'new-password')
    const validate = () => {
      newPassword.setCustomValidity(newPassword.value === currentPassword.value ? '新密码不能与当前密码相同' : '')
      confirmPassword.setCustomValidity(confirmPassword.value !== newPassword.value ? '两次输入的新密码不一致' : '')
    }
    for (const input of [currentPassword, newPassword, confirmPassword]) input.addEventListener('input', validate)
    const submit = el('button', '确认修改密码', 'mobile-account-primary')
    submit.type = 'submit'
    passwordForm.append(submit)
    passwordForm.addEventListener('submit', (event) => {
      event.preventDefault()
      if (!busy && !cloudDisabled && !expired && passwordForm.reportValidity()) onChangePassword(currentPassword.value, newPassword.value)
    })
    passwordToggle.addEventListener('click', () => {
      passwordForm.hidden = !passwordForm.hidden
      passwordToggle.setAttribute('aria-expanded', String(!passwordForm.hidden))
      if (passwordForm.hidden) {
        passwordForm.reset()
        newPassword.setCustomValidity('')
        confirmPassword.setCustomValidity('')
      } else if (!mobile) currentPassword.focus()
    })
    if (expired) {
      passwordToggle.hidden = true
      passwordToggle.textContent = '修改密码（请先重新登录）'
    }
    controls.push(passwordToggle, submit)
    authButtons.push(submit)
    main.append(passwordToggle, passwordForm)
  }
  back.className = 'mobile-account-secondary'
  back.textContent = anonymous ? '暂不登录，继续本机学习' : '返回学习'
  main.append(guidance, back)
  const foot = el('p', '练打字 · 记单词 · 云同步', 'mobile-account-footer')
  main.append(foot)
  if (cloudDisabled) {
    const notice = el('p', '当前为开发预览，登录和注册暂不可用。你仍可继续本机学习。', 'mobile-account-preview')
    notice.setAttribute('role', 'note')
    main.insertBefore(notice, form)
  }
  updateMode()
  const setBusy = (next: boolean) => {
    busy = next
    form.setAttribute('aria-busy', String(next))
    for (const field of fields) field.disabled = next || cloudDisabled
    for (const button of authButtons) button.disabled = next || cloudDisabled
    if (passwordConfirm) passwordConfirm.disabled = next || cloudDisabled || mode !== 'register'
  }
  setBusy(false)
  if (!mobile && !form.hidden && !cloudDisabled) username.focus()
  else heading.focus()
  return { setBusy }
}

/** Read-only preview for legacy storage. Never imports auth or workspace IO. */
export function renderAccountPreview(root: HTMLElement | null, options: { mobile?: boolean } = {}): void {
  const mobile = options.mobile !== false
  if (!root) throw new Error('Missing mobile account preview root')
  const overlay = el('div')
  const main = el('section')
  const heading = el('h1')
  heading.id = 'account-dialog-title'
  main.setAttribute('aria-labelledby', heading.id)
  const current = el('p')
  const authState = el('p')
  const guidance = el('p')
  const status = el('p')
  status.setAttribute('role', 'status')
  const actions = el('div')
  const username = el('input')
  username.autocomplete = 'username'
  username.setAttribute('aria-label', '用户名')
  const password = el('input')
  password.type = 'password'
  password.setAttribute('aria-label', '账户密码')
  const passwordConfirm = el('input')
  passwordConfirm.type = 'password'
  passwordConfirm.autocomplete = 'new-password'
  passwordConfirm.setAttribute('aria-label', '注册密码确认')
  // These controls intentionally have NO authentication or transition listeners.
  // Removing a disabled attribute cannot turn a preview into a login operation.
  const login = el('button', '登录')
  const register = el('button', '注册并登录')
  const back = el('button', '返回')
  for (const button of [login, register, back]) button.type = 'button'
  back.addEventListener('click', () =>
    window.location.replace((REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner' : '') + (mobile ? '/mobile' : '/')),
  )
  actions.append(username, password, passwordConfirm, login, register, back)
  main.append(heading, current, authState, guidance, actions, status)
  overlay.append(main)
  root.replaceChildren(overlay)
  presentAccount({
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
    controls: [login, register, back],
    active: { kind: 'anonymous' },
    auth: null,
    cloudDisabled: true,
    mobile,
  })
  overlay.setAttribute('data-account-readonly-preview', '')
  if (mobile) overlay.setAttribute('data-mobile-account-readonly-preview', '')
  guidance.textContent = '此页仅供界面预览，本机原有学习记录和账号信息保持不变。'
}
