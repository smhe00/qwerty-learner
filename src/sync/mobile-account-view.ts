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
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag)
  node.textContent = text
  node.className = className
  return node
}

/** Presentation only. Authentication and workspace transitions stay in S1. */
export function presentMobileAccount(view: AccountView) {
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
  } = view
  const anonymous = active.kind === 'anonymous'
  const expired = !!auth && auth.expiresAt * 1000 <= Date.now()
  const [authenticate, secondary, back] = controls
  const authButtons = anonymous ? [authenticate, secondary] : [authenticate]
  const fields = [username, password, ...(passwordConfirm ? [passwordConfirm] : [])]
  let mode: 'login' | 'register' = 'login'
  let busy = false
  let credentialsVisible = anonymous || expired
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
  overlay.dataset.mobileAccount = ''
  overlay.dataset.theme = dark ? 'dark' : 'light'
  overlay.setAttribute('role', 'main')
  main.className = 'mobile-account-card'
  main.setAttribute('role', 'region')
  main.removeAttribute('aria-modal')
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
  overlay.prepend(top)
  const eyebrow = el('p', anonymous ? 'YOUR LEARNING SPACE' : 'MY ACCOUNT', 'mobile-account-eyebrow')
  heading.textContent = anonymous ? '登录 QWERTY Plus' : '我的账号'
  heading.tabIndex = -1
  current.textContent = anonymous ? '把每天的积累，留在自己的学习空间。' : auth?.user.username || '当前账号'
  current.className = 'mobile-account-description'
  authState.textContent = anonymous ? '' : expired ? '登录已过期 · 本机学习记录仍保留' : '已登录 · 正在使用独立的账号学习空间'
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
  form.append(inputs, actions)
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
    const registration = mode === 'register'
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
  back.className = 'mobile-account-secondary'
  back.textContent = anonymous ? '暂不登录，继续本机学习' : '返回学习'
  main.append(guidance, back)
  const foot = el('p', '练打字 · 记单词 · 云同步', 'mobile-account-footer')
  overlay.append(foot)
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
  heading.focus()
  return { setBusy }
}
