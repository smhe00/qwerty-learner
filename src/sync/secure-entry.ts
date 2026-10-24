import { presentSafetyDialog } from './dialog-presentation'
import { secureLearningEntry } from './learning-sync-policy'

const LOCAL_ONLY = 'qwerty.http.local-only.v1'

/** Before any workspace/auth initialization. HTTP and HTTPS own DIFFERENT local data.
 * Never redirect populated storage implicitly, copy credentials or release a writer.
 * The old HTTP document remains available while the secure entry opens separately.
 */
export async function offerSecureLearningEntry(root: HTMLElement | null): Promise<void> {
  const href = secureLearningEntry(window.location.href)
  if (!href || !root) return
  const account = /\/mobile\/account\/?$/.test(window.location.pathname)
  try {
    if (!account && !window.location.search && sessionStorage.getItem(LOCAL_ONLY) === '1') return
  } catch {
    /* inaccessible storage keeps the secure-entry choice visible */
  }
  await new Promise<void>((resolve) => {
    const panel = document.createElement('section')
    panel.setAttribute('data-secure-entry', '')
    const title = document.createElement('h1')
    title.textContent = '使用安全连接，同步学习进度'
    const note = document.createElement('p')
    note.textContent = '当前网址未使用安全连接，不能登录或同步云端记录。请打开安全站点，登录后继续学习。'
    const retained = document.createElement('p')
    retained.textContent =
      '此页面原有的本机记录会保留，不会自动搬到新网址。安全站点将在新页面打开；若此处有未同步记录，请保留本页并先导出完整备份。'
    const link = document.createElement('a')
    link.href = href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = '打开安全站点'
    link.style.cssText =
      'display:block;margin-top:20px;padding:10px 16px;border-radius:9px;background:#465fb0;color:white;text-align:center;text-decoration:none'
    const local = document.createElement('button')
    local.type = 'button'
    local.textContent = '继续本机学习（不同步）'
    local.style.cssText = 'margin-top:12px;padding:8px 16px;border:1px solid #64748b'
    local.addEventListener(
      'click',
      () => {
        try {
          sessionStorage.setItem(LOCAL_ONLY, '1')
        } catch {
          /* choice applies to this document */
        }
        // Do not mount an HTTP login/tool route even after an explicit local-only choice.
        if (account || window.location.search) {
          window.location.replace(window.location.pathname.startsWith('/mobile') ? '/mobile' : '/learn')
          return
        }
        resolve()
      },
      { once: true },
    )
    panel.append(title, note, retained, link, local)
    presentSafetyDialog(root, panel)
    link.focus()
  })
}
