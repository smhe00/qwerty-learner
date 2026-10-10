/**
 * Formal local V4 import: pre-mount only, writer-locked, no React/DB writers.
 * The selected file is never uploaded. All destructive work happens on the
 * NEXT boot through a persistent journal before any app hydration.
 */
import { preparePortableV4Import, rebindPortableV4Import } from './manual-v4-import-plan'
import type { PortableV4ImportPlan } from './manual-v4-import-plan'
import { manualV4ImportJournalPort } from './manual-v4-import-journal'
import { captureWorkingWorkspaceV4 } from './workspace-v4-browser'
import { workspaceFingerprintV4 } from './workspace-v4'
import { workspaceRegistryPort } from './workspace-vault'
import { assertWorkspaceMigrationWitness } from './workspace-storage-witness'
import { loadAuth } from './auth'
import type { GuardedWorkspaceBoot } from './workspace-bootstrap'
import type { WorkspaceIdentityV4 } from './workspace-v4'

const MAX_GZIP_BYTES = 128 * 1024 * 1024
const MAX_JSON_BYTES = 256 * 1024 * 1024

function elt<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.textContent = text
  return node
}
function ownerText(owner: WorkspaceIdentityV4): string {
  return owner.kind === 'account' ? owner.accountId : '本机匿名工作区'
}
function confirmation(owner: WorkspaceIdentityV4): string {
  return owner.kind === 'account' ? owner.accountId : 'LOCAL-ANONYMOUS'
}
async function inflateBackupFile(file: File): Promise<string> {
  if (!file.size || file.size > MAX_GZIP_BYTES) {
    throw new Error('V4 压缩文件为空或超过 128 MiB 限制。')
  }
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      length += result.value.byteLength
      if (length > MAX_JSON_BYTES) {
        void reader.cancel('V4 文件解压后超过 256 MiB 上限')
        throw new Error('V4 文件解压后超过 256 MiB 上限。')
      }
      chunks.push(result.value)
    }
  } finally { reader.releaseLock() }
  const result = new Uint8Array(length)
  let offset = 0
  for (const item of chunks) {
    result.set(item, offset)
    offset += item.length
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(result)
}

