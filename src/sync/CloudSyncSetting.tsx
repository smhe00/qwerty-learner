import { SyncApiError, getSync, getSyncMeta, putSync } from './api'
import { loadAuth, loginAndRemember, logout, registerAndRemember } from './auth'
import { CLIENT_FORMAT_VERSION, createLocalSnapshot, restoreLocalSnapshot } from './snapshot'
import { assessSyncState, loadSyncBaseline, saveSyncBaseline } from './state'
import type {
  CloudAuthState,
  LocalSnapshot,
  RemoteSyncMeta,
  SyncAssessment,
} from './types'
import { useCallback, useEffect, useState } from 'react'

type SyncView = {
  local: LocalSnapshot
  remote: RemoteSyncMeta
  assessment: SyncAssessment
}

function statusText(view: SyncView | null) {
  if (!view) return '尚未检查'

  switch (view.assessment.status) {
    case 'clean':
      return '本地与云端一致'
    case 'local-dirty':
      return '本地有未上传修改'
    case 'remote-ahead':
      return '云端有较新数据'
    case 'diverged':
      return '本地与云端均有变化，需要手动选择'
  }
}

function errorMessage(error: unknown) {
  if (error instanceof SyncApiError) {
    if (error.code === 'sync_conflict') return '云端数据刚刚发生变化，请刷新状态后重试。'
    if (error.code === 'session_revoked') return '当前登录已被其他登录替代，请重新登录。'
    return error.message
  }

  return error instanceof Error ? error.message : String(error)
}

