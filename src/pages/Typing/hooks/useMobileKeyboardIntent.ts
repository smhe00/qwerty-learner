import { shouldIgnoreTypingKeyEvent } from '@/utils'
import { useEffect, useRef } from 'react'

/** A trusted key outside editors is an input signal, not device enumeration. */
export function useMobileKeyboardIntent(enabled: boolean, onKey: (key: string) => boolean) {
  const handler = useRef(onKey)
  handler.current = onKey
  useEffect(() => {
    if (!enabled) return
    const keydown = (event: KeyboardEvent) => {
      if (!event.isTrusted || event.repeat || event.isComposing || event.keyCode === 229 ||
          event.altKey || event.ctrlKey || event.metaKey || shouldIgnoreTypingKeyEvent(event)) return
      if (event.key !== 'Enter' && !/^[a-z]$/i.test(event.key)) return
      if (!handler.current(event.key)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [enabled])
}
