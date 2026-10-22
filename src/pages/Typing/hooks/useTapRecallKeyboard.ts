import { shouldIgnoreTypingKeyEvent } from '@/utils'
import type { RefObject } from 'react'
import { useEffect } from 'react'

/** Dispatch through the currently rendered mouse action, never a second grader. */
export function useTapRecallKeyboard(root: RefObject<HTMLElement>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
          event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const key = event.key === ' ' ? 'space' : event.key.toLowerCase()
      if (!['a', 's', 'd', 'f', '1', '2', '3', '4', 'space', 'r', 'x', 'w'].includes(key)) return
      const surface = root.current
      if (!surface || document.querySelector('[role="dialog"], [role="listbox"], [role="menu"], [id^="headlessui-popover-panel-"]')) return
      if (shouldIgnoreTypingKeyEvent(event)) {
        // Letters may operate the current card after a mouse click or Tab.
        // Space on a focused button keeps native keyboard activation.
        const button = event.target instanceof Element ? event.target.closest('button') : null
        if (!button || !surface.contains(button) || key === 'space') return
      }
      const action = surface.querySelector<HTMLButtonElement>('button[data-desktop-shortcut~="' + key + '"]')
      if (!action) {
        // Space is never a hidden positive rating; do not scroll the card.
        if (key === 'space') event.preventDefault()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat || action.disabled || !action.getClientRects().length) return
      action.click()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, root])
}