export default function CloudSyncSetting() {
  const [auth, setAuth] = useState<CloudAuthState | null>(() => loadAuth())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [view, setView] = useState<SyncView | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async (currentAuth: CloudAuthState) => {
    const [local, remote] = await Promise.all([
      createLocalSnapshot(),
      getSyncMeta(currentAuth.token),
    ])
    const baseline = loadSyncBaseline(currentAuth.user.userId)

    setView({
      local,
      remote,
      assessment: assessSyncState(local, remote, baseline),
    })
  }, [])

  useEffect(() => {
    if (!auth) {
      setView(null)
      return
    }

    setBusy(true)
    setMessage('')
    refresh(auth)
      .catch((error) => setMessage(errorMessage(error)))
      .finally(() => setBusy(false))
  }, [auth, refresh])

  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true)
    setMessage('')

    try {
      await operation()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const doLogin = () =>
    run(async () => {
      const next = await loginAndRemember(username, password)
      setAuth(next)
      setPassword('')
      setMessage('登录成功。')
    })

  const doRegister = () =>
    run(async () => {
      const next = await registerAndRemember(username, password)
      setAuth(next)
      setPassword('')
      setMessage('账号已创建并登录。')
    })

  const doRefresh = () => {
    if (!auth) return
    void run(async () => {
      await refresh(auth)
      setMessage('同步状态已刷新。')
    })
  }

  const doUpload = () => {
    if (!auth) return

    void run(async () => {
      const local = await createLocalSnapshot()
      const remote = await getSyncMeta(auth.token)
      const baseline = loadSyncBaseline(auth.user.userId)
      const assessment = assessSyncState(local, remote, baseline)

      if (assessment.diverged) {
        const confirmed = window.confirm(
          '本地和云端都在上次同步后发生了变化。继续将以当前本地数据覆盖云端最新版本。建议先使用“导出数据”保存本地备份。是否继续？',
        )
        if (!confirmed) return
      }

      const uploaded = await putSync(auth.token, {
        baseRevision: remote.revision,
        payloadBase64: local.payloadBase64,
        deviceId: 'qwerty-web-manual',
        clientFormatVersion: CLIENT_FORMAT_VERSION,
      })

      saveSyncBaseline(auth.user.userId, uploaded.revision, local.fingerprint)
      await refresh(auth)
      setMessage(`已上传到云端 revision ${uploaded.revision}。`)
    })
  }

  const doDownload = () => {
    if (!auth) return

    void run(async () => {
      const local = await createLocalSnapshot()
      const remoteMeta = await getSyncMeta(auth.token)
      const baseline = loadSyncBaseline(auth.user.userId)
      const assessment = assessSyncState(local, remoteMeta, baseline)

      if (!remoteMeta.hasData) {
        setMessage('云端还没有可下载的数据。')
        return
      }

      if (assessment.localDirty) {
        const confirmed = window.confirm(
          '下载云端数据会完全覆盖当前本地练习数据。建议先使用“导出数据”保存本地备份。是否继续？',
        )
        if (!confirmed) return
      }

      const remote = await getSync(auth.token)
      if (!remote.payloadBase64) throw new Error('云端快照为空，无法恢复。')

      const restored = await restoreLocalSnapshot(
        remote.payloadBase64,
        remote.clientFormatVersion,
      )

      saveSyncBaseline(auth.user.userId, remote.revision, restored.fingerprint)
      await refresh(auth)
      setMessage(`已恢复云端 revision ${remote.revision}。`)
    })
  }

  const doLogout = () => {
    logout()
    setAuth(null)
    setPassword('')
    setMessage('')
  }

  return (
    <div className="border-b border-neutral-100 pb-5 dark:border-neutral-700">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-base font-bold text-gray-700 dark:text-gray-200">云端同步</span>
        {auth && (
          <button
            className="text-xs text-gray-500 underline disabled:text-gray-300"
            type="button"
            disabled={busy}
            onClick={doLogout}
          >
            退出登录
          </button>
        )}
      </div>

      <p className="mb-3 text-left text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        云端同步是可选功能。学习数据仍以本机 IndexedDB 为工作副本，不登录或网络不可用时不会影响练习。
        当前版本仅提供手动上传/下载，不会自动合并冲突。
      </p>

      {!auth ? (
        <div className="space-y-2">
          <input
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="用户名"
            autoComplete="username"
          />
          <input
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="密码（8-128字符）"
            type="password"
            autoComplete="current-password"
          />
          <div className="flex gap-2">
            <button
              className="my-btn-primary disabled:bg-gray-300"
              type="button"
              disabled={busy || !username.trim() || password.length < 8}
              onClick={doLogin}
            >
              登录
            </button>
            <button
              className="my-btn-primary disabled:bg-gray-300"
              type="button"
              disabled={busy || !username.trim() || password.length < 8}
              onClick={doRegister}
            >
              注册
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-left text-sm text-gray-600 dark:text-gray-300">
          <div>
            账号：<strong>{auth.user.username}</strong>
          </div>
          <div>
            状态：<strong>{statusText(view)}</strong>
          </div>
          <div>
            云端 revision：<strong>{view?.remote.revision ?? '-'}</strong>
            {view?.remote.updatedAt ? (
              <span className="ml-2 text-xs text-gray-400">
                {new Date(view.remote.updatedAt).toLocaleString()}
              </span>
            ) : null}
          </div>

          {view?.assessment.diverged && (
            <div className="rounded bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              检测到分叉：本地与云端都发生了变化。系统不会自动合并；请明确选择上传本地版本或下载云端版本。
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              className="my-btn-primary disabled:bg-gray-300"
              type="button"
              disabled={busy}
              onClick={doRefresh}
            >
              刷新状态
            </button>
            <button
              className="my-btn-primary disabled:bg-gray-300"
              type="button"
              disabled={busy || !view || (!view.assessment.localDirty && !view.assessment.diverged)}
              onClick={doUpload}
            >
              {view?.assessment.diverged ? '以本地覆盖云端' : '上传本地数据'}
            </button>
            <button
              className="my-btn-primary disabled:bg-gray-300"
              type="button"
              disabled={busy || !view?.remote.hasData}
              onClick={doDownload}
            >
              使用云端数据
            </button>
          </div>
        </div>
      )}

      {message && <div className="mt-2 text-left text-xs text-indigo-600 dark:text-indigo-300">{message}</div>}
    </div>
  )
}
