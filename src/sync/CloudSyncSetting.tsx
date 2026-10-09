import { assertLegacyAuthChangeAllowed, assertLegacyCloudMutationAllowed } from './workspace-auth-guard'
import { SyncApiError, deleteCloudAccount, getSync, getSyncMeta, putSync } from './api'
import { loadAuth, loginAndRemember, logout, registerAndRemember } from './auth'
import {
  CLIENT_FORMAT_VERSION,
  createLocalSnapshot,
  fingerprintRemoteUserActions,
  inspectLocalState,
  isSupportedSnapshotFormat,
  restoreLocalSnapshot,
} from './snapshot'
import {
  assessSyncState,
  canReconcileLegacySyncBaseline,
  clearSyncBaseline,
  loadSyncBaseline,
  saveSyncBaseline,
} from './state'
import type {
  CloudAuthState,
  LocalState,
  RemoteSyncMeta,
  SyncAssessment,
} from './types'
import { useCallback, useEffect, useState } from 'react'
import { workspaceRegistryPort } from './workspace-vault'

type SyncView = {
  local: LocalState
  remote: RemoteSyncMeta
  assessment: SyncAssessment
}

function isUnsupportedRemote(view: SyncView | null) {
  return (
    !!view?.remote.hasData &&
    !isSupportedSnapshotFormat(view.remote.clientFormatVersion)
  )
}

function isLegacyRemote(view: SyncView | null) {
  return (
    !!view?.remote.hasData &&
    view.remote.clientFormatVersion === 'qwerty-dexie-gzip-v2'
  )
}

function statusText(view: SyncView | null) {
  if (!view) return '尚未检查'
  if (isUnsupportedRemote(view)) return '云端是旧格式，需要用当前本地数据重新上传'

  switch (view.assessment.status) {
    case 'clean':
      return '本地与云端一致'
    case 'local-prepared':
      return '仅本地学习准备状态发生变化，暂无新增学习修改，无需上传'
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
    if (error.code === 'username_taken') return '用户名已存在，请直接登录。'
    if (error.code === 'invalid_credentials') return '当前账号密码不正确。'
    return error.message
  }

  return error instanceof Error ? error.message : String(error)
}

export default function CloudSyncSetting() {
  if (REACT_APP_DEPLOY_ENV === 'pages') {
    return <section role="status" className="p-4 text-sm">GitHub Pages 开发测试版仅支持本地学习和本地数据，云账号及云同步已禁用。</section>
  }
  return <EnabledCloudSyncSetting />
}

