import { cleanIdleAccounts, getAdministratorAccess, getCloudStorageUsage, getIdleAccountPolicy, inspectIdleAccounts } from './api'
import type { IdleCleanupPage } from './api'
import { useEffect, useState } from 'react'

const labels: Record<string, string> = {
  protected: '管理员保护', retain: '保留', circle_hold: '圈子数据待清理，暂不删除',
  candidate: '已满180天，待清理', draining: '等待已有请求结束', deleting: '正在分批删除',
  cancelled: '用户已返回，取消清理', deleted: '已删除云端账号与数据',
  identity_changed: '身份已变化，跳过', error: '检查或清理失败，需重试',
}

export default function AdministratorPanel({ token }: { token?: string }) {
  const [admin, setAdmin] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [page, setPage] = useState<IdleCleanupPage | null>(null)
  const [cursor, setCursor] = useState('')
  const [status, setStatus] = useState('')
  const [usage, setUsage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    void getIdleAccountPolicy().then(policy => {
      if (!cancelled) setEnabled(policy.enabled)
    }).catch(() => { /* Unavailable policy/access must not grant admin privileges. */ })
    if (token) void getAdministratorAccess(token).then(access => {
      if (!cancelled) setAdmin(access.administrator)
    }).catch(() => { /* Unavailable policy/access must not grant admin privileges. */ })
    return () => { cancelled = true }
  }, [token])

  const preview = async (next = '') => {
    if (!token || busy) return
    setBusy(true)
    setStatus('正在预览；不会删除任何数据。')
    try {
      const result = await inspectIdleAccounts(token, next)
      setPage(result)
      setCursor(next)
      setStatus('预览完成。只有到期账号会进入清理流程。')
      const stats = await getCloudStorageUsage(token)
      setUsage(`${stats.accounts} 个云端账号，${stats.objects} 个存储对象。` +
        (stats.sizeComplete ? `占用约 ${(stats.reportedBytes / 1048576).toFixed(2)} MiB。` : '平台未提供完整大小，准确容量请查看腾讯云控制台。'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '预览失败，请重试。')
    } finally { setBusy(false) }
  }
  const execute = async () => {
    if (!token || !page || !page.executionEnabled || busy ||
        !window.confirm('确认对本页到期账号运行清理？账号及云端学习数据会被永久删除，本地记录保留。')) return
    setBusy(true)
    try {
      setPage(await cleanIdleAccounts(token, cursor))
      setStatus('本轮已完成；等待中的账号会在后续任务中处理。失败项不代表已删除。')
    } catch (error) { setStatus(error instanceof Error ? error.message : '清理失败，请重试。') }
    finally { setBusy(false) }
  }
  return <section className="mt-4 space-y-2 text-sm" aria-label="云端账号保留与管理">
    <p className="opacity-75">{enabled
      ? '云端账号连续180天未登录或有效访问云端，将连同云端学习数据清理。本机学习记录保留。'
      : '180天闲置账号清理尚未启用。'}
    </p>
    {enabled && <p className="text-xs opacity-75">当前仅提供站内规则提示；离线用户不会收到邮件或短信提醒。</p>}
    {admin && <>
      <h3 className="font-semibold">管理员 · 云端数据清理</h3>
      <p>管理员账号不参与闲置自动清理。预览和执行均由服务端重新验证权限及到期状态。</p>
      {usage && <p>{usage}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="my-btn-primary" disabled={busy} onClick={() => void preview()}>预览清理名单</button>
        {page && page.nextCursor !== null && <button type="button" disabled={busy} onClick={() => void preview(page.nextCursor || '')}>预览下一页</button>}
        {page && <button type="button" className="my-btn-primary" disabled={busy || !page.executionEnabled}
          onClick={() => void execute()}>对本页运行清理</button>}
      </div>
      {page && !page.executionEnabled && <p>正式删除开关未开启，当前仅可预览。</p>}
      {page?.results.map((row, index) => <p key={row.userId || index}>
        {row.username || '检查失败'}：{labels[row.action] || row.action}
        {row.expiresAt ? `；到期 ${new Date(row.expiresAt).toLocaleDateString()}` : ''}
      </p>)}
      {status && <p role="status">{status}</p>}
    </>}
  </section>
}
