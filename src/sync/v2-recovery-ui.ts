/**
 * S2-P3b explicit, non-automatic conflict recovery / V3 migration surface.
 *
 * Pre-mount only: caller holds the S1 exclusive writer lease, with React and
 * RecordDB writers NOT mounted. Normal Sync still has just ONE action.
 * Two immutable backups must be downloaded and acknowledged before either
 * side can be deliberately replaced. This surface never auto-merges.
 */
import { getSyncV2Meta, getSyncV2Snapshot, putSyncV2Recovery } from './api'
import { loadAuth } from './auth'
import { compareAndSwapSyncV2Baseline, loadSyncV2Baseline } from './v2-baseline'
import { payloadV4 } from './v2-manual-executor'
import {
  convertVerifiedCloudV3ToV4,
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
  const info = elt('p', '正常学习只需要一个 Sync 按钮。仅在同步冲突或旧 V3 云端迁移时使用本页面；不会自动合并两边的学习记录。')
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
    status.textContent = '当前云端没有可按 P3b 恢复的 V3/V4 数据。请返回普通 Sync；不做覆盖。'
    return
  }
  const raw = await getSyncV2Snapshot(signed.token)
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
  const cloudButton = button('② 下载云端原始 Backup ' +
    (pinned.clientFormatVersion === 'qwerty-backup-v3' ? 'V3' : 'V4') + '（.gz）')
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
    ['keep-cloud', pinned.clientFormatVersion === 'qwerty-backup-v3'
      ? '保留云端 V3：显式转换为 V4，再恢复到本机'
      : '保留云端 V4：覆盖本机学习记录'],
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
  const refreshEnabled = () => {
    apply.disabled = !(gotLocal && gotCloud && localAck.checked &&
      cloudAck.checked && typed.value === accountId && Boolean(select.value))
  }
  localAck.addEventListener('change', refreshEnabled)
  cloudAck.addEventListener('change', refreshEnabled)
  select.addEventListener('change', refreshEnabled)
  typed.addEventListener('input', refreshEnabled)

  localButton.addEventListener('click', () => {
    void (async () => {
      await downloadGzip(Uint8Array.from(atob((await payloadV4(local)).encoded),
        c => c.charCodeAt(0)), 'Qwerty-Plus-LOCAL-V4-' + pinned.revision + '.gz')
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
  apply.addEventListener('click', () => {
    apply.disabled = true
    void (async () => {
      if (!(gotLocal && gotCloud && localAck.checked && cloudAck.checked &&
            typed.value === accountId)) throw Error('Both backups and immutable account ID required')
      const choice = select.value as Choice
      if (choice !== 'keep-local' && choice !== 'keep-cloud') throw Error('Select a recovery direction')
      const warning = choice === 'keep-local'
        ? '最终确认：以本机数据覆盖云端 revision ' + pinned.revision +
          '。其他设备未同步的进度不会自动合并。云端旧版只能通过备份恢复。'
        : '最终确认：以云端 revision ' + pinned.revision +
          ' 覆盖本机学习记录。不会自动合并；V3 格式将先转换为 V4。'
      if (!window.confirm(warning + '\n两份 .gz 备份已检查保存，继续？')) {
        status.textContent = '用户取消；未更改数据。'
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
        await verifyIdentity()
        const uploaded = await putSyncV2Recovery(signed.token, {
          baseRevision: pinned.revision,
          payloadBase64: zip.encoded,
          logicalFingerprint: localFingerprint,
          clientFormatVersion: 'qwerty-backup-v4',
          recoveryMode: pinned.clientFormatVersion === 'qwerty-backup-v3'
            ? 'migrate-v3' : 'replace-v4',
          expectedRemoteFormat: pinned.clientFormatVersion as 'qwerty-backup-v3' | 'qwerty-backup-v4',
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
        let target: WorkspaceSnapshotV4
        let targetRevision = pinned.revision
        let targetHash: string
        if (pinned.clientFormatVersion === 'qwerty-backup-v4') {
          const { verifyDownloadedWorkspaceV4 } = await import('./v2-verify-remote')
          target = await verifyDownloadedWorkspaceV4(accountId, pinned, raw)
          targetHash = pinned.logicalFingerprint!
        } else {
          target = await convertVerifiedCloudV3ToV4(remoteBytes, accountId)
          targetHash = await workspaceFingerprintV4(target)
          const zip = await payloadV4(target)
          // V3 cloud migration is committed BEFORE the local restore journal.
          // Any failed/revoked/ambiguous HTTP response leaves the original
          // local DB untouched; the user can inspect the new remote state.
          await verifyIdentity()
          const uploaded = await putSyncV2Recovery(signed.token, {
            baseRevision: pinned.revision, payloadBase64: zip.encoded,
            clientFormatVersion: 'qwerty-backup-v4',
            logicalFingerprint: targetHash,
            recoveryMode: 'migrate-v3', expectedRemoteFormat: 'qwerty-backup-v3',
            expectedRemoteSha256: pinned.payloadSha256!,
            accountConfirmation: accountId,
            deviceId: 'qwerty-s2-explicit-legacy-migration',
          })
          if (!responseIsValid(uploaded, pinned.revision + 1, targetHash, zip.checksum)) {
            throw Error('Legacy migration committed status is not verified')
          }
          targetRevision = uploaded.revision
          const fresh = await getSyncV2Meta(signed.token)
          if (!samePinnedRemote(uploaded, fresh)) {
            throw Error('Cloud advanced during legacy migration; local data unchanged')
          }
        }
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
      status.textContent = '已停止覆盖：' +
        (error instanceof Error ? error.message : String(error)) +
        '\n若云端提交成功而本机基线未更新，请重新检查 Sync；不要重复盲目覆盖。'
      if (startedPull) {
        // A staged restore might be partial: never allow any more operation
        // in this JS realm. S1 startup must replay the durable V4 journal.
        window.location.replace('/')
      }
    })
  })
  status.textContent = '只读检查完成。下载并核对两份完整备份，再明确选择保留哪一份。'
}
