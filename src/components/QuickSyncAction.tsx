import { loadAuth } from '@/sync/auth'
import {
  QuickSyncStartError, lastQuickSyncAt, postQuickSyncNotice, quickSyncAllowed, startQuickSync,
} from '@/sync/quick-sync-entry'
import type { QuickSyncTarget } from '@/sync/quick-sync-entry'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'

export default function QuickSyncAction({
  target, variant = 'mobile', beforeSave,
}: {
  target: QuickSyncTarget
  variant?: 'menu' | 'mobile' | 'study'
  beforeSave?: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const auth = loadAuth({ preserveExpired: true })
  if (!auth || !quickSyncAllowed()) return null
  const expired = auth.expiresAt * 1000 <= Date.now()
  const last = variant === 'menu' ? lastQuickSyncAt(auth.user.userId) : null
  const description = expired ? '登录已过期，请重新登录' : '立即同步学习记录'
  const onSync = async () => {
    if (busy || expired) return
    setBusy(true)
    try {
      await startQuickSync(target, beforeSave)
      // Navigation is in progress; do not enable a second click in this realm.
    } catch (error) {
      setBusy(false)
      postQuickSyncNotice({
        kind: 'failed',
        message: error instanceof QuickSyncStartError
          ? error.message
          : '同步未启动：本机记录尚未确认保存，数据仍保留，请稍后重试。',
      })
    }
  }
  const menu = variant === 'menu'
  return (
    <button
      type="button"
      title={description}
      aria-label={description}
      data-quick-sync-entry
      disabled={busy || expired}
      onClick={(event) => {
        event.stopPropagation()
        event.currentTarget.blur()
        void onSync()
      }}
      className={menu
        ? 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800'
        : 'inline-flex h-11 min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-transparent px-2 text-sm transition-colors hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800'}
      style={menu ? { color: 'var(--focus-text)' } : { color: 'var(--focus-text-secondary)' }}
    >
      <RefreshCw size={menu ? 19 : 20} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
      {menu && (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{busy ? '正在保存…' : expired ? '重新登录后同步' : '立即同步'}</span>
          <span className="mt-0.5 text-[11px]" style={{ color: 'var(--focus-text-muted)' }}>
            {last ? '上次成功：' + new Date(last).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '安全合并本机与云端进度'}
          </span>
        </span>
      )}
      {!menu && variant === 'mobile' && <span className="text-xs">同步</span>}
    </button>
  )
}
