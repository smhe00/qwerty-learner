/**
 * Sole real-app entry. No import of React/Jotai/RecordDB or domain modules
 * may precede the exclusive writer lease and pending-journal check.
 * Legacy users continue without automatic S1 migration.
 */
import { loadAuth } from './sync/auth'
import { DAILY_SESSION_PREFIX, WORKSPACE_SETTING_KEYS } from './sync/workspace-v4'
import { prepareGuardedWorkspaceBoot } from './sync/workspace-bootstrap'
import type { Workspace } from './sync/workspace-transition'
import type { GuardedWorkspaceBoot, WorkspaceBootStage } from './sync/workspace-bootstrap'

const S1_STORAGE_FENCE = new Set<string>([
  ...WORKSPACE_SETTING_KEYS,
  'currentDict',
  'currentChapter',
  'reviewModeInfo',
  'qwerty.cloudAuth.v1',
])

/**
 * A tab running the old V5 JavaScript does not hold our Web Lock and may
 * still write localStorage even after IndexedDB V6 refuses old DB writes.
 * For a mounted S1 owner, revert observed foreign writes before they are
 * captured in the next workspace snapshot.
 *
 * A real cross-document storage event is trusted. Locally synthesized
 * storage events used by the legacy app are NOT trusted and must be ignored.
 * This is a containment measure, not a proof that a closed or discarded
 * owner can observe future writes by an old V5 tab.
 */
function fenceForeignWorkspaceStorageWrites(event: StorageEvent): void {
  if (boot?.mode !== 'isolated' ||
      !event.isTrusted ||
      event.storageArea !== localStorage) return

  // localStorage.clear() generates a storage event with key = null.
  // It cannot be individually rolled back because the browser does not
  // provide the previous values. Fail closed on the next guarded boot.
  if (event.key === null) {
    console.error('S1 detected legacy-tab clearing of shared localStorage')
    // Reload alone is unsafe: the anonymous owner can still match while all
    // user preferences and Learn sessions have been deleted by the old tab.
    // Session storage survives reload and cannot be cleared by another tab.
    sessionStorage.setItem('qwerty.s1.foreign-storage-clear-blocked', '1')
    window.location.reload()
    return
  }
  if (!S1_STORAGE_FENCE.has(event.key) &&
      !event.key.startsWith(DAILY_SESSION_PREFIX)) return

  // Another tab may have caused a later legitimate change; never overwrite
  // it with an earlier event's value.
  if (localStorage.getItem(event.key) !== event.newValue) return
  try {
    if (event.oldValue === null) localStorage.removeItem(event.key)
    else localStorage.setItem(event.key, event.oldValue)
  } catch (error) {
    console.error('S1 failed to reject an unauthorized cross-tab storage write', error)
    // Do not save any future workspace snapshot from this JS context.
    window.location.reload()
  }
}

window.addEventListener('storage', fenceForeignWorkspaceStorageWrites)

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
 * Explicit V1 ownership opt-in before React or any working-data writer mount.
 * Local Vite DEV is always testable. Production can only expose the route if
 * the operator deliberately supplies the build-time release gate. The default
 * production build keeps the migration entry disabled until validation.
 */
function showExplicitMigrationConsent(): void {
  if (!root || !boot || boot.mode !== 'legacy') return
  const auth = loadAuth({ preserveExpired: true })
  const owner: Workspace = auth
    ? { kind: 'account', accountId: auth.user.userId }
    : { kind: 'anonymous' }
  const ownerName = auth
    ? '账号“' + auth.user.username + '”（不可变 ID：' + auth.user.userId + '）'
    : '当前本机匿名工作区'
  const isDev = import.meta.env.DEV
  gateUI(isDev ? 'S1 V1 数据归属测试（仅限本地开发）' : 'S1 本机学习数据归属确认',
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


function showS1AccountResult(): void {
  const keys = ['qwerty.s2.last-sync-result', 'qwerty.s1.last-account-result']
  const key = keys.find(item => sessionStorage.getItem(item) !== null)
  if (!key) return
  const note = sessionStorage.getItem(key)
  if (!note) return
  sessionStorage.removeItem(key)
  const toast = document.createElement('div')
  toast.setAttribute('role', 'status')
  toast.textContent = note
  toast.style.cssText = 'position:fixed;z-index:9999;top:20px;left:50%;transform:translateX(-50%);' +
    'max-width:85vw;padding:14px 22px;border-radius:8px;border:1px solid #64748b;' +
    'background:#f8fafc;color:#1e293b;font-family:system-ui;box-shadow:0 4px 18px #0002'
  document.body.appendChild(toast)
  // Last-result messages are user-visible after the navigation and
  // contain no credentials, tokens, or private learning data.
  setTimeout(() => { toast.remove() }, 12000)
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
      (import.meta.env.DEV ||
        import.meta.env.VITE_S1_ENABLE_EXPLICIT_V4_MIGRATION === 'true') &&
      new URLSearchParams(window.location.search).get('s1-migration') === 'confirm' &&
      boot.mode === 'legacy'
    ) {
      showExplicitMigrationConsent()
      return
    }
    // S2 pilot: the ONLY ordinary Sync action navigates into a new,
    // pre-mount, S1 writer-locked realm; it never mutates RecordDB from
    // mounted React. Production remains disabled without explicit flag.
    if (new URLSearchParams(window.location.search).get('s2-sync') === 'run') {
      if (boot.mode !== 'isolated' ||
          !(import.meta.env.DEV ||
            import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC === 'true')) {
        throw new Error('S2 Sync 尚未在此部署启用。')
      }
      gateUI('正在安全同步', '正在检查工作区、云端版本和完整性，必要时进行安全事务操作…')
      try {
        const { executePreMountManualSyncV2 } = await import('./sync/v2-browser-executor')
        const result = await executePreMountManualSyncV2(boot)
        const status = result.status
        const note = status === 'noop'
          ? '同步完成：本地和云端已经一致，没有传输完整数据。'
          : status === 'pushed'
            ? '同步完成：本地进度已安全上传至云端。'
            : status === 'pull-reload-required'
              ? '同步完成：已安全恢复云端进度。'
              : status === 'conflict'
                ? '同步冲突：本地和云端均有变化，未覆盖任何一方。'
                : '同步被安全拦截：' + result.reason
        sessionStorage.setItem('qwerty.s2.last-sync-result', note)
      } catch (error) {
        // If a Pull was staged, the next boot MUST first replay its journal.
        sessionStorage.setItem('qwerty.s2.last-sync-result',
          '同步未确认，将先执行安全恢复检查：' +
          (error instanceof Error ? error.message : String(error)))
      }
      // Retain the exclusive lease until this document is destroyed; the
      // new page must freshly acquire its own writer lease.
      window.location.replace('/')
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
    showS1AccountResult()
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
  // The lease is retained until document destruction. Pre-mount account
  // transitions may still be writing even when React has not mounted.
})
window.addEventListener('pageshow', event => {
  if (event.persisted) window.location.reload()
})

void start()
