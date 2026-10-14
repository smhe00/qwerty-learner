/**
 * S2-P3b explicit, non-automatic V4 conflict recovery surface.
 *
 * Pre-mount only: caller holds the S1 exclusive writer lease, with React and
 * RecordDB writers NOT mounted. Normal Sync still has just ONE action.
 * Two immutable backups must be downloaded and acknowledged before either
 * side can be deliberately replaced. This surface never auto-merges.
 */
import { SyncApiError, getSyncV2Meta, getSyncV2Snapshot,
  getSyncV2SnapshotBinary, putSyncV2BinaryRecovery } from './api'
import { loadAuth } from './auth'
import { compareAndSwapSyncV2Baseline, loadSyncV2Baseline } from './v2-baseline'
import { payloadV4 } from './v2-manual-executor'
import {
  samePinnedRemote,
  verifyPinnedCloudArchive,
} from './v2-recovery-archive'
import { syncV2PullJournalPort } from './v2-pull-journal'
import { assertWorkspaceMigrationWitness } from './workspace-storage-witness'
import { captureWorkingWorkspaceV4 } from './workspace-v4-browser'
import { assertRestorableWorkspaceV4, workspaceFingerprintV4 } from './workspace-v4'
import { saveWorkspaceToVault, workspaceRegistryPort } from './workspace-vault'
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import type { GuardedWorkspaceBoot } from './workspace-bootstrap'
import type { RemoteSyncMeta } from './types'
import { flushReviewRecordWrites } from '@/store/reviewInfoAtom'

type Choice = 'keep-local' | 'keep-cloud'
const HASH = /^[a-f0-9]{64}$/

function elt<K extends keyof HTMLElementTagNameMap>(
  name: K, content = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(name)
  if (content) element.textContent = content
  return element
}

function responseIsValid(
  meta: RemoteSyncMeta,
  expectedRevision: number,
  fingerprint: string,
  compressedSha: string,
): boolean {
  return meta.hasData && meta.revision === expectedRevision &&
    meta.clientFormatVersion === 'qwerty-backup-v4' &&
    meta.logicalFingerprint === fingerprint &&
    meta.payloadSha256 === compressedSha
}

async function downloadGzip(bytes: Uint8Array, filename: string): Promise<void> {
  const { saveAs } = await import('file-saver')
  saveAs(new Blob([bytes], { type: 'application/gzip' }), filename)
}

