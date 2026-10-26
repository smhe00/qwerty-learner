import MobilePageFrame from './MobilePageFrame'
import './mobile-completion.css'
import { openMobileDataTool } from './mobile-data-navigation'
import { appendDeveloperTrace } from '@/dev/diagnostic-trace'
import CloudSyncSetting from '@/sync/CloudSyncSetting'
import { openAccountManagement } from '@/sync/account-navigation'
import { secureLearningEntry } from '@/sync/learning-sync-policy'
import { downloadManualBackupV4, inspectManualBackupV4File } from '@/sync/manual-backup-v4'
import { v4FailureCode } from '@/sync/v4-failure-diagnostics'
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
    try {
      setMessage(await work())
    } catch (failure) {
      setMessage('')
      appendDeveloperTrace({ scope: 'persistence', event: 'mobile-backup-failed', details: { code: v4FailureCode(failure) } })
      setError('操作未完成，请检查备份文件或稍后重试。')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const navigate = (path: string) => {
    if (!busyRef.current) openMobileDataTool(path)
  }
  return (
    <MobilePageFrame title="账号与云同步">
      <div data-mobile-data className="mobile-data-page">
        <section className="mobile-settings-card" aria-label="账号与同步管理">
          <div className="mobile-data-card-heading">
            <h2>云同步</h2>
            <button
              type="button"
              className="mobile-secondary-action"
              disabled={busy}
              onClick={() => {
                if (!busyRef.current) openAccountManagement(true)
              }}
            >
              管理账号
            </button>
          </div>
          {insecure ? (
            <p role="status">请使用安全站点登录和同步，已有本机记录会保留。</p>
          ) : (
            <CloudSyncSetting navigateToTool={navigate} disabled={busy} />
          )}
        </section>
        <section className="mobile-settings-card" aria-label="手机本地备份">
          <h2>本地备份</h2>
          <div className="mobile-data-actions">
            <button
              type="button"
              className="mobile-start-link"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await downloadManualBackupV4()
                  return '备份已导出，请到浏览器下载列表查看。'
                })
              }
            >
              导出完整备份
            </button>
            <button type="button" className="mobile-secondary-action" disabled={busy} onClick={() => fileInput.current?.click()}>
              校验备份文件
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".gz,application/gzip"
            aria-label="选择待校验的备份"
            className="sr-only"
            tabIndex={-1}
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file)
                void run(async () => {
                  await inspectManualBackupV4File(file)
                  return '校验通过，备份文件可用于恢复。'
                })
            }}
          />
          {message && (
            <p role="status" className="mobile-data-message">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="mobile-local-error">
              {error}
            </p>
          )}
          <details className="mobile-data-restore">
            <summary>从备份恢复</summary>
            <p>恢复会替换当前记录，不会合并。请先导出备份，下一步确认后才会恢复。</p>
            <button type="button" className="mobile-secondary-action" disabled={busy} onClick={() => navigate('/?v4-import=manage')}>
              进入安全导入
            </button>
          </details>
        </section>
      </div>
    </MobilePageFrame>
  )
}
