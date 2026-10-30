/** Explicit recovery for the old admin credential deletion bug. Never reseals
 * unknown state automatically: live admin ownership, consent and a durable,
 * independently verified full-V4 rollback copy are required first. */
import { replaceAuthAfterWorkspaceCommit } from '../sync/auth'
import { presentSafetyDialog } from '../sync/dialog-presentation'
import { m4MergeJournalPort } from '../sync/m4-merge-journal'
import { manualV4ImportJournalPort } from '../sync/manual-v4-import-journal'
import { syncV2PullJournalPort } from '../sync/v2-pull-journal'
import type { GuardedWorkspaceBoot } from '../sync/workspace-bootstrap'
import { acquireWorkspaceWriterLease } from '../sync/workspace-lock'
import { assertWorkspaceMigrationWitness, currentWorkspaceStorageWitness } from '../sync/workspace-storage-witness'
import { S1_MIGRATION_WITNESS_KEY } from '../sync/workspace-v4'
import { workspaceRegistryPort } from '../sync/workspace-vault'
import { administrationRequest } from './client'
import { ordinaryLoginPath, readAdministratorReturn } from './ordinary-return'

export async function offerAdministratorReturnRecovery(root: HTMLElement | null): Promise<boolean> {
  const auth = readAdministratorReturn()
  if (!auth || !root || !localStorage.getItem(S1_MIGRATION_WITNESS_KEY)?.startsWith('v2:')) return false
  try {
    assertWorkspaceMigrationWitness()
    return false
  } catch {
    /* Inspect only this narrow repair case below. */
  }
  const lease = await acquireWorkspaceWriterLease({ waitMs: 3000 })
  let displayed = false
  try {
    const registry = await workspaceRegistryPort.read()
    if (
      registry.generation < 1 ||
      registry.pending ||
      registry.active.kind !== 'account' ||
      registry.active.accountId !== auth.user.userId ||
      sessionStorage.getItem('qwerty.s1.foreign-storage-clear-blocked') === '1' ||
      localStorage.getItem('qwerty.s1.auth-transition.v1')
    )
      return false
    const [manual, pull, merge] = await Promise.all([
      manualV4ImportJournalPort.read(),
      syncV2PullJournalPort.read(),
      m4MergeJournalPort.read(),
    ])
    if (pull || merge || (manual && manual.purpose !== 'administrator-return')) return false
    const verify = async () => {
      const [access, principal] = await Promise.all([
        administrationRequest<{ administrator: boolean }>('/api/admin/access', { token: auth.token, anonymous: true }),
        administrationRequest<{ user: { userId: string; username: string } }>('/api/auth/me', { token: auth.token, anonymous: true }),
      ])
      if (access.administrator !== true || principal.user?.userId !== auth.user.userId || !/^admin$/i.test(principal.user?.username || ''))
        throw Error('请重新使用 admin 登录，再返回普通账号登录。')
      const current = await workspaceRegistryPort.read()
      if (
        current.generation !== registry.generation ||
        current.pending ||
        current.active.kind !== 'account' ||
        current.active.accountId !== auth.user.userId
      )
        throw Error('本机数据归属已变化，请重新检查。')
    }
    await verify()
    if (manual?.purpose === 'administrator-return') {
      // A prior explicit consent already durably backed up the same owner.
      // Auth restoration permits ordinary journal replay; no witness is reset here.
      const current = localStorage.getItem('qwerty.cloudAuth.v1')
      if (current !== null && JSON.parse(current)?.user?.userId !== auth.user.userId) throw Error('账号已改变，不能继续恢复。')
      replaceAuthAfterWorkspaceCommit(auth)
      return false
    }
    if (localStorage.getItem('qwerty.cloudAuth.v1') !== null) return false
    const witness = localStorage.getItem(S1_MIGRATION_WITNESS_KEY)
    const panel = document.createElement('section')
    const title = document.createElement('h1')
    title.textContent = '恢复普通账号登录'
    const text = document.createElement('p')
    text.textContent =
      '旧版管理员退出流程中断了本机凭据。可先完整备份当前本机记录，再通过已有安全恢复流程返回普通账号。不会清空学习记录、覆盖其他账号或上传数据。'
    const label = document.createElement('label'),
      consent = document.createElement('input')
    consent.type = 'checkbox'
    label.style.cssText = 'display:block;min-height:44px;padding:8px 0;margin:8px 0;cursor:pointer'
    consent.style.cssText = 'margin-right:8px;vertical-align:middle'
    label.append(consent, document.createTextNode('我确认先保留完整本机副本，再恢复普通账号登录'))
    const button = document.createElement('button')
    button.textContent = '保留数据并恢复普通登录'
    button.disabled = true
    button.style.cssText =
      'min-height:44px;padding:10px 14px;border:1px solid #3d587f;border-radius:10px;background:#3d587f;color:white;opacity:.55'
    consent.onchange = () => {
      button.disabled = !consent.checked
      button.style.opacity = consent.checked ? '1' : '.55'
    }
    const status = document.createElement('p')
    status.setAttribute('role', 'status')
    const back = document.createElement('a')
    back.href = ordinaryLoginPath().includes('/mobile') ? '/mobile/admin' : '/admin'
    back.textContent = '返回管理登录'
    back.style.cssText = 'display:inline-flex;align-items:center;min-height:44px;text-decoration:underline'
    const retry = document.createElement('button')
    retry.style.cssText = 'min-height:44px;padding:8px 12px;border:1px solid #64748b;border-radius:8px'
    retry.textContent = '重新检查恢复状态'
    retry.hidden = true
    retry.onclick = () => window.location.reload()
    panel.append(title, text, label, button, status, retry, back)
    presentSafetyDialog(root, panel)
    let writing = false,
      leaving = false
    window.addEventListener(
      'pagehide',
      () => {
        leaving = true
        if (!writing) lease.release()
      },
      { once: true },
    )
    button.onclick = () => {
      writing = true
      button.disabled = true
      consent.disabled = true
      status.textContent = '正在校验并保存完整本机副本…'
      void (async () => {
        await verify()
        if (localStorage.getItem('qwerty.cloudAuth.v1') !== null || localStorage.getItem(S1_MIGRATION_WITNESS_KEY) !== witness)
          throw Error('本机状态已变化，请重新检查。')
        const before = currentWorkspaceStorageWitness()
        const { captureWorkingWorkspaceV4 } = await import('../sync/workspace-v4-browser')
        const snapshot = await captureWorkingWorkspaceV4(registry.active)
        if (currentWorkspaceStorageWitness() !== before) throw Error('备份期间本机状态改变，请重新检查。')
        await manualV4ImportJournalPort.stage({
          owner: registry.active,
          originalOwner: registry.active,
          registryGeneration: registry.generation,
          original: snapshot,
          candidate: snapshot,
          purpose: 'administrator-return',
        })
        const durable = await manualV4ImportJournalPort.read()
        if (!durable || durable.purpose !== 'administrator-return') throw Error('完整备份尚未确认，未恢复凭据。')
        if (currentWorkspaceStorageWitness() !== before) throw Error('备份期间本机状态改变，已保留副本，请重新检查。')
        replaceAuthAfterWorkspaceCommit(auth)
        window.location.reload()
      })()
        .catch(() => {
          status.textContent = '恢复尚未完成，原数据和已保存的副本仍保留。请重新检查，或返回管理员登录后重试。'
          retry.hidden = false
        })
        .finally(() => {
          writing = false
          if (leaving) lease.release()
        })
    }
    displayed = true
    return true
  } finally {
    if (!displayed) lease.release()
  }
}

