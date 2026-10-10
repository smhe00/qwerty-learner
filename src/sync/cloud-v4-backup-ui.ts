/**
 * Unified standard V4 cloud backup export. Read-only, independent of local
 * RecordDB and Sync baseline; exported .gz is accepted by local V4 import.
 * Historical V3 is converted *only* if its six-table payload is complete.
 */
import { getSyncV2Meta, getSyncV2Snapshot } from './api'
import { loadAuth } from './auth'
import {
  convertVerifiedCloudV3ToV4, samePinnedRemote, verifyPinnedCloudArchive,
} from './v2-recovery-archive'
import { verifyDownloadedWorkspaceV4 } from './v2-verify-remote'
import { assertRestorableWorkspaceV4 } from './workspace-v4'
import { workspaceRegistryPort } from './workspace-vault'
import type { GuardedWorkspaceBoot } from './workspace-bootstrap'

function elt<K extends keyof HTMLElementTagNameMap>(tag: K, value = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.textContent = value
  return node
}
export async function renderCloudV4BackupUI(
  root: HTMLElement | null,
  boot: GuardedWorkspaceBoot,
): Promise<void> {
  if (!root || boot.mode !== 'isolated' || boot.registry.pending ||
      boot.registry.active.kind !== 'account') {
    throw new Error('云端 V4 备份需要当前 S1 已登录账户')
  }
  const id = boot.registry.active.accountId
  const auth = loadAuth({ preserveExpired: true })
  if (!auth || auth.user.userId !== id || auth.expiresAt * 1000 <= Date.now()) {
    throw new Error('云端备份下载需要当前账号的有效登录会话；本地导入不需要旧账号密码')
  }
  const checkOwner = async () => {
    const current = await workspaceRegistryPort.read()
    const signed = loadAuth({ preserveExpired: true })
    if (current.pending || current.generation !== boot.registry.generation ||
        current.active.kind !== 'account' || current.active.accountId !== id ||
        signed?.user.userId !== id || signed.token !== auth.token ||
        signed.expiresAt * 1000 <= Date.now()) {
      throw new Error('下载期间登录会话或当前工作区已变更')
    }
  }
  const panel = elt('section')
  panel.style.cssText = 'max-width:690px;margin:6vh auto;padding:24px;font:15px/1.7 system-ui;color:#334155'
  const title = elt('h1', '导出云端完整 Backup V4')
  title.style.cssText = 'font-size:24px;font-weight:600'
  const info = elt('p', '下载的是当前登录账号的云端学习数据，不修改本机记录，也不会上传或覆盖云端。与「设置 → 本地备份 → 导入 V4」使用完全一致的文件格式。')
  const status = elt('p', '正在只读检查云端版本…')
  status.setAttribute('role', 'status')
  status.style.cssText = 'white-space:pre-wrap'
  const save = elt('button', '下载标准 V4 文件（.gz）')
  save.type = 'button'
  save.disabled = true
  save.style.cssText = 'display:block;margin:18px 0;padding:10px;border:1px solid #64748b'
  const cancel = elt('button', '返回学习')
  cancel.type = 'button'
  cancel.addEventListener('click', () => window.location.replace('/'))
  panel.append(title, info, status, save, cancel)
  root.replaceChildren(panel)
  await checkOwner()
  const pinned = await getSyncV2Meta(auth.token)
  if (!pinned.hasData) {
    status.textContent = '该账号云端没有可以下载的备份。'
    return
  }
  if (pinned.clientFormatVersion !== 'qwerty-backup-v3' &&
      pinned.clientFormatVersion !== 'qwerty-backup-v4') {
    status.textContent = '云端原始格式暂不支持安全转换；没有下载，也不会修改任何数据。'
    return
  }
  status.textContent = '云端 Revision ' + pinned.revision + '，原始格式：' +
    pinned.clientFormatVersion + '\n' +
    (pinned.clientFormatVersion === 'qwerty-backup-v3'
      ? '旧 V3 中没有保存的每日会话及设置无法凭空补齐；标准 V4 会保留原有学习记录并将缺失字段设为空。'
      : '云端原始文件是标准 V4，可直接进行完整校验后下载。')
  save.disabled = false
  let busy = false
  save.addEventListener('click', () => {
    if (busy) return
    busy = true
    save.disabled = true
    void (async () => {
      status.textContent = '正在校验云端原始压缩文件、Revision 与 SHA-256…'
      await checkOwner()
      const remote = await getSyncV2Snapshot(auth.token)
      const bytes = await verifyPinnedCloudArchive(pinned, remote)
      let standard = bytes
      if (pinned.clientFormatVersion === 'qwerty-backup-v4') {
        await verifyDownloadedWorkspaceV4(id, pinned, remote)
      } else {
        const converted = await convertVerifiedCloudV3ToV4(bytes, id)
        assertRestorableWorkspaceV4(converted)
        const pako = await import('pako')
        standard = pako.gzip(JSON.stringify(converted))
      }
      await checkOwner()
      const latest = await getSyncV2Meta(auth.token)
      if (!samePinnedRemote(pinned, latest)) {
        throw new Error('云端 Revision 在导出期间发生变化，请重新读取云端状态')
      }
      const { saveAs } = await import('file-saver')
      saveAs(new Blob([standard], { type: 'application/gzip' }),
        'Qwerty-Plus-CLOUD-Backup-V4-r' + pinned.revision + '.gz')
      status.textContent = '已触发标准 V4 文件下载；云端与本地数据均未修改。'
    })().catch(error => {
      status.textContent = '云端备份失败（没有执行云端写入）：' +
        (error instanceof Error ? error.message : String(error))
      busy = false
      save.disabled = false
    })
  })
}
