/**
 * Account-neutral data/sync controls. Authentication, registration and logout
 * live behind the global top-right account button and the guarded pre-mount
 * S1 account dialog. Never execute legacy V1 auth/write operations here.
 */
import { openAccountDialog } from './account-dialog-events'
import { getSyncV2Meta } from './api'
import { loadAuth } from './auth'
import { blockAutoSyncEnabled, setBlockAutoSyncEnabled } from './learn-block-sync'
import type { RemoteSyncMeta } from './types'
import { v4FailureCode } from './v4-failure-diagnostics'
import { workspaceRegistryPort } from './workspace-vault'
import { appendDeveloperTrace } from '@/dev/diagnostic-trace'
import { useEffect, useState } from 'react'

type WorkspaceState =
  | { mode: 'loading' }
  | { mode: 'legacy' }
  | { mode: 'anonymous' }
  | { mode: 'account'; accountId: string }
  | { mode: 'error'; message: string }

export default function CloudSyncSetting({
  navigateToTool = (path: string) => window.location.assign(path),
  disabled = false,
}: { navigateToTool?: (path: string) => void; disabled?: boolean } = {}) {
  const [workspace, setWorkspace] = useState<WorkspaceState>({ mode: 'loading' })
  const [remote, setRemote] = useState<RemoteSyncMeta | null>(null)
  const [status, setStatus] = useState('')
  const [checking, setChecking] = useState(false)
  const [syncEachBlock, setSyncEachBlock] = useState(false)
  const auth = loadAuth({ preserveExpired: true })
  const loggedIn = workspace.mode === 'account' && auth?.user.userId === workspace.accountId
  const expired = !!auth && auth.expiresAt * 1000 <= Date.now()
  const enabled =
    !disabled &&
    import.meta.env.VITE_QWERTY_SYNC_DISABLED !== 'true' &&
    REACT_APP_DEPLOY_ENV !== 'pages' &&
    (import.meta.env.DEV || import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC === 'true')

  useEffect(() => {
    let cancelled = false
    void workspaceRegistryPort
      .read()
      .then((registry) => {
        if (cancelled) return
        setSyncEachBlock(registry.active.kind === 'account' ? blockAutoSyncEnabled(registry.active.accountId) : false)
        setWorkspace(
          registry.pending
            ? { mode: 'error', message: '正在恢复上次账户切换，请刷新页面完成恢复。' }
            : registry.generation === 0
            ? { mode: 'legacy' }
            : registry.active.kind === 'anonymous'
            ? { mode: 'anonymous' }
            : { mode: 'account', accountId: registry.active.accountId },
        )
      })
      .catch((error) => {
        if (!cancelled)
          setWorkspace({
            mode: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const checkCloud = () => {
    if (disabled || !loggedIn || !auth || expired || checking) return
    setChecking(true)
    setStatus('正在读取云端状态…')
    void getSyncV2Meta(auth.token)
      .then((meta) => {
        setRemote(meta)
        setStatus('云端状态已更新。')
      })
      .catch((error) => {
        appendDeveloperTrace({ scope: 'runtime', event: 'cloud-status-check-failed', details: { code: v4FailureCode(error) } })
        setStatus('暂时无法连接云端，请稍后重试。')
      })
      .finally(() => setChecking(false))
  }

  if (REACT_APP_DEPLOY_ENV === 'pages') {
    return (
      <div role="status" className="text-sm text-gray-500">
        预览版暂不支持云同步，可使用本地备份。
      </div>
    )
  }

  return (
    <section className="space-y-3 text-left text-sm text-gray-600 dark:text-gray-300">
      {workspace.mode === 'loading' && <p role="status">正在读取账号状态…</p>}
      {workspace.mode === 'error' && <p role="alert">账号状态暂不可用，请稍后重试。</p>}
      {workspace.mode === 'legacy' && (
        <div className="space-y-2">
          <p>请先升级本机学习数据，再使用云同步。</p>
          <button type="button" className="my-btn-primary" disabled={disabled} onClick={() => navigateToTool('/?s1-migration=confirm')}>
            升级本机数据
          </button>
        </div>
      )}
      {workspace.mode === 'anonymous' && <p>登录后可在不同设备间同步学习进度。</p>}
      {workspace.mode === 'account' &&
        (!loggedIn ? (
          <p role="alert">账号状态需要更新，请重新登录。</p>
        ) : (
          <>
            <p>
              当前账号：<strong>{auth?.user.username ?? '未知账号'}</strong>
              {expired ? '（请重新登录）' : ''}
            </p>
            <button
              type="button"
              className="my-btn-primary disabled:opacity-50"
              disabled={!enabled || expired}
              onClick={() => navigateToTool('/?s2-sync=run')}
            >
              立即同步
            </button>
            {remote && <p>云端{remote.hasData ? '已有学习备份。' : '暂无学习备份。'}</p>}
            {status && <p role="status">{status}</p>}
          </>
        ))}
      <details className="space-y-3">
        <summary className="cursor-pointer">更多同步选项</summary>
        {loggedIn && workspace.mode === 'account' && (
          <>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                aria-label="每阶段结束后同步"
                checked={syncEachBlock}
                disabled={!enabled || expired}
                onChange={(event) => {
                  if (!auth || workspace.mode !== 'account') return
                  try {
                    setBlockAutoSyncEnabled(workspace.accountId, event.target.checked)
                    setSyncEachBlock(event.target.checked)
                    setStatus(event.target.checked ? '已开启每阶段同步。' : '已关闭每阶段同步。')
                  } catch {
                    setStatus('设置未能保存，请重试。')
                  }
                }}
              />
              <span>
                每阶段结束后同步<span className="block text-xs text-gray-500 dark:text-gray-400">今日任务完成后仍会自动同步。</span>
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="my-btn-primary disabled:opacity-50"
                disabled={disabled || checking || expired || import.meta.env.VITE_QWERTY_SYNC_DISABLED === 'true'}
                onClick={checkCloud}
              >
                {checking ? '检查中…' : '查看云端状态'}
              </button>
              <button
                type="button"
                className="my-btn-primary disabled:opacity-50"
                disabled={!enabled || expired}
                onClick={() => navigateToTool('/?v4-cloud-backup=download')}
              >
                下载云端备份
              </button>
              <button
                type="button"
                className="my-btn-primary disabled:opacity-50"
                disabled={disabled || expired}
                onClick={(event) => {
                  event.stopPropagation()
                  openAccountDialog()
                }}
              >
                云端账号工具
              </button>
              <button
                type="button"
                className="text-sm underline disabled:opacity-50"
                disabled={!enabled || expired}
                onClick={() => navigateToTool('/?s2-recovery=manage')}
              >
                恢复同步
              </button>
            </div>
          </>
        )}
        <button type="button" className="text-xs underline" disabled={disabled} onClick={() => navigateToTool('/?perf-report=view')}>
          查看同步诊断
        </button>
      </details>
    </section>
  )
}
