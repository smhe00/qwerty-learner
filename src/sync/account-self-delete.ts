/** Self-service deletion runs only in the writer-locked, pre-mount account document. */
import { SyncApiError, deleteCloudAccount, getAdministratorAccess } from './api'
import { loadAuth } from './auth'
import { switchAuthenticatedWorkspace } from './workspace-auth-transaction'
import { assertWorkspaceMigrationWitness } from './workspace-storage-witness'
import { same } from './workspace-transition'
import type { Workspace } from './workspace-transition'
import { workspaceFingerprintV4 } from './workspace-v4'
import { captureWorkingWorkspaceV4 } from './workspace-v4-browser'
import { loadWorkspaceFromVault, saveWorkspaceToVault, workspaceRegistryPort } from './workspace-vault'

export const SELF_DELETE_PREFIX = 'qwerty.account-self-delete.v1.'
type DeletionState = 'requested' | 'confirmed'
const uncertain = '上次删除结果尚未确认，已停止重复提交。请保留本机备份，核实账号状态后再处理；不要反复尝试删除。'

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag)
  node.textContent = text
  node.className = className
  return node
}

export function mountSelfDeleteControls(options: {
  main: HTMLElement
  status: HTMLElement
  controls: HTMLButtonElement[]
  active: Workspace
  generation: number
  cloudDisabled: boolean
  run: (action: () => Promise<void>) => void
  setBusy: (busy: boolean, message: string) => void
  invalidatePassiveReturn: () => void
  navigate: (message: string) => void
}) {
  const { main, status, controls, active, generation, run, setBusy, navigate } = options
  const auth = loadAuth({ preserveExpired: true })
  let busy = false
  let password: HTMLInputElement | undefined
  let acknowledgement: HTMLInputElement | undefined
  let submit: HTMLButtonElement | undefined
  let state: DeletionState | null = null
  let permitted = false
  const update = () => {
    if (password) password.disabled = busy || state !== null
    if (acknowledgement) acknowledgement.disabled = busy || state !== null
    if (submit) submit.disabled = busy || !permitted || state !== null || !acknowledgement?.checked
  }
  const view = {
    setBusy(next: boolean) {
      busy = next
      update()
    },
  }
  if (active.kind !== 'account' || !auth || auth.user.userId !== active.accountId || options.cloudDisabled) return view
  const owner = active
  const key = SELF_DELETE_PREFIX + encodeURIComponent(owner.accountId)
  const read = (): DeletionState | null => {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    const value = JSON.parse(raw)
    if (value?.version !== 1 || value.accountId !== owner.accountId || !['requested', 'confirmed'].includes(value.state))
      throw new Error('删除操作记录异常，已禁止再次提交。请保留本机备份。')
    return value.state
  }
  const write = (next: DeletionState) => {
    const json = JSON.stringify({ version: 1, accountId: owner.accountId, state: next })
    localStorage.setItem(key, json)
    if (localStorage.getItem(key) !== json) throw new Error('无法保存删除操作状态，已停止操作。')
    state = next
    update()
  }
  const verify = async (validSession = true) => {
    const current = loadAuth({ preserveExpired: true })
    const registry = await workspaceRegistryPort.read()
    if (
      !current ||
      current.user.userId !== owner.accountId ||
      current.token !== auth.token ||
      (validSession && current.expiresAt * 1000 <= Date.now()) ||
      registry.pending ||
      generation < 1 ||
      registry.generation !== generation ||
      !same(registry.active, owner)
    )
      throw new Error('账号或本机学习空间状态已改变，请重新进入账号管理。')
    assertWorkspaceMigrationWitness()
  }
  const backup = async (download: boolean) => {
    await verify(false)
    const snapshot = await captureWorkingWorkspaceV4(owner)
    await verify(false)
    await saveWorkspaceToVault(owner, snapshot)
    const saved = await loadWorkspaceFromVault(owner)
    if (!saved || (await workspaceFingerprintV4(saved)) !== (await workspaceFingerprintV4(snapshot)))
      throw new Error('本机备份未能通过校验，未提交删除。')
    if (download) {
      const { gzip } = await import('pako')
      const { saveAs } = await import('file-saver')
      saveAs(
        new Blob([gzip(JSON.stringify(snapshot))], { type: 'application/gzip' }),
        'Qwerty-Plus-BEFORE-ACCOUNT-DELETE-V4-' + Date.now() + '.gz',
      )
    }
  }
  const finish = async () => {
    if (read() !== 'confirmed') throw new Error(uncertain)
    await verify(false)
    options.invalidatePassiveReturn()
    try {
      await switchAuthenticatedWorkspace({ kind: 'anonymous' }, null)
    } catch {
      throw new Error('云端账号已删除，本机退出尚未完成。请重新打开账号管理完成退出；不要重复删除。')
    }
    // Retain the token-free receipt. A late page can never replay this deletion.
    navigate('云端账号已删除。原账号本机记录已保留，当前回到未登录的学习空间。')
  }
  const panel = element('section', '', 'mobile-account-self-delete')
  panel.hidden = true
  panel.setAttribute('data-self-delete', '')
  const addButton = (text: string, action: () => Promise<void>) => {
    const button = element('button', text, 'mobile-account-secondary')
    button.type = 'button'
    button.disabled = busy
    button.addEventListener('click', () => run(action))
    controls.push(button)
    return button
  }
  const backupButton = () =>
    addButton('下载本机学习备份', async () => {
      await backup(true)
      setBusy(false, '备份下载已发起，请确认文件已保存。删除后可从备份恢复学习记录。')
    })
  const showRecovery = () => {
    panel.hidden = false
    panel.replaceChildren(
      element('p', state === 'confirmed' ? '云端账号已删除，请完成本机安全退出。' : uncertain, 'mobile-account-description'),
      backupButton(),
    )
    if (state === 'confirmed') panel.append(addButton('完成本机安全退出', finish))
  }
  main.insertBefore(panel, main.querySelector('.mobile-account-footer'))
  void (async () => {
    await verify(false)
    state = read()
    if (state) {
      showRecovery()
      return
    }
    if (auth.expiresAt * 1000 <= Date.now()) return
    const access = await getAdministratorAccess(auth.token)
    await verify()
    // Missing/malformed/failed results must never expose a destructive entry.
    if (access.administrator !== false) return
    permitted = true
    const toggle = element('button', '删除我的云端账号', 'mobile-account-secondary')
    toggle.type = 'button'
    toggle.setAttribute('aria-expanded', 'false')
    toggle.setAttribute('aria-controls', 'account-self-delete-form')
    toggle.disabled = busy
    controls.push(toggle)
    const form = element('form', '', 'mobile-account-change-password')
    form.id = 'account-self-delete-form'
    form.hidden = true
    form.setAttribute('aria-label', '删除我的云端账号')
    form.append(
      element(
        'p',
        '永久删除当前账号及其云端数据，无法撤销。不会删除本机记录；退出后原记录仍在该账号的本机学习空间中，不会自动转入未登录空间。请先下载备份，以便今后恢复。',
        'mobile-account-description',
      ),
      backupButton(),
    )
    const label = element('label', '当前账号密码', 'mobile-account-field')
    password = element('input')
    password.type = 'password'
    password.autocomplete = 'current-password'
    password.required = true
    password.minLength = 4
    password.maxLength = 128
    label.append(password)
    const consent = element('label', '', 'mobile-account-delete-consent')
    acknowledgement = element('input')
    acknowledgement.type = 'checkbox'
    acknowledgement.addEventListener('change', update)
    consent.append(acknowledgement, document.createTextNode('我已保存需要的备份，理解删除云端账号不可撤销。'))
    submit = element('button', '永久删除云端账号', 'mobile-account-logout')
    submit.type = 'submit'
    controls.push(submit)
    form.append(label, consent, submit)
    toggle.addEventListener('click', () => {
      if (busy) return
      form.hidden = !form.hidden
      toggle.setAttribute('aria-expanded', String(!form.hidden))
      if (form.hidden) {
        form.reset()
        update()
      }
    })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      if (busy || !permitted || state || !acknowledgement?.checked || !form.reportValidity()) return
      if (!window.confirm('永久删除云端账号“' + auth.user.username + '”及其云端数据？此操作无法撤销，本机记录保留。')) return
      if (!password) return
      const currentPassword = password.value
      password.value = ''
      run(async () => {
        await verify()
        if (read()) throw new Error(uncertain)
        // Recheck independently of the earlier presentation result; the server
        // also rejects protected administrators before performing any deletion.
        const freshAccess = await getAdministratorAccess(auth.token)
        await verify()
        if (freshAccess.administrator !== false) {
          permitted = false
          panel.hidden = true
          throw new Error('无法确认普通账号权限，未提交删除。')
        }
        await backup(false)
        await verify()
        options.invalidatePassiveReturn()
        write('requested')
        let result
        try {
          result = await deleteCloudAccount(auth.token, currentPassword)
        } catch (error) {
          // Only explicit pre-deletion rejections permit correcting the input.
          if (
            error instanceof SyncApiError &&
            [400, 401, 403].includes(error.status) &&
            [
              'invalid_credentials',
              'invalid_password',
              'administrator_protected',
              'session_revoked',
              'session_expired',
              'invalid_token',
            ].includes(error.code)
          ) {
            localStorage.removeItem(key)
            state = null
            if (error.code === 'administrator_protected') {
              permitted = false
              panel.hidden = true
            }
            update()
            if (error.code === 'invalid_credentials') throw new Error('当前密码不正确，未删除账号。')
            throw error
          }
          showRecovery()
          throw new Error(uncertain)
        }
        if (result?.ok !== true || result.deleted?.accountDeleted !== true) {
          showRecovery()
          throw new Error(uncertain)
        }
        write('confirmed')
        showRecovery()
        await finish()
      })
    })
    panel.replaceChildren(toggle, form)
    panel.hidden = false
    update()
  })().catch(() => {
    // A permission/ownership/read failure hides the entry; other account
    // actions remain available. No automatic retry or deletion is attempted.
    if (state) status.textContent = uncertain
  })
  return view
}