function EnabledCloudSyncSetting() {
  const [auth, setAuth] = useState<CloudAuthState | null>(() => loadAuth())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [view, setView] = useState<SyncView | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isIsolated, setIsIsolated] = useState<boolean | null>(null)

  const refresh = useCallback(async (currentAuth: CloudAuthState) => {
    const [local, remote] = await Promise.all([
      inspectLocalState(),
      getSyncMeta(currentAuth.token),
    ])
    let baseline = loadSyncBaseline(currentAuth.user.userId)

    // Older synchronized profiles have no user-action provenance. Do not
    // assume their changed physical fingerprint means the user practiced;
    // but never silently rebase either. Compare with the ACTUAL cloud payload
    // of the same revision before classifying derived-only Learn preparation.
    if (
      baseline &&
      !baseline.userActionFingerprint &&
      remote.hasData &&
      baseline.baseRevision === remote.revision &&
      local.fingerprint !== baseline.localFingerprint &&
      isSupportedSnapshotFormat(remote.clientFormatVersion)
    ) {
      try {
        const remoteSnapshot = await getSync(currentAuth.token)
        if (
          remoteSnapshot.revision === remote.revision &&
          remoteSnapshot.payloadBase64 &&
          isSupportedSnapshotFormat(remoteSnapshot.clientFormatVersion)
        ) {
          const remoteEvidence = await fingerprintRemoteUserActions(
            remoteSnapshot.payloadBase64,
            remoteSnapshot.clientFormatVersion,
          )
          if (canReconcileLegacySyncBaseline(
            local, remote, baseline, remoteEvidence,
          )) {
            baseline = saveSyncBaseline(
              currentAuth.user.userId,
              baseline.baseRevision,
              baseline.localFingerprint,
              remoteEvidence,
            )
          }
        }
      } catch {
        // Failure to compare immutable remote evidence never authorizes an
        // overwrite or resets the baseline. Preserve original dirty status.
      }
    }

    setView({
      local,
      remote,
      assessment: assessSyncState(local, remote, baseline),
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    void workspaceRegistryPort.read()
      .then(registry => { if (!cancelled) setIsIsolated(registry.generation > 0) })
      .catch(error => {
        if (!cancelled) setMessage('无法检测工作区安全状态：' +
          (error instanceof Error ? error.message : String(error)))
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (isIsolated !== false) return
    if (!auth) {
      setView(null)
      setDeletePassword('')
      return
    }

    setBusy(true)
    setMessage('')
    refresh(auth)
      .catch((error) => setMessage(errorMessage(error)))
      .finally(() => setBusy(false))
  }, [auth, refresh, isIsolated])

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
      await assertLegacyAuthChangeAllowed()
      const next = await loginAndRemember(username, password)
      setAuth(next)
      setPassword('')
      setConfirmPassword('')
      setMessage('登录成功。')
    })

  const doRegister = () =>
    run(async () => {
      await assertLegacyAuthChangeAllowed()
      if (password !== confirmPassword) {
        setMessage('两次输入的注册密码不一致。')
        return
      }

      const next = await registerAndRemember(username, password)
      setAuth(next)
      setPassword('')
      setConfirmPassword('')
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
      await assertLegacyCloudMutationAllowed()
      const local = await createLocalSnapshot()
      const remote = await getSyncMeta(auth.token)
      const baseline = loadSyncBaseline(auth.user.userId)
      const assessment = assessSyncState(local, remote, baseline)
      const remoteUnsupported =
        remote.hasData && !isSupportedSnapshotFormat(remote.clientFormatVersion)

      if (remoteUnsupported) {
        const confirmed = window.confirm(
          '当前云端数据是旧格式，本版本不再支持恢复。继续将使用当前本地数据覆盖旧云端版本。是否继续？',
        )
        if (!confirmed) return
      } else if (assessment.diverged) {
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

      saveSyncBaseline(
        auth.user.userId, uploaded.revision, local.fingerprint, local.userActionFingerprint,
      )
      await refresh(auth)
      setMessage(`已上传到云端 revision ${uploaded.revision}。`)
    })
  }

  const doDownload = () => {
    if (!auth) return

    void run(async () => {
      await assertLegacyCloudMutationAllowed()
      const local = await inspectLocalState()
      const remoteMeta = await getSyncMeta(auth.token)
      const baseline = loadSyncBaseline(auth.user.userId)
      const assessment = assessSyncState(local, remoteMeta, baseline)

      if (!remoteMeta.hasData) {
        setMessage('云端还没有可下载的数据。')
        return
      }

      if (!isSupportedSnapshotFormat(remoteMeta.clientFormatVersion)) {
        setMessage('云端数据格式不受支持。请上传当前本地数据生成新格式云端备份。')
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

      saveSyncBaseline(
        auth.user.userId, remote.revision, restored.fingerprint, restored.userActionFingerprint,
      )
      window.alert(
        restored.hasLearningState
          ? `已恢复云端 revision ${remote.revision}，页面将刷新以加载云端恢复后的学习状态。`
          : `已恢复云端 revision ${remote.revision}。旧版备份不含词库和章节位置；页面将刷新。`,
      )
      window.location.reload()
    })
  }

  const doDeleteAccount = () => {
    if (!auth || deletePassword.length < 4) return

    const confirmed = window.confirm(
      `将永久删除云端账号“${auth.user.username}”、全部云端同步数据和云端会话。此操作不可撤销，但不会删除本机学习数据。是否继续？`,
    )
    if (!confirmed) return

    void run(async () => {
      // Cloud deletion is irreversible: never issue it from isolated S1 V1 UI.
      await assertLegacyAuthChangeAllowed()
      const userId = auth.user.userId
      await deleteCloudAccount(auth.token, deletePassword)
      clearSyncBaseline(userId)
      logout()
      setAuth(null)
      setPassword('')
      setDeletePassword('')
      setView(null)
      setMessage('云端账号及其全部云端数据已删除；本机学习数据已保留。')
    })
  }

  const doLogout = () => {
    void run(async () => {
      await assertLegacyAuthChangeAllowed()
      logout()
      setAuth(null)
      setPassword('')
      setConfirmPassword('')
      setDeletePassword('')
      setMessage('')
    })
  }

  const remoteUnsupported = isUnsupportedRemote(view)
  const remoteLegacy = isLegacyRemote(view)
  const canDownload =
    !!view?.remote.hasData && isSupportedSnapshotFormat(view.remote.clientFormatVersion)

  if (isIsolated === null) {
    return <div role="status" className="text-sm text-gray-500">正在检查工作区安全状态…{message}</div>
  }
  if (isIsolated) {
    return (
      <div className="border-b border-neutral-100 pb-5 text-left dark:border-neutral-700">
        <div className="mb-2 text-base font-bold text-gray-700 dark:text-gray-200">账户工作区（S1）</div>
        <div className="text-sm text-gray-600 dark:text-gray-300">
          当前账户：{auth?.user.username ?? '匿名本机工作区'}。
          {auth && auth.expiresAt * 1000 <= Date.now()
            ? '云端会话已过期，需要重新登录当前账户；本机数据归属不会改变。'
            : auth
              ? '云端会话存在；本机工作区仍按不可变账户 ID 隔离。'
              : '目前是匿名本机工作区。'}
          学习数据独立保留在本机 V4 工作区，退出账户不会丢弃未同步进度。
          当前云同步 V1 上传、覆盖恢复和删除操作已暂停。
        </div>
        <button className="my-btn-primary mt-3" type="button"
          onClick={() => window.location.assign('/?s1-account=manage')}>
          安全登录 / 退出 / 切换账户
        </button>
      </div>
    )
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
        Learn 每日目标完成后，如果本地有新数据且云端自上次同步后没有变化，会自动安全上传；云端领先或双方都有变化时不会自动覆盖，仍需手动处理。上传数据通过 HTTPS 传输并以 gzip 压缩格式保存在云端。
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
            placeholder="密码（4-128字符）"
            type="password"
            autoComplete="current-password"
          />
          <input
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="再次输入密码（仅注册）"
            type="password"
            autoComplete="new-password"
          />
          {confirmPassword && password !== confirmPassword && (
            <p className="text-left text-xs text-red-600 dark:text-red-300">
              两次输入的注册密码不一致。
            </p>
          )}
          <div className="flex gap-2">
            <button
              className="my-btn-primary disabled:bg-gray-300"
              type="button"
              disabled={busy || !username.trim() || password.length < 4}
              onClick={doLogin}
            >
              登录
            </button>
            <button
              className="my-btn-primary disabled:bg-gray-300"
              type="button"
              disabled={
                busy ||
                !username.trim() ||
                password.length < 4 ||
                confirmPassword.length < 4 ||
                password !== confirmPassword
              }
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

          {remoteUnsupported && (
            <div className="rounded bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              当前云端数据格式不受支持。可以使用当前本地数据覆盖并生成新格式云端备份。
            </div>
          )}

          {remoteLegacy && !remoteUnsupported && (
            <div className="rounded bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              当前云端备份为旧版 v2：可恢复全部学习记录，但旧版不包含当前词库和章节位置。下次上传后会自动升级为 v3。
            </div>
          )}

          {view?.assessment.diverged && !remoteUnsupported && (
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
              disabled={
                busy ||
                !view ||
                (!view.assessment.localDirty &&
                  !view.assessment.diverged &&
                  !remoteUnsupported)
              }
              onClick={doUpload}
            >
              {remoteUnsupported
                ? '用本地数据覆盖旧版云端'
                : view?.assessment.diverged
                  ? '以本地覆盖云端'
                  : '上传本地数据'}
            </button>
            <button
              className="my-btn-primary disabled:bg-gray-300"
              type="button"
              disabled={busy || !canDownload}
              onClick={doDownload}
            >
              使用云端数据
            </button>
          </div>

          <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
            <div className="mb-1 text-xs font-bold text-red-700 dark:text-red-300">
              删除云端账号
            </div>
            <p className="mb-2 text-xs leading-relaxed text-red-600 dark:text-red-300">
              永久删除账号、全部云端同步数据和所有云端会话。不会删除本机 IndexedDB 学习数据。
            </p>
            <input
              className="mb-2 block w-full rounded border border-red-200 bg-white px-3 py-2 text-sm dark:border-red-800 dark:bg-gray-800"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              placeholder="输入当前账号密码确认删除"
              type="password"
              autoComplete="current-password"
            />
            <button
              className="rounded bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:bg-gray-300"
              type="button"
              disabled={busy || deletePassword.length < 4}
              onClick={doDeleteAccount}
            >
              永久删除云端账号
            </button>
          </div>
        </div>
      )}

      {message && <div className="mt-2 text-left text-xs text-indigo-600 dark:text-indigo-300">{message}</div>}
    </div>
  )
}
