import { learnKeyboardIntentAtom } from '@/store/learnInputMode'
import { useSetAtom } from 'jotai'
import { useEffect } from 'react'

/** Observe actual input across layouts, menus and editors without taking its
 * ownership. Shortcut/spelling handlers retain their own focus/IME guards. */
export function useLearnKeyboardIntent() {
  const setIntent = useSetAtom(learnKeyboardIntentAtom)
  useEffect(() => {
    let observed = false
    let timer: number | undefined
    const onKey = (event: KeyboardEvent) => {
      if (!event.isTrusted || observed) return
      observed = true
      // Finish dispatching this key before enabling new shortcut listeners.
      // Otherwise a first Enter can pause AND resume in the same event.
      timer = window.setTimeout(() => setIntent((old) => old.used ? old : { ...old, used: true }), 0)
    }
    window.addEventListener('keydown', onKey, { capture: true, passive: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [setIntent])
}
