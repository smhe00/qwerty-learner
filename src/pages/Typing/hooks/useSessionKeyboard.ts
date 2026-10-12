import { shouldIgnoreTypingKeyEvent } from '@/utils'
import { useEffect } from 'react'

export function useSessionKeyboard({ active, disabled, onToggle }: { active: boolean; disabled: boolean; onToggle: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled || event.isComposing || event.key === 'Process') return
      // Keep browser shortcuts, modifier keys and Tab focus navigation available.
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        ['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Unidentified'].includes(event.key)
      )
        return
      if (document.querySelector('[role="dialog"], [role="listbox"], [id^="headlessui-popover-panel-"]')) return
      const exerciseInput =
        event.target instanceof Element &&
        (event.target.hasAttribute('data-typing-input-control') || event.target.closest('[data-session-control]') !== null)
      const headerControl = event.target instanceof Element
        ? event.target.closest<HTMLElement>('header button, header a')
        : null
      // After choosing a mode, a practice character starts the session. Native
      // Enter/Space activation and navigation still belong to header controls.
      const headerPracticeKey = !active && headerControl && event.key.length === 1 && event.key !== ' '
      if (!exerciseInput && !headerPracticeKey && shouldIgnoreTypingKeyEvent(event)) return
      if (event.defaultPrevented || (active && event.key !== 'Enter')) return
      if (event.repeat) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      // Capture before spelling, hints, surrender and native button handlers.
      // A start/resume key is consumed and never becomes the first answer key.
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!active) headerControl?.blur()
      onToggle()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active, disabled, onToggle])
}
