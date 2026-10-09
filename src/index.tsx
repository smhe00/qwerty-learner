/**
 * Sole real-app entry. No import of React/Jotai/RecordDB or domain modules
 * may precede the exclusive writer lease and pending-journal check.
 * Legacy users continue without automatic S1 migration.
 */
import { loadAuth } from './sync/auth'
import { prepareGuardedWorkspaceBoot } from './sync/workspace-bootstrap'
import type { Workspace } from './sync/workspace-transition'
import type { GuardedWorkspaceBoot, WorkspaceBootStage } from './sync/workspace-bootstrap'

const root = document.getElementById('root')
let boot: GuardedWorkspaceBoot | undefined
let starting = false
let releasedForPageHide = false
let mounted = false

function gateUI(title: string, detail: string, action?: string): void {
  if (!root || mounted) return
  root.replaceChildren()
  const panel = document.createElement('section')
  panel.setAttribute('role', 'status')
  panel.setAttribute('aria-live', 'polite')
  panel.style.cssText = 'max-width:560px;margin:12vh auto;padding:28px;font-family:system-ui,sans-serif;line-height:1.7;color:#334155'
  const heading = document.createElement('h1')
  heading.textContent = title
  heading.style.cssText = 'font-size:22px;font-weight:600;margin-bottom:12px'
  const body = document.createElement('p')
  body.textContent = detail
  panel.append(heading, body)
  if (action) {
    const retry = document.createElement('button')
    retry.textContent = action
    retry.type = 'button'
    retry.style.cssText = 'margin-top:20px;border:1px solid #64748b;border-radius:6px;padding:8px 16px'
    retry.addEventListener('click', () => window.location.reload())
    panel.append(retry)
  }
  root.append(panel)
}

/**
 * Explicit V1 ownership test surface, only on the local Vite dev server.
 * Production migration stays disabled until all stale old-version tab
 * lifecycles and auth transactions are verified.
 */
function showDevelopmentMigrationConsent(): void {
  if (!root || !boot || boot.mode !== 'legacy') return
  const auth = loadAuth({ preserveExpired: true })
  const owner: Workspace = auth
    ? { kind: 'account', accountId: auth.user.userId }
    : { kind: 'anonymous' }
  const ownerName = auth
    ? '账号“' + auth.user.username + '”（不可变 ID：' + auth.user.userId + '）'
    : '当前本机匿名工作区'
  gateUI('S1 V1 数据归属测试（仅限本地开发）',
    '您正在确认完整 V1 本地数据归属到' + ownerName +
    '。迁移仅保存本机 V4 数据，不会合并或上传。请先关闭旧版本标签页。')
  const panel = root.querySelector('section')
  if (!panel) return
  const confirm = document.createElement('button')
  confirm.type = 'button'
  confirm.textContent = '确认归属并建立隔离工作区'
  confirm.style.cssText = 'margin-top:20px;border:1px solid #64748b;border-radius:6px;padding:8px 16px'
  confirm.addEventListener('click', () => {
    confirm.disabled = true
    gateUI('正在保存本机学习数据', '正在提交 V4 快照和账户归属。')
    void (async () => {
      try {
        const { initializeLegacyWorkspace } = await import('./sync/workspace-coordinator')
        await initializeLegacyWorkspace(owner)
        boot?.release()
        gateUI('数据归属已提交', '正在以全新的 JavaScript 上下文加载学习数据。')
        window.location.replace('/')
      } catch (error) {
        gateUI('迁移受阻，原始本地数据保留',
          error instanceof Error ? error.message : String(error),
          '重新检查')
      }
    })()
  })
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = '取消，保持 V1'
  cancel.style.cssText = 'margin-left:12px;padding:8px 12px'
  cancel.addEventListener('click', () => {
    boot?.release()
    window.location.replace('/')
  })
  panel.append(confirm, cancel)
}

function onStage(stage: WorkspaceBootStage): void {
  if (stage === 'locking') {
    gateUI('正在准备本地学习数据', '正在取得本浏览器的独占学习数据写入权限…')
  } else if (stage === 'recovering') {
    gateUI('正在恢复学习进度', '检测到上次未完成的工作区切换，正在安全恢复。')
  }
}

async function start(): Promise<void> {
  if (starting || releasedForPageHide) return
  starting = true
  try {
    boot = await prepareGuardedWorkspaceBoot(onStage, { allowLegacy: true })
    if (releasedForPageHide) {
      boot.release()
      return
    }
    if (
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).get('s1-migration') === 'confirm' &&
      boot.mode === 'legacy'
    ) {
      showDevelopmentMigrationConsent()
      return
    }
    if (
      boot.mode === 'isolated' &&
      new URLSearchParams(window.location.search).get('s1-account') === 'manage'
    ) {
      const { renderS1AccountManagement } = await import('./sync/workspace-account-ui')
      renderS1AccountManagement(root, boot.registry.active)
      return
    }
    // Importing the old app initializes store atoms and DB modules. This
    // module must never be evaluated before the boot gate resolves.
    await import('./app')
    mounted = true
  } catch (error) {
    boot?.release()
    boot = undefined
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('recovery completed; reload required')) {
      gateUI('恢复已完成', '正在重新加载已恢复的学习数据…')
      window.location.reload()
      return
    }
    if (message.includes('Another tab owns')) {
      gateUI('另一个标签页正在使用学习数据', '为防止两个标签页同时写入而损坏学习进度，本页暂不启动。请关闭其他 Qwerty Plus 标签页，再重试。', '重试')
    } else {
      gateUI('学习数据安全检查未通过', '已阻止本页写入，现有学习数据不会因此被清空。原因：' + message, '重新检查')
    }
  } finally {
    starting = false
  }
}

window.addEventListener('pagehide', () => {
  // A page restored from BFCache must never reuse an expired writer lease.
  releasedForPageHide = true
  // Do NOT release the writer lease while the React tree and its async DB
  // writers remain mounted. A BFCache-frozen page must retain ownership
  // until it is discarded/reloaded, or another tab could start writing the
  // same working IndexedDB while stale promises in this page still exist.
  // Browser document destruction releases Web Locks automatically.
  if (!mounted) boot?.release()
})
window.addEventListener('pageshow', event => {
  if (event.persisted) window.location.reload()
})

void start()
