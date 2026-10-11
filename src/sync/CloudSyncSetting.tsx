/**
 * Account-neutral data/sync controls. Authentication, registration and logout
 * live behind the global top-right account button and the guarded pre-mount
 * S1 account dialog. Never execute legacy V1 auth/write operations here.
 */
import { getSyncV2Meta } from './api'
import { loadAuth } from './auth'
import { workspaceRegistryPort } from './workspace-vault'
import type { RemoteSyncMeta } from './types'
import { useEffect, useState } from 'react'

type WorkspaceState =
  | { mode: 'loading' }
  | { mode: 'legacy' }
  | { mode: 'anonymous' }
  | { mode: 'account'; accountId: string }
  | { mode: 'error'; message: string }

export default function CloudSyncSetting() {
  const [workspace, setWorkspace] = useState<WorkspaceState>({ mode: 'loading' })
  const [remote, setRemote] = useState<RemoteSyncMeta | null>(null)
  const [status, setStatus] = useState('')
  const [checking, setChecking] = useState(false)
  const auth = loadAuth({ preserveExpired: true })
  const loggedIn =
    workspace.mode === 'account' && auth?.user.userId === workspace.accountId
  const expired = !!auth && auth.expiresAt * 1000 <= Date.now()
  const enabled = REACT_APP_DEPLOY_ENV !== 'pages' &&
    (import.meta.env.DEV || import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC === 'true')

  useEffect(() => {
    let cancelled = false
    void workspaceRegistryPort.read()
      .then(registry => {
        if (cancelled) return
        setWorkspace(registry.pending
          ? { mode: 'error', message: '正在恢复上次账户切换，请刷新页面完成恢复。' }
          : registry.generation === 0
            ? { mode: 'legacy' }
            : registry.active.kind === 'anonymous'
              ? { mode: 'anonymous' }
              : { mode: 'account', accountId: registry.active.accountId })
      })
      .catch(error => {
        if (!cancelled) setWorkspace({
          mode: 'error', message: error instanceof Error ? error.message : String(error),
        })
      })
    return () => { cancelled = true }
  }, [])

  const checkCloud = () => {
    if (!loggedIn || !auth || expired || checking) return
    setChecking(true)
    setStatus('正在只读检查云端状态…')
    void getSyncV2Meta(auth.token)
      .then(meta => {
        setRemote(meta)
        setStatus('云端状态已更新；没有上传或覆盖学习记录。')
      })
      .catch(error => {
        setStatus('无法读取云端状态：' +
          (error instanceof Error ? error.message : String(error)) +
          '。本地学习记录不受影响。')
      })
      .finally(() => setChecking(false))
  }

  if (REACT_APP_DEPLOY_ENV === 'pages') {
    return <div role="status" className="text-sm text-gray-500">
      GitHub Pages 测试版不提供云端同步，本地备份仍可使用。
    </div>
  }

  return (
    <section className="space-y-3 text-left text-sm text-gray-600 dark:text-gray-300">
      <p>云同步仅传输当前账号的学习工作区，离线时继续保留本地进度。
        登录、注册及安全退出已统一移动到网站右上角的账户入口。</p>
      {workspace.mode === 'loading' && <p role="status">正在确认本地工作区…</p>}
      {workspace.mode === 'error' && <p role="alert">{workspace.message}</p>}
      {workspace.mode === 'legacy' && (
        <div className="space-y-2">
          <p>本浏览器仍使用旧版工作区。请先完成一次 S1 安全隔离，之后才能使用新版同步。</p>
          <button type="button" className="my-btn-primary"
            onClick={() => window.location.assign('/?s1-migration=confirm')}>
            安全升级本地工作区（需确认，不清空学习记录）
          </button>
        </div>
      )}
      {workspace.mode === 'anonymous' && (
        <p>当前为匿名本地工作区。需要云同步时，请点击右上角「登录 / 注册」。</p>
      )}
      {workspace.mode === 'account' && (
        <>
          {!loggedIn ? (
            <p role="alert">当前账户与本地 S1 工作区不匹配。同步已禁用，请使用右上角账户入口处理。</p>
          ) : (
            <>
              <p>当前工作区：<strong>{auth?.user.username ?? '未知账户'}</strong>
                {expired ? '（会话已过期，需从右上角重新登录）' : '（已登录）'}
              </p>
              {remote && <p>云端：{remote.hasData
                ? `Revision ${remote.revision} · ${remote.clientFormatVersion || '未知格式'}`
                : '尚无备份'}</p>}
              {status && <p role="status">{status}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="my-btn-primary disabled:opacity-50"
                  disabled={!enabled || expired}
                  onClick={() => window.location.assign('/?s2-sync=run')}>
                  立即同步
                </button>
                <button type="button" className="my-btn-primary disabled:opacity-50"
                  disabled={checking || expired}
                  onClick={checkCloud}>
                  {checking ? '检查中…' : '刷新云端状态（只读）'}
                </button>
                <button type="button" className="my-btn-primary disabled:opacity-50"
                  disabled={!enabled || expired}
                  onClick={() => window.location.assign('/?v4-cloud-backup=download')}>
                  下载云端完整 V4
                </button>
                <button type="button" className="text-sm underline disabled:opacity-50"
                  disabled={!enabled || expired}
                  onClick={() => window.location.assign('/?s2-recovery=manage')}>
                  高级恢复 / 版本迁移
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                本地导入 V4 后不会自动覆盖云端。若云端与本地出现分歧，
                请先保存双方备份，再通过高级恢复确认保留方向。
              </p>
            </>
          )}
        </>
      )}
      <button type="button" className="text-xs underline"
        onClick={() => window.location.assign('/?perf-report=view')}>
        查看启动 / 同步性能报告（仅本机）
      </button>
    </section>
  )
}
