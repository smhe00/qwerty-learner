/**
 * Pre-mount Learn Block continuation.  This is deliberately DOM-only: the
 * React app / RecordDB MUST NOT mount until guarded S2 Sync has finished and
 * the old document has been destroyed.
 */
import { clearLearnBlockSyncHandoff, readLearnBlockSyncPending } from './learn-block-sync'
import type { LearnBlockSyncHandoff, LearnBlockSyncOutcome } from './learn-block-sync'

type BlockSyncScreen = {
  setStatus: (message: string) => void
  settle: (result: LearnBlockSyncOutcome) => void
}

export function renderLearnBlockSyncScreen(
  root: HTMLElement | null,
  context: LearnBlockSyncHandoff | null,
): BlockSyncScreen {
  if (!root) throw new Error('Cannot render Learn Block Sync without the application root')
  root.replaceChildren()

  const page = document.createElement('main')
  page.setAttribute('data-learn-block-sync', '')
  page.style.cssText = 'box-sizing:border-box;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:30px;background:#f1f5f9;color:#334155;font-family:system-ui,sans-serif'
  const card = document.createElement('section')
  card.style.cssText = 'box-sizing:border-box;max-width:660px;width:100%;padding:36px 40px;background:white;border-radius:22px;box-shadow:0 12px 28px #0001;text-align:center'
  const caption = document.createElement('p')
  caption.textContent = 'Qwerty Plus · Learn'
  caption.style.cssText = 'font-size:14px;color:#64748b'
  const title = document.createElement('h1')
  title.textContent = context?.dailyComplete ? '今日学习完成' : 'Block 阶段完成'
  title.style.cssText = 'font-size:26px;font-weight:650;margin:16px 0 10px'
  const detail = document.createElement('p')
  detail.textContent = context?.milestone !== null &&
    context?.milestone !== undefined
    ? `今日已完成 ${context.milestone} 个目标词` : '当前阶段学习记录已保存在本机'
  detail.style.cssText = 'font-size:14px;color:#64748b;margin-bottom:14px'
  const status = document.createElement('p')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.textContent = '正在同步学习进度…'
  status.style.cssText = 'font-size:15px;margin:22px 0;color:#4f46e5'
  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:24px'
  card.append(caption, title, detail, status, actions)
  page.append(card)
  root.append(page)

  const button = (label: string, href: string, primary: boolean) => {
    const control = document.createElement('button')
    control.type = 'button'
    control.textContent = label
    control.style.cssText = 'border:1px solid #6366f1;border-radius:9px;padding:12px 20px;cursor:pointer;' +
      (primary ? 'background:#4f46e5;color:white' : 'color:#4f46e5;background:white')
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
      status.style.color = result.kind === 'ok' ? '#166534' : '#b45309'
      if (result.kind === 'ok') {
        button('继续学习', '/learn?block-resume=1', true)
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