export async function finishAdministratorReturn(boot: GuardedWorkspaceBoot): Promise<boolean> {
  const { loadAuth } = await import('../sync/auth')
  const { administratorHint, forgetAdministratorSession } = await import('./session')
  const { forgetAdministratorReturn, ordinaryLoginDestination } = await import('./ordinary-return')
  const local = loadAuth({ preserveExpired: true }),
    ticket = readAdministratorReturn()
  const legacy = administratorHint(local)
  if (legacy && local) {
    if (
      boot.mode !== 'isolated' ||
      boot.registry.active.kind !== 'account' ||
      boot.registry.active.accountId !== local.user.userId ||
      (ticket && ticket.user.userId !== local.user.userId)
    )
      throw Error('旧管理账号的本机归属尚未确认，原记录已保留。')
    const { switchAuthenticatedWorkspace } = await import('../sync/workspace-auth-transaction')
    await switchAuthenticatedWorkspace({ kind: 'anonymous' }, null)
  }
  forgetAdministratorReturn()
  forgetAdministratorSession()
  const token = ticket?.token
  if (token) {
    try {
      await administrationRequest('/api/admin/logout', { token, anonymous: true, body: {} })
    } catch {
      /* Local return remains available offline. */
    }
  }
  if (legacy) {
    window.location.replace(ordinaryLoginDestination())
    return true
  }
  window.history.replaceState(null, '', ordinaryLoginDestination())
  return false
}
