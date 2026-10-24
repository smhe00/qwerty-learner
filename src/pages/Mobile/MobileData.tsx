import MobilePageFrame from './MobilePageFrame'
import './mobile-completion.css'
import { openMobileDataTool } from './mobile-data-navigation'
import CloudSyncSetting from '@/sync/CloudSyncSetting'
import { openAccountDialog } from '@/sync/account-dialog-events'
import { secureLearningEntry } from '@/sync/learning-sync-policy'
import { downloadManualBackupV4, inspectManualBackupV4File } from '@/sync/manual-backup-v4'
import { useRef, useState } from 'react'

/** Presentation only. Backups and cloud writes use the existing audited adapters. */
export default function MobileData() {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const insecure = Boolean(secureLearningEntry(window.location.href))
  const run = async (work: () => Promise<string>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setMessage('正在处理本地备份…')
    try { setMessage(await work()) }
    catch (failure) {
      setMessage('')
      setError('操作未完成：' + (failure instanceof Error ? failure.message : '请重试') + '。未执行备份导入或清空操作。')
    } finally { busyRef.current = false; setBusy(false) }
  }
  const navigate = (path: string) => { if (!busyRef.current) openMobileDataTool(path) }
  return (
    <MobilePageFrame title="账号与云同步">
      <div data-mobile-data className="mobile-data-page">
        <section className="mobile-settings-card" aria-label="账号与同步管理">
          <div className="mobile-data-card-heading"><h2>账号与同步</h2><button type="button" className="mobile-secondary-action" disabled={busy} onClick={() => openAccountDialog()}>管理账号</button></div>
          {insecure ? <p role="status">当前为 HTTP 本地模式，不能发送账号凭据或同步数据。请通过账号入口前往 HTTPS 安全站点，勿清空旧页面数据。</p> : (
            <CloudSyncSetting navigateToTool={navigate} disabled={busy} />
          )}
        </section>
        <section className="mobile-settings-card" aria-label="手机本地备份">
          <h2>本地备份</h2>
          <p>备份包含当前工作区的学习记录、记忆进度、成就和设置。导出与校验不会替换学习数据。</p>
          <div className="mobile-data-actions">
            <button type="button" className="mobile-start-link" disabled={busy} onClick={() => void run(async () => {
              const info = await downloadManualBackupV4()
              return `备份已导出：${info.tableCount} 张表、${info.dailySessions} 个学习会话、${info.settingCount} 项设置。请在浏览器下载列表中保存文件。`
            })}>导出完整备份</button>
            <button type="button" className="mobile-secondary-action" disabled={busy} onClick={() => fileInput.current?.click()}>校验备份文件</button>
          </div>
          <input ref={fileInput} type="file" accept=".gz,application/gzip" aria-label="选择待校验的备份" className="sr-only" tabIndex={-1} disabled={busy} onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void run(async () => {
              const info = await inspectManualBackupV4File(file)
              return `校验通过：${info.tableCount} 张表、${info.dailySessions} 个学习会话、${info.settingCount} 项设置。本地数据未改变。`
            })
          }} />
          {message && <p role="status" className="mobile-data-message">{message}</p>}
          {error && <p role="alert" className="mobile-local-error">{error}</p>}
          <details className="mobile-data-restore">
            <summary>从备份恢复</summary>
            <p>导入会替换当前工作区，不是合并。请先导出当前记录；下一页需校验文件并明确确认。不会因点击此入口而修改任何数据。</p>
            <button type="button" className="mobile-secondary-action" disabled={busy} onClick={() => navigate('/?v4-import=manage')}>进入安全导入</button>
          </details>
        </section>
        <p className="mobile-page-description">正常学习由系统自动同步；手动检查和备份用于核对与恢复。离线或出现异常时，请保留本机数据。安全工具在独立页面完成操作，结束后返回首页。</p>
      </div>
    </MobilePageFrame>
  )
}
