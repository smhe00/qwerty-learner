import { loadAuth } from '@/sync/auth'
import { QUICK_SYNC_NOTICE_EVENT, takeQuickSyncNotice } from '@/sync/quick-sync-entry'
import type { QuickSyncFeedback } from '@/sync/quick-sync-entry'
import { CheckCircle2, CloudOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function QuickSyncNotice() {
  const [note, setNote] = useState<QuickSyncFeedback | null>(null)
  useEffect(() => {
    const read = (event?: Event) => {
      const direct = event instanceof CustomEvent ? event.detail as QuickSyncFeedback : null
      const next = direct || takeQuickSyncNotice(loadAuth({ preserveExpired: true })?.user.userId || null)
      if (next) setNote(next)
    }
    window.addEventListener(QUICK_SYNC_NOTICE_EVENT, read)
    read()
    // Do not clear the return marker here. QuickSyncNotice is mounted
    // outside Suspense and may run before the lazy Learn page reads it.
    // The Learn route clears the one-shot marker after consuming it.
    return () => window.removeEventListener(QUICK_SYNC_NOTICE_EVENT, read)
  }, [])
  useEffect(() => {
    if (!note) return
    const timeout = window.setTimeout(() => setNote(null), note.kind === 'ok' ? 4800 : 8500)
    return () => window.clearTimeout(timeout)
  }, [note])
  if (!note) return null
  return (
    <div
      className="fixed inset-x-4 bottom-5 z-[70] mx-auto flex w-fit max-w-[min(420px,calc(100vw-32px))] items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-lg"
      style={{ color: 'var(--focus-text)', background: 'var(--focus-surface)', borderColor: 'var(--focus-border)' }}
      role={note.kind === 'ok' ? 'status' : 'alert'}
      aria-live={note.kind === 'ok' ? 'polite' : 'assertive'}
      data-quick-sync-result={note.kind}
    >
      {note.kind === 'ok' ? <CheckCircle2 size={20} aria-hidden="true" /> : <CloudOff size={20} aria-hidden="true" />}
      <span className="leading-6">{note.message}</span>
      <button type="button" className="ml-1 rounded-md p-0.5 opacity-60 hover:opacity-100" onClick={() => setNote(null)} aria-label="关闭同步提示">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
