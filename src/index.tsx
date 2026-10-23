/**
 * Sole real-app entry. No import of React/Jotai/RecordDB or domain modules
 * may precede the exclusive writer lease and pending-journal check.
 * Legacy users continue without automatic S1 migration.
 */
import { loadAuth } from './sync/auth'
import { startPerfStage, timePerfStage } from './sync/perf-diagnostics'
import { DAILY_SESSION_PREFIX, WORKSPACE_SETTING_KEYS } from './sync/workspace-v4'
import { prepareGuardedWorkspaceBoot } from './sync/workspace-bootstrap'
import { learningEventSyncEnabled } from './sync/learning-sync-policy'
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
let stopSessionRevocationMonitor: (() => void) | undefined
let stopEtestM3BackgroundMonitor: (() => void) | undefined

function gateUI(title: string, detail: string, action?: string, onRetry: () => void = () => window.location.reload()): void {
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
    retry.addEventListener('click', onRetry)
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
  const acknowledge = document.createElement('label')
  acknowledge.style.cssText = 'display:block;margin:18px 0 12px;line-height:1.7'
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.setAttribute('aria-label', '已核对本机完整 V4 备份')
  acknowledge.append(checkbox, document.createTextNode(
    ' 我已通过「设置 → 数据管理 → 导出完整备份」保存并校验本机 Backup V4，' +
    '且已关闭其他旧版 Qwerty Plus 标签页。迁移不会上传到云端。',
  ))
  panel.append(acknowledge)
  const confirm = document.createElement('button')
  confirm.type = 'button'
  confirm.textContent = '确认归属并建立隔离工作区'
  confirm.disabled = true
  checkbox.addEventListener('change', () => { confirm.disabled = !checkbox.checked })
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
  // Block sync is a full-page, writer-locked S2 handoff, but the user sees
  // only the familiar Block status panel throughout boot and cloud transfer.
  if (new URLSearchParams(window.location.search).get('learn-block') === '1') {
    const notice = root?.querySelector('[data-learn-block-sync] [role="status"]')
    if (notice) {
      notice.textContent = stage === 'locking'
        ? '正在锁定本地学习记录，准备安全同步…'
        : stage === 'recovering'
          ? '正在恢复上一次未完成的安全事务…'
          : '正在同步学习进度…'
      return
    }
  }
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
    if (new URLSearchParams(window.location.search).get('learn-block') === '1') {
      const { renderLearnBlockSyncScreen } = await import('./sync/learn-block-sync-ui')
      renderLearnBlockSyncScreen(root, null)
    }
    boot = await timePerfStage('startup', 'guarded-bootstrap', () =>
      prepareGuardedWorkspaceBoot(onStage, {
        allowLegacy: true,
        writerWaitMs: /\/mobile\/account\/?$/.test(window.location.pathname) ? 3000 : 0,
      }))
    if (releasedForPageHide) {
      boot.release()
      return
    }
    // P0 first-visit admission: initialize genuinely empty browser storage
    // BEFORE mounting React/RecordDB writers or allowing anonymous study.
    // Otherwise a new visitor can learn words in legacy mode and be mistaken
    // for a pre-S1 V1 user when they first click Login.
    //
    // This is fail-closed and read-only until the emptiness proof succeeds:
    // any old word, Learn checkpoint, unknown storage key, auth identity or
    // inaccessible IndexedDB keeps the explicit legacy migration path.
    // The exclusive S1 writer lease is held across proof + registry CAS.
    if (boot.mode === 'legacy') {
      const { isFreshEmptyLegacyWorkspace } = await import('./sync/workspace-pristine')
      if (await isFreshEmptyLegacyWorkspace()) {
        gateUI('正在准备学习空间', '正在初始化本机匿名学习记录…')
        const { initializeLegacyWorkspace } = await import('./sync/workspace-coordinator')
        await initializeLegacyWorkspace({ kind: 'anonymous' })
        boot.release()
        boot = undefined
        // Snapshot initialization imports storage-backed modules. Reload the
        // SAME requested route in a new JS realm before any app hydration.
        window.location.replace(window.location.href)
        return
      }
    }
    if (
      (import.meta.env.DEV ||
        (REACT_APP_DEPLOY_ENV !== 'pages' &&
          import.meta.env.VITE_S1_ENABLE_EXPLICIT_V4_MIGRATION === 'true')) &&
      new URLSearchParams(window.location.search).get('s1-migration') === 'confirm' &&
      boot.mode === 'legacy'
    ) {
      showExplicitMigrationConsent()
      return
    }
    // A revoked-session confirmation cannot switch the S1 working owner
    // while React/IndexedDB writers are mounted. This is the independent,
    // writer-locked pre-mount continuation of the confirmed alertdialog.
    if (new URLSearchParams(window.location.search).get('s1-session-revoked') === 'confirm') {
      const { completeConfirmedRevokedLogout } = await import('./sync/session-revocation')
      await completeConfirmedRevokedLogout(boot, gateUI)
      return
    }
    if (new URLSearchParams(window.location.search).get('perf-report') === 'view') {
      const { renderPerfReportUI } = await import('./sync/perf-report-ui')
      renderPerfReportUI(root)
      return
    }
    // Return after an S2 Pull journal recovery without mounting React.  The
    // Block completion UI remains non-modal and still holds the writer lease.
    if (new URLSearchParams(window.location.search).get('learn-block-sync') === 'result') {
      const { readLearnBlockSyncPending, readLearnBlockSyncOutcome } =
        await import('./sync/learn-block-sync')
      const { renderLearnBlockSyncScreen } = await import('./sync/learn-block-sync-ui')
      const accountId = boot.registry.active.kind === 'account' ? boot.registry.active.accountId : ''
      const context = readLearnBlockSyncPending(accountId)
      const screen = renderLearnBlockSyncScreen(root, context)
      const previous = context ? readLearnBlockSyncOutcome() : null
      screen.settle(previous ?? {
        kind: 'failed',
        message: '无法确认当前账号上次 Block 的云同步结果，本地记录仍保留。',
      })
      return
    }
    // S2 pilot: the ONLY ordinary Sync action navigates into a new,
    // pre-mount, S1 writer-locked realm; it never mutates RecordDB from
    // mounted React. Production remains disabled without explicit flag.
    if (new URLSearchParams(window.location.search).get('s2-sync') === 'run') {
      if (boot.mode !== 'isolated' ||
          !(import.meta.env.DEV ||
            (REACT_APP_DEPLOY_ENV !== 'pages' &&
              import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC === 'true'))) {
        throw new Error('S2 Sync 尚未在此部署启用。')
      }
      // The Learn Block variant uses the same guarded S2 executor, never
      // a mounted React writer.  Its status is shown within the Block card.
      const isLearnBlock = new URLSearchParams(window.location.search).get('learn-block') === '1'
      let blockScreen: {
        setStatus(message: string): void
        settle(result: { kind: 'ok' | 'failed'; message: string }): void
      } | undefined
      if (isLearnBlock) {
        const { readLearnBlockSyncPending, blockAutoSyncEnabled } =
          await import('./sync/learn-block-sync')
        const { renderLearnBlockSyncScreen } = await import('./sync/learn-block-sync-ui')
        const accountId = boot.registry.active.kind === 'account' ? boot.registry.active.accountId : ''
        const context = readLearnBlockSyncPending(accountId)
        if (!context || (!context.dailyComplete && !blockAutoSyncEnabled(accountId))) {
          throw new Error('Block 自动同步上下文失效或当前账号未授权自动同步')
        }
        blockScreen = renderLearnBlockSyncScreen(root, context)
        blockScreen.setStatus('正在同步学习进度…')
      } else {
        gateUI('正在安全同步', '正在检查工作区、云端版本和完整性，必要时进行安全事务操作…')
      }
      try {
        const { executePreMountManualSyncV2 } = await import('./sync/v2-browser-executor')
        // Capture the validated boot lease locally. A module-scope mutable
        // variable loses its TypeScript narrowing inside async callbacks.
        const syncBoot: GuardedWorkspaceBoot = boot
        const result = await timePerfStage('sync', 'sync-total', () =>
          executePreMountManualSyncV2(syncBoot))
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
        if (isLearnBlock) {
          const { saveLearnBlockSyncOutcome } = await import('./sync/learn-block-sync')
          const outcome = status === 'noop' || status === 'pushed' ||
            status === 'pull-reload-required'
            ? { kind: 'ok' as const, message: note }
            : { kind: 'failed' as const, message: note + ' 本机学习记录仍已保存。' }
          saveLearnBlockSyncOutcome(outcome)
          if (status === 'pull-reload-required') {
            // The next S1 boot must replay the staged Pull journal before
            // showing any successful completion/exit controls.
            blockScreen!.setStatus('正在安全恢复云端进度…')
            window.location.replace('/?learn-block-sync=result')
            return
          }
          blockScreen!.settle(outcome)
          return
        }
        if (status !== 'pull-reload-required') {
          sessionStorage.setItem('qwerty.s2.last-sync-result', note)
        }
      } catch (error) {
        const message = '同步未确认，将先执行安全恢复检查：' +
          (error instanceof Error ? error.message : String(error))
        if (isLearnBlock) {
          const { saveLearnBlockSyncOutcome } = await import('./sync/learn-block-sync')
          const outcome = { kind: 'failed' as const, message }
          saveLearnBlockSyncOutcome(outcome)
          blockScreen!.settle(outcome)
          return
        }
        // If a Pull was staged, the next boot MUST first replay its journal.
        sessionStorage.setItem('qwerty.s2.last-sync-result', message)
      }
      // Retain the exclusive lease until this document is destroyed; the
      // new page must freshly acquire its own writer lease.
      window.location.replace('/')
      return
    }
    if (new URLSearchParams(window.location.search).get('s1-clear') === 'manage') {
      if (boot.mode !== 'isolated' || boot.registry.pending) {
        throw new Error('本地学习数据清除必须在 S1 安全工作区内执行。')
      }
      // Like full V4 imports and S2 pulls, a destructive local reset must
      // execute in the exclusive, unmounted writer-locked document.
      const { renderClearLocalLearningUI } = await import('./sync/workspace-clear-local-ui')
      await renderClearLocalLearningUI(root, boot)
      return
    }
    if (new URLSearchParams(window.location.search).get('v4-import') === 'manage') {
      if (boot.mode !== 'isolated') {
        throw new Error('完整 V4 导入需要先建立 S1 隔离工作区。')
      }
      const { renderManualV4ImportUI } = await import('./sync/manual-v4-import-ui')
      await renderManualV4ImportUI(root, boot)
      return
    }
    if (new URLSearchParams(window.location.search).get('v4-cloud-backup') === 'download') {
      if (boot.mode !== 'isolated' || boot.registry.active.kind !== 'account') {
        throw new Error('云端备份下载需要登录隔离账号。')
      }
      const { renderCloudV4BackupUI } = await import('./sync/cloud-v4-backup-ui')
      await renderCloudV4BackupUI(root, boot)
      return
    }
    if (new URLSearchParams(window.location.search).get('s2-recovery') === 'manage') {
      if (boot.mode !== 'isolated' ||
          !(import.meta.env.DEV ||
            import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC === 'true')) {
        throw new Error('S2 高级恢复尚未在此部署启用。')
      }
      const { renderS2RecoveryUI } = await import('./sync/v2-recovery-ui')
      await renderS2RecoveryUI(root, boot)
      return
    }
    const mobileAccount = window.location.pathname.replace(/\/$/, '').endsWith('/mobile/account')
    if (mobileAccount || new URLSearchParams(window.location.search).get('s1-account') === 'manage') {
      const cloudDisabled = REACT_APP_DEPLOY_ENV === 'pages' || import.meta.env.VITE_QWERTY_SYNC_DISABLED === 'true'
      if (cloudDisabled && boot.mode === 'legacy') {
        // Presentation only: do not import authentication/transition handlers
        // or assign legacy learning data merely to show a cloud-disabled preview.
        const { renderAccountPreview } = await import('./sync/mobile-account-view')
        renderAccountPreview(root, { mobile: mobileAccount })
        return
      }
      if (boot.mode === 'legacy') {
        // Old or uncertain V1 data can never be silently assigned to S1.
        // The truly empty-origin case was handled before the app mounted.
        // Existing or uncertain V1 histories still require full backup and
        // explicit consent. An uninitialized registry is NOT proof of no data.
        // Old V1 users must establish isolated ownership once before logging
        // in/out through the new unified account dialog.
        if (import.meta.env.DEV ||
            (REACT_APP_DEPLOY_ENV !== 'pages' &&
              import.meta.env.VITE_S1_ENABLE_EXPLICIT_V4_MIGRATION === 'true')) {
          showExplicitMigrationConsent()
          return
        }
        throw new Error('账号管理需要 S1 安全工作区，旧版数据不能直接切换账号。')
      }
      const { renderS1AccountManagement } = await import('./sync/workspace-account-ui')
      renderS1AccountManagement(root, boot.registry.active, {
        mobile: mobileAccount,
        cloudDisabled,
      })
      return
    }
    // Importing the old app initializes store atoms and DB modules. This
    // module must never be evaluated before the boot gate resolves.
    const finishFirstFrame = startPerfStage('startup', 'entry-to-first-frame')
    await timePerfStage('startup', 'app-module-import', () => import('./app'))
    mounted = true
    requestAnimationFrame(() => finishFirstFrame())
    if (boot.mode === 'isolated') {
      const { startSessionRevocationMonitor } = await import('./sync/session-revocation')
      stopSessionRevocationMonitor = startSessionRevocationMonitor(boot.registry)
      // Only an S1-owned account on an approved cloud origin, never Pages.
      // Background scans recover crashes after the WordRecord commit without
      // modifying any snapshot. The browser adapter rechecks ownership.
      if (boot.registry.active.kind === 'account' && learningEventSyncEnabled()) {
        try {
          const { startEtestM3BackgroundMonitor } =
            await import('./sync/m3-background-browser')
          stopEtestM3BackgroundMonitor = startEtestM3BackgroundMonitor()
        } catch (error) {
          // Optional network/pilot module loading can fail offline. NEVER
          // propagate to the outer boot catch, which would release the
          // exclusive S1 writer lease AFTER React has mounted.
          console.warn('etest M3 background disabled; local writer lease retained', error)
        }
      }
    }
    showS1AccountResult()
  } catch (error) {
    boot?.release()
    boot = undefined
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('S2 Pull staged; reload required')) {
      gateUI('正在恢复云端学习记录', '完整数据已校验，正在完成安全恢复事务…')
      window.location.reload()
      return
    }
    if (message.includes('recovery completed; reload required')) {
      gateUI('恢复已完成', '正在重新加载已恢复的学习数据…')
      window.location.reload()
      return
    }
    if (message.includes('Another tab owns')) {
      if (/\/mobile\/account\/?$/.test(window.location.pathname)) {
        gateUI('学习数据暂时被占用',
          '页面切换或其他页面仍在使用学习数据。请稍后在此重试；若仍无法进入，请关闭其他 Qwerty Plus 页面。本机学习记录会保留。',
          '在此重试', () => { void start() })
        const panel = root?.querySelector('section')
        if (panel) {
          const diagnose = document.createElement('button')
          diagnose.type = 'button'
          diagnose.textContent = '复制诊断信息'
          diagnose.style.cssText = 'margin-left:12px;padding:8px 12px'
          const note = document.createElement('p')
          note.style.cssText = 'font-size:13px;color:#64748b'
          note.textContent = '若只有一个页面仍无法进入，可复制占用信息用于排查。诊断不包含账号或学习内容。'
          diagnose.addEventListener('click', () => {
            diagnose.disabled = true
            diagnose.textContent = '正在检查占用…'
            void (async () => {
              try {
                const { inspectWorkspaceWriter } = await import('./sync/workspace-lock-diagnostics')
                const first = await inspectWorkspaceWriter()
                await new Promise<void>(resolve => window.setTimeout(resolve, 2500))
                const second = await inspectWorkspaceWriter()
                const text = JSON.stringify({ version: LATEST_COMMIT_HASH,
                  browser: navigator.userAgent, path: window.location.pathname,
                  samples: [first, second] }, null, 2)
                if (!diagnose.isConnected) return
                try {
                  await navigator.clipboard.writeText(text)
                  note.textContent = '已复制诊断信息，可以粘贴给开发者排查。'
                } catch {
                  const output = document.createElement('textarea')
                  output.readOnly = true
                  output.value = text
                  output.setAttribute('aria-label', '占用诊断信息')
                  output.style.cssText = 'display:block;width:100%;height:180px;margin-top:12px'
                  panel.append(output)
                  output.focus()
                  output.select()
                  note.textContent = '请复制下方已选中的诊断信息。'
                }
              } catch {
                if (note.isConnected) note.textContent = '暂时无法读取诊断信息，学习记录未修改。'
              } finally {
                if (diagnose.isConnected) { diagnose.disabled = false; diagnose.textContent = '复制诊断信息' }
              }
            })()
          })
          panel.append(diagnose, note)
        }
      } else {
        gateUI('另一个标签页正在使用学习数据', '为防止两个标签页同时写入而损坏学习进度，本页暂不启动。请关闭其他 Qwerty Plus 标签页，再重试。', '重试')
      }
    } else {
      gateUI('学习数据安全检查未通过', '已阻止本页写入，现有学习数据不会因此被清空。原因：' + message, '重新检查')
    }
  } finally {
    starting = false
  }
}

window.addEventListener('pagehide', () => {
  stopSessionRevocationMonitor?.()
  stopEtestM3BackgroundMonitor?.()
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
