import './dialog-presentation.css'

export function applyDialogTheme(element: HTMLElement) {
  let dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  try {
    const saved = JSON.parse(localStorage.getItem('isOpenDarkModeAtom') || 'null')
    if (typeof saved === 'boolean') dark = saved
  } catch {
    /* system preference is the fallback */
  }
  element.dataset.theme = dark ? 'dark' : 'light'
}

/** Presentation only; does not import app writers or change workspace ownership. */
export function presentSafetyDialog(root: HTMLElement, panel: HTMLElement) {
  const layer = document.createElement('div')
  layer.className = 'safety-dialog-layer'
  applyDialogTheme(layer)
  panel.classList.add('safety-dialog-panel')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-label', panel.querySelector('h1,h2')?.textContent || '学习进度')
  layer.append(panel)
  root.replaceChildren(layer)
}

export function showInformationDialog(message: string) {
  const dialog = document.createElement('dialog')
  dialog.className = 'safety-dialog-panel safety-information-dialog'
  applyDialogTheme(dialog)
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-label', '提示')
  const title = document.createElement('h2')
  title.textContent = '提示'
  const text = document.createElement('p')
  text.textContent = message
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '知道了'
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  dialog.append(title, text, close)
  document.body.append(dialog)
  dialog.showModal()
}
