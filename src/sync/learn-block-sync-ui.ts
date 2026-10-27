/**
 * Pre-mount Learn Block continuation.  This is deliberately DOM-only: the
 * React app / RecordDB MUST NOT mount until guarded S2 Sync has finished and
 * the old document has been destroyed.
 */
import '../index.css'
import { presentSafetyDialog } from './dialog-presentation'
import { clearLearnBlockSyncHandoff, readLearnBlockSyncPending } from './learn-block-sync'
import type { LearnBlockSyncHandoff, LearnBlockSyncOutcome } from './learn-block-sync'
import './learn-block-sync-ui.css'

type BlockSyncScreen = {
  setStatus: (message: string) => void
  settle: (result: LearnBlockSyncOutcome) => void
}

export function renderLearnBlockSyncScreen(root: HTMLElement | null, context: LearnBlockSyncHandoff | null): BlockSyncScreen {
  if (!root) throw new Error('Cannot render Learn Block Sync without the application root')
  root.replaceChildren()

  const summary = context?.summary
  const card = document.createElement('section')
  card.style.cssText = 'text-align:center'
  const caption = document.createElement('p')
  caption.textContent = (summary?.dictionary ?? 'Qwerty Plus') + ' · Learn'
  caption.style.cssText = 'font-size:14px;color:var(--dialog-muted)'
  const title = document.createElement('h1')
  title.textContent =
    summary?.title ?? (context?.dailyComplete ? '今日学习完成' : context?.roundEnded ? '本轮练习已结束' : 'Block 阶段完成')
  title.style.cssText = 'font-size:26px;font-weight:650;margin:16px 0 10px'
  const detail = document.createElement('p')
  detail.textContent =
    summary?.description ??
    (context?.milestone !== null && context?.milestone !== undefined
      ? `今日已完成 ${context.milestone} 个目标词`
      : context?.roundEnded
      ? '本轮记录已保存在本机，需巩固的词仍然保留'
      : '当前阶段学习记录已保存在本机')
  detail.style.cssText = 'font-size:14px;color:var(--dialog-muted);margin-bottom:14px'
  const status = document.createElement('p')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.textContent = '正在同步学习进度…'
  status.style.cssText = 'font-size:15px;margin:22px 0;color:var(--dialog-accent)'
  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:24px'
  card.append(caption, title, detail)
  if (summary) {
    card.classList.add('learn-completion-sync')
    card.setAttribute('data-learn-result-screen', '')
    const progress = document.createElement('div')
    progress.className = 'focus-result-progress'
    progress.setAttribute('role', 'progressbar')
    progress.setAttribute('aria-label', summary.progressLabel)
    progress.setAttribute('aria-valuemin', '0')
    progress.setAttribute('aria-valuemax', '100')
    progress.setAttribute('aria-valuenow', String(summary.percent))
    const fill = document.createElement('div')
    fill.className = 'focus-result-progress-fill'
    fill.style.width = summary.percent + '%'
    progress.append(fill)
    const metrics = document.createElement('div')
    metrics.className = 'focus-result-metrics'
    metrics.setAttribute('data-focus-result-metrics', '')
    summary.metrics.forEach((metric, index) => {
      const cell = document.createElement('div')
      cell.className = 'focus-result-metric'
      if (index === 0) cell.dataset.emphasis = 'primary'
      for (const field of ['label', 'value', 'detail'] as const) {
        const item = document.createElement('div')
        item.className = 'focus-result-metric-' + field
        item.textContent = metric[field]
        cell.append(item)
      }
      metrics.append(cell)
    })
    card.append(progress, metrics)
  }
  card.append(status, actions)
  presentSafetyDialog(root, card)
  card.setAttribute('data-learn-block-sync', '')

  const button = (label: string, href: string, primary: boolean) => {
    const control = document.createElement('button')
    control.type = 'button'
    control.textContent = label
    control.style.cssText =
      'border:1px solid #6366f1;border-radius:9px;padding:12px 20px;cursor:pointer;' +
      (primary ? 'background:#4f46e5;color:white' : 'color:var(--dialog-accent);background:var(--dialog-surface)')
    control.addEventListener('click', () => {
      clearLearnBlockSyncHandoff()
      window.location.replace(href)
    })
    actions.append(control)
  }

  return {
    setStatus(message: string) {
      status.textContent = message
    },
    settle(result) {
      actions.replaceChildren()
      status.textContent = result.message
      status.style.color = result.kind === 'ok' ? 'var(--dialog-success)' : 'var(--dialog-warning)'
      if (result.kind === 'ok') {
        if (context?.dailyComplete || context?.roundEnded) button('再学五词', '/learn?block-extra=1', true)
        else button('继续学习', '/learn?block-resume=1', true)
        button('结束并退出', '/learn?block-idle=1', false)
      } else {
        const retry = document.createElement('button')
        retry.type = 'button'
        retry.textContent = '重试同步'
        retry.style.cssText = 'border-radius:9px;padding:12px 20px;background:#4f46e5;color:white;cursor:pointer'
        retry.addEventListener('click', () => {
          // The S1 boot gate will recheck identity, writer lease, journal and CAS.
          const accountId = context?.accountId
          if (!accountId || !readLearnBlockSyncPending(accountId)) {
            status.textContent = '同步上下文已失效，请返回学习后重新进入 Block。'
            retry.disabled = true
            return
          }
          window.location.replace('/?s2-sync=run&learn-block=1')
        })
        actions.append(retry)
        button('保留本地进度，暂不同步', '/learn?block-idle=1', false)
      }
    },
  }
}