/** The route is DEV/pilot-flag only; never run from a mounted React dialog. */
export async function renderS2RecoveryUI(
  root: HTMLElement | null,
  boot: GuardedWorkspaceBoot,
): Promise<void> {
  if (!root || boot.mode !== 'isolated' || boot.registry.pending ||
      boot.registry.active.kind !== 'account' || boot.registry.generation < 1) {
    throw new Error('S2 recovery requires an isolated authenticated account')
  }
  const accountId = boot.registry.active.accountId
  const signed = loadAuth({ preserveExpired: true })
  if (!signed || signed.user.userId !== accountId ||
      signed.expiresAt * 1000 <= Date.now()) {
    throw new Error('Recovery requires reauthentication as the active account')
  }
  const verifyIdentity = async () => {
    const now = await workspaceRegistryPort.read()
    const currentAuth = loadAuth({ preserveExpired: true })
    if (now.pending || now.generation !== boot.registry.generation ||
        now.active.kind !== 'account' || now.active.accountId !== accountId ||
        !currentAuth || currentAuth.user.userId !== accountId ||
        currentAuth.token !== signed.token ||
        currentAuth.expiresAt * 1000 <= Date.now()) {
      throw new Error('Account, session or S1 writer generation changed')
    }
    assertWorkspaceMigrationWitness()
  }

  const frame = elt('section')
  frame.style.cssText = 'max-width:660px;margin:5vh auto;padding:24px;font:15px/1.7 system-ui,sans-serif;color:#334155'
  const heading = elt('h1', '云同步高级恢复（S2）')
  heading.style.cssText = 'font-size:24px;font-weight:600;margin-bottom:8px'
  const info = elt('p', '正常学习只需要一个同步按钮。只有 V4 双端冲突需要本页面；不会自动合并两边的学习记录。')
  const status = elt('p', '正在检查账号、云端 revision 和完整快照…')
  status.setAttribute('role', 'status')
  status.style.cssText = 'margin:12px 0;white-space:pre-wrap'
  const details = elt('div')
  details.style.cssText = 'white-space:pre-wrap;background:#f1f5f9;border-radius:8px;padding:12px'
  const actions = elt('div')
  actions.style.cssText = 'display:grid;gap:10px;margin-top:14px'
  const button = (title: string) => {
    const result = elt('button', title)
    result.type = 'button'
    result.style.cssText = 'padding:9px;border:1px solid #64748b;border-radius:6px;text-align:left'
    actions.append(result)
    return result
  }
  const back = button('取消并返回学习')
  back.addEventListener('click', () => window.location.replace('/'))
  frame.append(heading, info, status, details, actions)
  root.replaceChildren(frame)

  await verifyIdentity()
  if (await syncV2PullJournalPort.read()) throw new Error('Pending Pull requires recovery first')
  await flushReviewRecordWrites()
  const local = await captureWorkingWorkspaceV4({ kind: 'account', accountId })
  assertRestorableWorkspaceV4(local)
  const localFingerprint = await workspaceFingerprintV4(local)
  const oldBaseline = await loadSyncV2Baseline(accountId)
  const pinned = await getSyncV2Meta(signed.token)
  if (!pinned.hasData ||
      (pinned.clientFormatVersion !== 'qwerty-backup-v3' &&
       pinned.clientFormatVersion !== 'qwerty-backup-v4')) {
    status.textContent = '当前云端没有支持的 V4 数据。旧格式已退役；请返回普通同步，不执行覆盖。'
    return
  }
  const raw = pinned.storageEncoding === 'binary'
    ? await getSyncV2SnapshotBinary(signed.token)
    : await getSyncV2Snapshot(signed.token)
  const remoteBytes = await verifyPinnedCloudArchive(pinned, raw)
  const confirmedMeta = await getSyncV2Meta(signed.token)
  if (!samePinnedRemote(pinned, confirmedMeta)) {
    throw new Error('Cloud revision changed during recovery inspection; refresh and export again')
  }
  details.textContent =
    '账户：' + signed.user.username + '\n不可变账户 ID：' + accountId +
    '\n本地 V4 SHA：' + localFingerprint +
    '\n云端格式：' + pinned.clientFormatVersion +
    '\n云端 revision：' + pinned.revision +
    '\n云端原始 SHA：' + pinned.payloadSha256 +
    '\n本地与云端均不会在选择前被覆盖。'

  let gotLocal = false
  let gotCloud = false
  const localButton = button('① 下载本地完整 Backup V4（.gz）')
  const cloudButton = button('② 下载云端原始 Backup V4（.gz）')
  const localAck = elt('input')
  localAck.type = 'checkbox'
  const cloudAck = elt('input')
  cloudAck.type = 'checkbox'
  const localLabel = elt('label', ' 已确认本地备份保存成功')
  localLabel.prepend(localAck)
  const cloudLabel = elt('label', ' 已确认云端原始备份保存成功')
  cloudLabel.prepend(cloudAck)
  actions.append(localLabel, cloudLabel)
  const choiceText = elt('p', '③ 确定保留哪一份学习记录（未选择时禁止操作）')
  actions.append(choiceText)
  const select = elt('select')
  select.style.cssText = 'padding:9px;border:1px solid #94a3b8'
  for (const [value, label] of [
    ['', '请选择恢复方向'],
    ['keep-local', '保留本地 V4：覆盖云端当前 revision'],
    ['keep-cloud', '保留云端 V4：覆盖本机学习记录'],
  ]) {
    const option = elt('option', label)
    option.value = value
    select.append(option)
  }
  actions.append(select)
  const typed = elt('input')
  typed.type = 'text'
  typed.placeholder = '④ 输入完整的不可变账户 ID，确认归属'
  typed.setAttribute('aria-label', '确认不可变账户 ID')
  typed.autocomplete = 'off'
  typed.style.cssText = 'padding:9px;border:1px solid #94a3b8'
  actions.append(typed)
  const apply = button('⑤ 我已备份两端数据，继续执行选定方向')
  apply.disabled = true
  // After a write has been attempted, the pinned remote revision might be
  // stale even when the browser received a network error. Never enable a
  // second submit in this document; reopen to pin the current remote meta.
  let attemptStarted = false
  let attemptFailed = false
  const checklist = elt('p')
  checklist.setAttribute('role', 'status')
  checklist.style.cssText = 'margin:5px 0 0;white-space:pre-wrap;color:#334155;line-height:1.7'
  actions.append(checklist)
  const refreshEnabled = () => {
    const missing: string[] = []
    if (!gotLocal) missing.push('点击①从本页面下载本地 V4')
    if (!gotCloud) missing.push('点击②从本页面下载云端原始备份')
    if (!localAck.checked) missing.push('确认本地备份文件已保存')
    if (!cloudAck.checked) missing.push('确认云端备份文件已保存')
    if (!select.value) missing.push('选择保留哪份学习记录')
    if (typed.value !== accountId) missing.push('输入完全一致的不可变账号 ID')
    apply.disabled = missing.length !== 0 || attemptStarted || attemptFailed
    if (attemptFailed) {
      checklist.textContent = '操作已停止；必须重新读取云端最新 revision 后才能再尝试，以免重复提交。'
    } else if (attemptStarted) {
      checklist.textContent = '正在执行；请等待结果，不要重复提交或打开另一标签页。'
    } else if (missing.length === 0) {
      checklist.textContent = '所有 V4 恢复前置条件已满足。⑤ 已解锁；点击后仍会再次显示最终覆盖确认。'
    } else {
      checklist.textContent = '⑤ 仍不可执行，请先完成：\n' +
        missing.map(item => '• ' + item).join('\n')
    }
  }
  localAck.addEventListener('change', refreshEnabled)
  cloudAck.addEventListener('change', refreshEnabled)
  select.addEventListener('change', refreshEnabled)
  typed.addEventListener('input', refreshEnabled)
  const recheck = button('重新读取云端状态（只读，不执行覆盖）')
  recheck.addEventListener('click', () => window.location.reload())
  refreshEnabled()

  localButton.addEventListener('click', () => {
    void (async () => {
      await downloadGzip((await payloadV4(local)).bytes,
        'Qwerty-Plus-LOCAL-V4-' + pinned.revision + '.gz')
      gotLocal = true
      localAck.checked = false
      status.textContent = '已触发本地备份下载；检查文件保存后勾选确认。'
      refreshEnabled()
    })().catch(error => { status.textContent = String(error) })
  })
  cloudButton.addEventListener('click', () => {
    void downloadGzip(remoteBytes,
      'Qwerty-Plus-CLOUD-' + pinned.clientFormatVersion + '-r' + pinned.revision + '.gz')
      .then(() => {
        gotCloud = true
        cloudAck.checked = false
        status.textContent = '已触发云端原始备份下载；检查文件保存后勾选确认。'
        refreshEnabled()
      }).catch(error => { status.textContent = String(error) })
  })

  let startedPull = false
  // A failed/ambiguous PUT must be reconciled READ-ONLY against this
  // exact submitted V4 identity; never retry or mutate the sync baseline.
  let submittedPayload: { fingerprint: string; sha256: string } | null = null
  apply.addEventListener('click', () => {
    if (attemptStarted || attemptFailed || apply.disabled) return
    attemptStarted = true
    refreshEnabled()
    void (async () => {
      if (!(gotLocal && gotCloud && localAck.checked && cloudAck.checked &&
            typed.value === accountId)) throw Error('Both backups and immutable account ID required')
      const choice = select.value as Choice
      if (choice !== 'keep-local' && choice !== 'keep-cloud') throw Error('Select a recovery direction')
      const warning = choice === 'keep-local'
        ? '最终确认：以本机数据覆盖云端 revision ' + pinned.revision +
          '。其他设备未同步的进度不会自动合并。云端旧版只能通过备份恢复。'
        : '最终确认：以云端 revision ' + pinned.revision +
          ' 覆盖本机学习记录。不会自动合并；恢复之前请确认两端 V4 备份均已妥善保存。'
      if (!window.confirm(warning + '\n两份 .gz 备份已检查保存，继续？')) {
        status.textContent = '用户取消；未更改数据。'
        attemptStarted = false
        refreshEnabled()
        return
      }
      status.textContent = '正在复核不可变身份、云端 revision、本地快照和两份备份…'
      await verifyIdentity()
      const live = await captureWorkingWorkspaceV4({ kind: 'account', accountId })
      if (await workspaceFingerprintV4(live) !== localFingerprint) {
        throw Error('Local workspace changed after backup; restart recovery')
      }
      const latestMeta = await getSyncV2Meta(signed.token)
      if (!samePinnedRemote(pinned, latestMeta)) {
        throw Error('Cloud revision changed after backup; restart recovery')
      }

      if (choice === 'keep-local') {
        const zip = await payloadV4(local)
        submittedPayload = { fingerprint: localFingerprint, sha256: zip.checksum }
        await verifyIdentity()
        const uploaded = await putSyncV2BinaryRecovery(signed.token, {
          baseRevision: pinned.revision,
          payloadBytes: zip.bytes,
          logicalFingerprint: localFingerprint,
          clientFormatVersion: 'qwerty-backup-v4',
          recoveryMode: 'replace-v4',
          expectedRemoteFormat: 'qwerty-backup-v4',
          expectedRemoteSha256: pinned.payloadSha256!,
          expectedRemoteLogicalFingerprint: pinned.logicalFingerprint,
          accountConfirmation: accountId,
          deviceId: 'qwerty-s2-explicit-recovery',
        })
        if (!responseIsValid(uploaded, pinned.revision + 1, localFingerprint, zip.checksum)) {
          throw Error('Recovery server response is not a verified V4 revision')
        }
        await verifyIdentity()
        await compareAndSwapSyncV2Baseline(accountId, oldBaseline, {
          accountId, baseRevision: uploaded.revision, logicalFingerprint: localFingerprint,
        })
        sessionStorage.setItem('qwerty.s2.last-sync-result',
          '已按确认保留本机学习记录，云端现为 V4 revision ' + uploaded.revision + '。')
      } else {
        const { verifyDownloadedWorkspaceV4 } = await import('./v2-verify-remote')
        const target: WorkspaceSnapshotV4 = await verifyDownloadedWorkspaceV4(accountId, pinned, raw)
        const targetRevision = pinned.revision
        const targetHash = pinned.logicalFingerprint!
        if (oldBaseline && targetRevision <= oldBaseline.baseRevision) {
          throw Error('Cannot restore a non-advancing remote baseline; export and inspect manually')
        }
        await verifyIdentity()
        // The local source is backed up into the S1 vault BEFORE staging.
        // Only after stage can a full RecordDB restore begin.
        await saveWorkspaceToVault({ kind: 'account', accountId }, local)
        await verifyIdentity()
        // DO NOT restore under the already-installed S1 localStorage
        // guard in this JS realm. Stage only. The NEXT guarded boot (fresh
        // realm, same S1 Web Lock contract) replays the target before React
        // hydration and only then reports completion.
        startedPull = true
        await syncV2PullJournalPort.stage({
          version: 1, accountId, registryGeneration: boot.registry.generation,
          revision: targetRevision, fingerprint: targetHash,
          oldBaseline, snapshot: target,
        })
      }
      status.textContent = '恢复日志已提交；正在重新启动并执行安全恢复…'
      window.location.replace('/')
    })().catch(error => {
      attemptStarted = false
      attemptFailed = true
      const authDenied = error instanceof SyncApiError &&
        error.status === 403 && error.code === 's2_write_not_enabled'
      const hint = authDenied
        ? '服务端仍返回旧版账号白名单拒绝：生产环境可能尚未部署全账号 V4 版本。'
        : '提交结果可能不确定；本页会立即只读核验远端当前版本。' +
          '任何情况下均禁止在旧 Revision 上自动重试覆盖。'
      const errorMessage = error instanceof Error ? error.message : String(error)
      status.textContent = '已停止覆盖：' + errorMessage + '\n' + hint +
        '\n正在只读查询云端格式、Revision、SHA；原本的本地数据没有因本页报错被主动清空。'
      status.style.cssText += ';color:#b91c1c;font-weight:600'
      refreshEnabled()
      status.scrollIntoView({ block: 'center', behavior: 'smooth' })
      // This secondary GET cannot authorize a new write and never modifies
      // the local baseline. An ambiguous 500 might already have committed.
      void getSyncV2Meta(signed.token).then(fresh => {
        const summary = '\n只读核对：格式 ' + String(fresh.clientFormatVersion) +
          '，Revision ' + String(fresh.revision) +
          '，原始 SHA-256 ' + String(fresh.payloadSha256)
        let conclusion = '\n云端与之前的固定版本不同，请保存此结果并停止操作。'
        if (samePinnedRemote(pinned, fresh)) {
          conclusion = '\n与提交前版本完全一致：尚未观察到新版本提交；本页禁止重试。'
        } else if (submittedPayload &&
          responseIsValid(fresh, pinned.revision + 1,
            submittedPayload.fingerprint, submittedPayload.sha256)) {
          conclusion = '\n已验证云端创建了匹配本次请求的 V4 新版本，' +
            '但本地同步基线尚未确认提交；不要重复恢复。'
        }
        status.textContent = '已停止覆盖：' + errorMessage +
          '\n' + hint + summary + conclusion +
          '\n本地数据没有因本页报错被主动清空。'
      }).catch(readError => {
        status.textContent = '已停止覆盖：' + errorMessage +
          '\n只读核对云端也失败：' +
          (readError instanceof Error ? readError.message : String(readError)) +
          '\n结果仍不确定，必须在网络恢复后重新打开本页进行只读核对；' +
          '禁止重复覆盖。本地数据没有因本页报错被主动清空。'
      })
      if (startedPull) {
        // A staged restore might be partial: never allow any more operation
        // in this JS realm. S1 startup must replay the durable V4 journal.
        window.location.replace('/')
      }
    })
  })
  status.textContent = '只读检查完成。下载并核对两份完整备份，再明确选择保留哪一份。'
}
