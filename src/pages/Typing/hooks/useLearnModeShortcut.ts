import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

/** A lone Shift release activates the visible mode button. Chords, IME and
 * controls in dialogs retain ownership; never consume a spelling character. */
export function useLearnModeShortcut(button: RefObject<HTMLButtonElement>, enabled = true) {
  useLayoutEffect(() => {
    if (!enabled) return
    let armed: string | null = null
    let composing = false
    const reset = () => { armed = null }
    const blocked = (event: KeyboardEvent) => {
      const editor = event.target instanceof Element ? event.target.closest('input, textarea, [contenteditable="true"]') : null
      return composing || event.isComposing || event.ctrlKey || event.altKey || event.metaKey ||
        !!document.querySelector('[role="dialog"], [role="listbox"], [role="menu"], [id^="headlessui-popover-panel-"]') ||
        !!(editor && !editor.closest('[data-mobile-spelling-form]'))
    }
    const down = (event: KeyboardEvent) => {
      if (!event.isTrusted) return
      armed = event.key === 'Shift' && !event.repeat && !blocked(event) && armed === null ? event.code : null
    }
    const up = (event: KeyboardEvent) => {
      if (!event.isTrusted) return
      const activate = event.key === 'Shift' && armed === event.code && !blocked(event)
      reset()
      const target = button.current
      if (!activate || !target || target.disabled || !target.getClientRects().length) return
      event.preventDefault()
      event.stopPropagation()
      target.click()
    }
    const startComposition = () => { composing = true; reset() }
    const endComposition = () => { composing = false; reset() }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', reset)
    window.addEventListener('pointerdown', reset, true)
    window.addEventListener('compositionstart', startComposition, true)
    window.addEventListener('compositionend', endComposition, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', reset)
      window.removeEventListener('pointerdown', reset, true)
      window.removeEventListener('compositionstart', startComposition, true)
      window.removeEventListener('compositionend', endComposition, true)
    }
  }, [button, enabled])
}