export async function renderManualV4ImportUI(
  root: HTMLElement | null,
  boot: GuardedWorkspaceBoot,
): Promise<void> {
  if (!root || boot.mode !== 'isolated' || boot.registry.pending ||
      boot.registry.generation < 1) {
    throw new Error('完整 V4 本地导入需要先完成 S1 安全工作区初始化。')
  }
  const owner = boot.registry.active
  const verifyOwner = async () => {
    const current = await workspaceRegistryPort.read()
    if (current.pending || current.generation !== boot.registry.generation ||
        current.active.kind !== owner.kind ||
        (owner.kind === 'account' &&
          (current.active.kind !== 'account' || current.active.accountId !== owner.accountId))) {
      throw new Error('导入过程中目标工作区发生变化；操作中止。')
    }
    const auth = loadAuth({ preserveExpired: true })
    if ((owner.kind === 'account' && auth?.user.userId !== owner.accountId) ||
        (owner.kind === 'anonymous' && auth !== null)) {
      throw new Error('当前登录身份与 S1 工作区不一致，导入被拒绝。')
    }
    assertWorkspaceMigrationWitness()
  }
  await verifyOwner()
  if (await manualV4ImportJournalPort.read()) {
    throw new Error('上次 V4 导入尚未完成，须先恢复；不能开始第二次导入。')
  }

  const panel = elt('section')
  panel.style.cssText = 'max-width:740px;margin:4vh auto;padding:24px;font:15px/1.7 system-ui;color:#334155'
  const heading = elt('h1', '本地导入完整 Backup V4')
  heading.style.cssText = 'font-size:24px;font-weight:600'
  const intro = elt('p', '支持本机及云端下载的标准 V4 文件。可恢复旧账号备份到新账号，保留学习历史及设置；只替换当前本地工作区，不会找回旧账号登录权限，也不会自动覆盖云端。')
  const status = elt('p', '只读等待选择 V4 备份文件…')
  status.style.cssText = 'white-space:pre-wrap;color:#475569'
  status.setAttribute('role', 'status')
  const preview = elt('p', '当前接收账号 ID：' + ownerText(owner) + '\n尚未选择文件。')
  preview.style.cssText = 'white-space:pre-wrap;padding:12px;background:#f1f5f9;border-radius:6px'
  const actions = elt('div')
  actions.style.cssText = 'display:grid;gap:12px;margin-top:18px'
  const button = (label: string) => {
    const b = elt('button', label)
    b.type = 'button'
    b.style.cssText = 'padding:10px;border:1px solid #64748b;border-radius:5px;text-align:left'
    actions.append(b)
    return b
  }
  const chooser = elt('input')
  chooser.type = 'file'
  chooser.accept = '.gz,application/gzip'
  chooser.setAttribute('aria-label', '选择 Backup V4 gzip 文件')
  actions.append(chooser)
  const backupButton = button('① 下载当前本地完整 V4 备份（导入前保护）')
  const ackBackup = elt('input')
  ackBackup.type = 'checkbox'
  const ackBackupLabel = elt('label', ' 我已确认当前本地备份文件保存成功')
  ackBackupLabel.prepend(ackBackup)
  actions.append(ackBackupLabel)
  const ackReplace = elt('input')
  ackReplace.type = 'checkbox'
  const ackReplaceLabel = elt('label', ' 我明白：将完整替换当前账号的本地学习记录、FSRS、每日会话及个人设置；不合并')
  ackReplaceLabel.prepend(ackReplace)
  actions.append(ackReplaceLabel)
  const ackDifferent = elt('input')
  ackDifferent.type = 'checkbox'
  const ackDifferentLabel = elt('label', ' 我明确同意把来源不同 ID 的备份数据归属到当前账号（不会转移旧账号云端权限）')
  ackDifferentLabel.prepend(ackDifferent)
  actions.append(ackDifferentLabel)
  const input = elt('input')
  input.type = 'text'
  input.placeholder = '输入当前接收账号的完整不可变 ID'
  input.autocomplete = 'off'
  input.setAttribute('aria-label', '确认当前接收账号 ID')
  input.style.cssText = 'padding:10px;border:1px solid #94a3b8;border-radius:5px'
  actions.append(input)
  const execute = button('② 我确认用 V4 备份完整替换当前本地工作区')
  execute.disabled = true
  const checklist = elt('p')
  checklist.style.cssText = 'white-space:pre-wrap'
  checklist.setAttribute('role', 'status')
  actions.append(checklist)
  const cancel = button('取消，返回学习')
  cancel.addEventListener('click', () => window.location.replace('/'))
  panel.append(heading, intro, status, preview, actions)
  root.replaceChildren(panel)

  let candidateJson: string | null = null
  let plan: PortableV4ImportPlan | null = null
  let downloaded = false
  let running = false
  const refresh = () => {
    ackDifferentLabel.style.display = plan?.needsCrossOwnerConsent ? 'block' : 'none'
    const missing = []
    if (!plan || !candidateJson) missing.push('选择并验证完整 Backup V4 文件')
    if (!downloaded) missing.push('点击①下载本机备份')
    if (!ackBackup.checked) missing.push('确认旧本地备份已经保存')
    if (!ackReplace.checked) missing.push('确认完整替换本机工作区')
    if (plan?.needsCrossOwnerConsent && !ackDifferent.checked) missing.push('确认跨账号 ID 的数据归属变更')
    if (input.value !== confirmation(owner)) missing.push('准确输入接收账号 ID')
    execute.disabled = running || missing.length > 0
    checklist.textContent = running ? '正在提交安全恢复事务，请勿重复操作…' :
      missing.length ? '尚不能导入：\n' + missing.map(text => '• ' + text).join('\n') :
        '前置条件均满足。点击②仍须通过最终覆盖确认。'
  }
  for (const ctl of [ackBackup, ackReplace, ackDifferent]) ctl.addEventListener('change', refresh)
  input.addEventListener('input', refresh)
  chooser.addEventListener('change', () => {
    void (async () => {
      candidateJson = null
      plan = null
      ackDifferent.checked = false
      ackReplace.checked = false // Consent applies to this particular file, not another.
      status.textContent = '正在只读解析和校验备份文件…'
      refresh()
      const file = chooser.files?.[0]
      if (!file) return
      const json = await inflateBackupFile(file)
      const checked = await preparePortableV4Import(json, owner)
      const parsed = JSON.parse(json)
      const rows: Array<{ tableName: string; rows: unknown[] }> =
        parsed.workspaceData.database.data.data
      const counts = rows.map(entry => entry.tableName + ': ' + entry.rows.length).join('、')
      candidateJson = json
      plan = checked
      preview.textContent = '备份来源 ID：' + ownerText(checked.originalOwner) +
        '\n当前接收账号 ID：' + ownerText(owner) +
        '\n' + (checked.needsCrossOwnerConsent
          ? '⚠ 账号 ID 不同；导入后数据归属当前账号。' : '相同账号恢复。') +
        '\n六张表：' + counts +
        '\n每日学习会话：' + Object.keys(parsed.workspaceData.learnRuntime.dailySessions).length +
        '\n个人设置：' + Object.keys(parsed.workspaceData.settings.values).length +
        '\n词库：' + parsed.workspaceData.navigation.currentDict +
        '，章节：' + parsed.workspaceData.navigation.currentChapter +
        '\n业务数据 SHA-256：' + checked.contentFingerprint +
        '\n原始创建时间：' + checked.originalCreatedAt
      status.textContent = '备份文件结构与数据表校验通过；只读预览，没有改写本地数据。'
      refresh()
    })().catch(error => {
      status.textContent = 'V4 文件校验失败，未修改数据：' +
        (error instanceof Error ? error.message : String(error))
      refresh()
    })
  })
  backupButton.addEventListener('click', () => {
    void (async () => {
      status.textContent = '正在验证并下载当前本地完整 V4 备份…'
      await verifyOwner()
      const current = await captureWorkingWorkspaceV4(owner)
      const pako = await import('pako')
      const { saveAs } = await import('file-saver')
      const compressed = pako.gzip(JSON.stringify(current))
      saveAs(new Blob([compressed], { type: 'application/gzip' }),
        'Qwerty-Plus-BEFORE-IMPORT-V4-' + Date.now() + '.gz')
      downloaded = true
      ackBackup.checked = false
      status.textContent = '已触发本机原始备份下载；检查文件存在后勾选确认。'
      refresh()
    })().catch(error => {
      status.textContent = '本地保护备份失败：' +
        (error instanceof Error ? error.message : String(error))
    })
  })
  execute.addEventListener('click', () => {
    if (execute.disabled || !plan || !candidateJson || running) return
    running = true
    refresh()
    void (async () => {
      const selected = plan!
      const json = candidateJson!
      const confirmed = window.confirm(
        '最终确认：源 ID：' + ownerText(selected.originalOwner) +
        '\n目标 ID：' + ownerText(owner) +
        '\n将完整覆盖当前本地学习数据和个人设置。云端不会被上传或覆盖。\n继续？')
      if (!confirmed) {
        running = false
        status.textContent = '操作已取消，原本地数据保持不变。'
        refresh()
        return
      }
      await verifyOwner()
      const imported = await rebindPortableV4Import(json, selected, {
        replaceCurrentLocal: true,
        acceptDifferentSourceOwner: ackDifferent.checked,
        destinationConfirmation: input.value,
      })
      const original = await captureWorkingWorkspaceV4(owner)
      await verifyOwner()
      const current = await workspaceRegistryPort.read()
      await manualV4ImportJournalPort.stage({
        owner, originalOwner: selected.originalOwner,
        registryGeneration: current.generation, original,
        candidate: imported,
      })
      // No RecordDB change in this JS realm. New pre-mount guarded boot
      // replays the target and atomically drops the old cloud baseline.
      status.textContent = '安全恢复日志已提交；正在重新启动并校验恢复结果…'
      window.location.replace('/')
    })().catch(error => {
      running = false
      status.textContent = '已停止导入：' +
        (error instanceof Error ? error.message : String(error)) +
        '\n没有执行未受保护的本地覆盖。若事务已落盘，重新打开页面将自动恢复。'
      status.scrollIntoView({ block: 'center', behavior: 'smooth' })
      // A stage may have atomically committed despite ambiguous error.
      // Do NOT allow retry under a potentially stale preview/owner.
      execute.disabled = true
      chooser.disabled = true
      backupButton.disabled = true
    })
  })
  refresh()
}
