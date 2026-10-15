import V4SizeReport from './V4SizeReport'
import { clearAllLearnDailySessions } from '@/learn/daily-session'
import CloudSyncSetting from '@/sync/CloudSyncSetting'
import {
  downloadManualBackupV4,
  exportManualBackupV4Json,
  inspectManualBackupV4File,
} from '@/sync/manual-backup-v4'
import { loadAuth } from '@/sync/auth'
import { workspaceRegistryPort } from '@/sync/workspace-vault'
import { parseWorkspaceV4 } from '@/sync/workspace-v4'
import { analyzeV4SnapshotSize } from '@/sync/v4-size-audit'
import type { V4SizeAudit } from '@/sync/v4-size-audit'
import { assertLegacyLocalDestructiveOperationAllowed } from '@/sync/workspace-auth-guard'
import { clearSyncBaseline } from '@/sync/state'
import { clearLocalLearningData } from '@/utils/db/data-export'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useCallback, useEffect, useState } from 'react'

export default function DataSetting() {
  const [isClearing, setIsClearing] = useState(false)
  const [isV4Busy, setIsV4Busy] = useState(false)
  const [v4Message, setV4Message] = useState('')
  const [sizeAuditReport, setSizeAuditReport] = useState<V4SizeAudit | null>(null)
  const [sizeAuditError, setSizeAuditError] = useState('')
  // Cloud controls remain hidden until the S1 owner and an unexpired login
  // are verified together. A stored token alone is insufficient.
  const [showCloudControls, setShowCloudControls] = useState(false)

  useEffect(() => {
    let active = true
    let generation = 0
    const verifyOwner = () => {
      const requestId = ++generation
      setShowCloudControls(false)
      void workspaceRegistryPort.read()
        .then(registry => {
          if (!active || requestId !== generation) return
          const auth = loadAuth({ preserveExpired: true })
          setShowCloudControls(
            !registry.pending &&
            registry.generation > 0 &&
            registry.active.kind === 'account' &&
            auth !== null &&
            auth.user.userId === registry.active.accountId &&
            auth.expiresAt * 1000 > Date.now(),
          )
        })
        .catch(() => {
          if (active && requestId === generation) setShowCloudControls(false)
        })
    }
    verifyOwner()
    // Logging out in another tab or returning to an expired session must
    // hide the cloud actions, even if the Data dialog stays mounted.
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'qwerty.cloudAuth.v1' || event.key === null) verifyOwner()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', verifyOwner)
    document.addEventListener('visibilitychange', verifyOwner)
    return () => {
      active = false
      ++generation
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', verifyOwner)
      document.removeEventListener('visibilitychange', verifyOwner)
    }
  }, [])

  const onClickExportV4 = useCallback(async () => {
    setV4Message('正在准备完整备份…')
    setIsV4Busy(true)
    try {
      const info = await downloadManualBackupV4()
      setV4Message(
        `备份已导出：${info.tableCount} 张表、${info.dailySessions} 个学习会话、${info.settingCount} 项设置。`,
      )
    } catch (error) {
      setV4Message('备份导出失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setIsV4Busy(false)
    }
  }, [])

  const onClickInspectV4 = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.gz,application/gzip'
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return
      setIsV4Busy(true)
      setV4Message('正在校验备份文件…')
      try {
        const info = await inspectManualBackupV4File(file)
        setV4Message(
          `校验通过：${info.tableCount} 张表、${info.dailySessions} 个学习会话、${info.settingCount} 项设置；来源：${info.owner}。本地数据未改变。`,
        )
      } catch (error) {
        setV4Message('备份校验失败：' + (error instanceof Error ? error.message : String(error)))
      } finally {
        setIsV4Busy(false)
      }
    })
    input.click()
  }, [])

  const onClickAuditV4Size = useCallback(async () => {
    setIsV4Busy(true)
    setSizeAuditReport(null)
    setSizeAuditError('')
    try {
      const snapshot = parseWorkspaceV4(await exportManualBackupV4Json())
      const report = await analyzeV4SnapshotSize(snapshot)
      setSizeAuditReport(report)
    } catch (error) {
      setSizeAuditError('容量分析失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setIsV4Busy(false)
    }
  }, [])

  const onClickClearLocalData = useCallback(async () => {
    // A real S1 workspace must NEVER clear active Dexie tables in mounted
    // React. Navigate to the dedicated pre-mount writer-locked V4 transaction.
    try {
      const registry = await workspaceRegistryPort.read()
      if (registry.generation > 0) {
        if (registry.pending) {
          throw new Error('存在未完成的工作区恢复事务，不能清除学习记录')
        }
        window.location.assign('/?s1-clear=manage')
        return
      }
      await assertLegacyLocalDestructiveOperationAllowed()
    } catch (error) {
      window.alert('操作已阻止：' + (error instanceof Error ? error.message : String(error)))
      return
    }
    const confirmed = window.confirm(
      showCloudControls
        ? '将清除本浏览器中的练习记录、章节记录和智能复习数据。云端账号和云端备份不会被删除。此操作不可撤销；如需保留本地数据，请先导出或上传到云端。是否继续？'
        : '将清除本浏览器中的练习记录、章节记录和智能复习数据。此操作不可撤销；如需保留本地数据，请先导出完整本地备份。是否继续？',
    )
    if (!confirmed) return

    setIsClearing(true)

    try {
      await clearLocalLearningData()

      const auth = loadAuth()
      if (auth) {
        clearSyncBaseline(auth.user.userId)
      }

      localStorage.removeItem('currentDict')
      localStorage.removeItem('currentChapter')
      localStorage.removeItem('reviewModeInfo')
      clearAllLearnDailySessions()

      window.alert(showCloudControls
        ? '本地学习数据已清除，默认词库已恢复为“中考核心词”。云端账号和云端备份均未删除。'
        : '本地学习数据已清除，默认词库已恢复为“中考核心词”。')
      window.location.reload()
    } catch (error) {
      console.error('清除本地数据失败：', error)
      window.alert('清除本地数据失败，请刷新页面后重试。')
      setIsClearing(false)
    }
  }, [showCloudControls])

  return (
    <ScrollArea.Root className="flex-1 min-w-0 overflow-y-auto">
      <ScrollArea.Viewport className="h-full w-full">
        <div className="flex min-w-0 w-full flex-col gap-6 px-5 py-6 pb-10 sm:px-6">
          {REACT_APP_DEPLOY_ENV !== 'pages' && showCloudControls && (
            <section className="min-w-0 rounded-xl border border-[var(--focus-border)] bg-[var(--focus-surface)] p-4" aria-label="云端同步">
              <h3 className="mb-3 text-base font-semibold text-[var(--focus-text)]">云端同步</h3>
              <CloudSyncSetting />
            </section>
          )}

          <section aria-label="本地备份" className="min-w-0">
            <div className="mb-1 text-base font-semibold text-[var(--focus-text)]">本地备份</div>
            <p className="mb-4 text-sm leading-relaxed text-[var(--focus-text-secondary)]">
              包含学习记录、记忆进度、成就和设置。导入会替换本地数据，不会合并。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="min-h-10 rounded-lg bg-[var(--focus-accent)] px-4 py-2 text-sm font-medium text-[var(--focus-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50"
                type="button"
                onClick={() => { void onClickExportV4() }}
                disabled={isV4Busy || isClearing}
              >
                {isV4Busy ? '处理中…' : '导出完整备份'}
              </button>
              <button
                className="min-h-10 rounded-lg border border-[var(--focus-border)] bg-[var(--focus-surface)] px-4 py-2 text-sm font-medium text-[var(--focus-text)] transition-colors hover:bg-[var(--focus-surface-muted)] disabled:opacity-50"
                type="button"
                onClick={() => window.location.assign('/?v4-import=manage')}
                disabled={isV4Busy || isClearing}
              >
                导入完整备份
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <button
                className="rounded-md py-1 text-left text-sm text-[var(--focus-text-secondary)] underline-offset-4 transition-colors hover:text-[var(--focus-text)] hover:underline disabled:opacity-50"
                type="button"
                onClick={onClickInspectV4}
                disabled={isV4Busy || isClearing}
              >
                校验备份文件
              </button>
              <button
                className="rounded-md py-1 text-left text-sm text-[var(--focus-text-secondary)] underline-offset-4 transition-colors hover:text-[var(--focus-text)] hover:underline disabled:opacity-50"
                type="button"
                onClick={() => { void onClickAuditV4Size() }}
                disabled={isV4Busy || isClearing}
              >
                {isV4Busy && !sizeAuditReport ? '正在分析…' : '分析备份容量'}
              </button>
            </div>
            {v4Message && (
              <p role="status" className="mt-3 break-words text-sm leading-relaxed text-[var(--focus-text-secondary)]">
                {v4Message}
              </p>
            )}
            {sizeAuditReport && <V4SizeReport report={sizeAuditReport} />}
            {sizeAuditError && (
              <p role="alert" className="mt-3 break-words text-sm leading-relaxed text-red-500">{sizeAuditError}</p>
            )}
          </section>

          <section className="border-t border-[var(--focus-border)] pt-5">
            <details className="group">
              <summary className="cursor-pointer select-none text-sm font-medium text-[var(--focus-text-secondary)] transition-colors hover:text-[var(--focus-text)]">
                高级操作 · 清除本地数据
              </summary>
              <div className="mt-3 space-y-3 pl-1">
                <p className="text-sm leading-relaxed text-[var(--focus-text-secondary)]">
                  清除当前工作区的学习记录、章节记录及智能复习数据。操作不可撤销；请先导出完整备份。
                  {showCloudControls && ' 不会删除云端账号或云端备份。'}
                </p>
                <button
                  className="min-h-9 rounded-lg border border-red-500/50 bg-transparent px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                  type="button"
                  onClick={onClickClearLocalData}
                  disabled={isClearing || isV4Busy}
                  title="清除本地学习数据"
                >
                  {isClearing ? '正在清除…' : '清除本地数据'}
                </button>
              </div>
            </details>
          </section>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent" orientation="vertical" />
    </ScrollArea.Root>
  )
}
