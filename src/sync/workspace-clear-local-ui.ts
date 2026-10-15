/** Dedicated writer-locked, pre-mount local learning reset UI. */
import type { GuardedWorkspaceBoot } from './workspace-bootstrap'
import { loadAuth } from './auth'
import { workspaceRegistryPort } from './workspace-vault'
import { assertWorkspaceMigrationWitness } from './workspace-storage-witness'
import { same } from './workspace-transition'
import { captureWorkingWorkspaceV4 } from './workspace-v4-browser'
import { stageClearLocalLearningData } from './workspace-clear-local'

function element<K extends keyof HTMLElementTagNameMap>(
  name: K, text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(name)
  node.textContent = text
  return node
}

/**
 * The ordinary React app must never clear its own active DB. This page runs
 * after the guarded pre-mount boot, under the same exclusive S1 writer lease.
 */
export async function renderClearLocalLearningUI(
  root: HTMLElement | null,
  boot: GuardedWorkspaceBoot,
): Promise<void> {
  if (!root || boot.mode !== 'isolated' || boot.registry.pending) {
    throw new Error('本地学习记录清除需要 S1 安全工作区')
  }
  const owner = boot.registry.active
  const verifyOwner = async () => {
    const registry = await workspaceRegistryPort.read()
    const auth = loadAuth({ preserveExpired: true })
    if (registry.pending || registry.generation !== boot.registry.generation ||
        !same(registry.active, owner) ||
        (owner.kind === 'anonymous' ? auth !== null : auth?.user.userId !== owner.accountId)) {
      throw new Error('当前工作区或账号已改变，清除已安全停止')
    }
    assertWorkspaceMigrationWitness()
  }
  await verifyOwner()
  const panel = element('section')
  panel.style.cssText = 'max-width:580px;margin:8vh auto;padding:24px;font:15px/1.7 system-ui;color:#334155'
  const title = element('h1', '清除当前工作区的本地学习数据')
  title.style.cssText = 'font-size:22px;font-weight:600;margin-bottom:12px'
  const summary = element('p', owner.kind === 'anonymous'
    ? '目标：本机匿名工作区（LOCAL-ANONYMOUS）。'
    : '目标：当前登录账号的本机工作区（ID：' + owner.accountId + '）。')
  const warning = element('p',
    '将清除本工作区的单词、章节、智能复习、成就记录及每日学习会话，并恢复默认词库。个人设置、其他账号的本地工作区及云端数据不会立即删除。')
  const caution = element('p',
    '此操作不可撤销；云端记录不会立即改变，但之后主动同步时可能将清空状态同步到云端。建议先下载完整 V4 备份。')
  caution.style.cssText = 'color:#a16207;margin-top:12px'
  const actions = element('div')
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin:20px 0'
  const button = (text: string) => {
    const control = element('button', text)
    control.type = 'button'
    control.style.cssText = 'border:1px solid #94a3b8;border-radius:8px;padding:10px 16px;background:white;cursor:pointer'
    return control
  }
  const backup = button('导出当前完整 V4 备份')
  const cancel = button('取消，返回学习')
  const erase = button('确认清除本地学习数据')
  erase.style.cssText += ';border-color:#ef4444;color:#b91c1c'
  erase.disabled = true
  const label = element('label')
  label.style.cssText = 'display:flex;gap:9px;align-items:flex-start;margin-top:16px'
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.setAttribute('aria-label', '我确认仅清除当前工作区的本地学习记录')
  label.append(checkbox, document.createTextNode(' 我明白仅当前工作区的本地学习记录将被清除，操作不能撤销。'))
  checkbox.addEventListener('change', () => { erase.disabled = !checkbox.checked })
  const status = element('p', '请选择操作。')
  status.setAttribute('role', 'status')
  status.style.cssText = 'white-space:pre-wrap;margin-top:12px'
  actions.append(backup, cancel, erase)
  panel.append(title, summary, warning, caution, label, actions, status)
  root.replaceChildren(panel)
  let busy = false
  const lockControls = () => {
    busy = true
    backup.disabled = true
    cancel.disabled = true
    erase.disabled = true
    checkbox.disabled = true
  }
  cancel.addEventListener('click', () => {
    if (!busy) window.location.replace('/')
  })
  backup.addEventListener('click', () => {
    if (busy) return
    void (async () => {
      await verifyOwner()
      status.textContent = '正在生成并校验本地完整 V4 备份…'
      const snapshot = await captureWorkingWorkspaceV4(owner)
      await verifyOwner()
      const pako = await import('pako')
      const { saveAs } = await import('file-saver')
      const bytes = pako.gzip(JSON.stringify(snapshot))
      saveAs(new Blob([bytes], { type: 'application/gzip' }),
        'Qwerty-Plus-BEFORE-CLEAR-V4-' + Date.now() + '.gz')
      status.textContent = '已触发完整 V4 备份下载，请检查文件确实保存成功。'
    })().catch(error => {
      status.textContent = '备份失败，未删除数据：' +
        (error instanceof Error ? error.message : String(error))
    })
  })
  erase.addEventListener('click', () => {
    if (busy || !checkbox.checked) return
    if (!window.confirm('最后确认：永久清除当前工作区的全部本地学习记录？已保存的云端账号、其他工作区和个人设置不会立即改变。')) return
    lockControls()
    status.textContent = '正在校验原始数据并提交安全清除日志…'
    void (async () => {
      await verifyOwner()
      await stageClearLocalLearningData(boot)
      status.textContent = '清除事务已安全提交。正在重新启动并核验…'
      window.location.replace('/')
    })().catch(error => {
      status.textContent = '清除被安全停止：' +
        (error instanceof Error ? error.message : String(error)) +
        '。原始记录仍保留；如事务已提交，下次启动将自动恢复。'
      // The stage may have succeeded despite an uncertain acknowledgement.
      // Never allow another destructive attempt in this JS realm.
    })
  })
}
