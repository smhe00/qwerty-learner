import { useEffect } from 'react'
import type { RefObject } from 'react'

/** Keyboard UI can shrink only the visual viewport; dvh alone is insufficient. */
export function useMobileVisualViewport(enabled: boolean, ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const node = ref.current
    const viewport = window.visualViewport
    if (!enabled || !node || !viewport) return
    let frame = 0
    const clear = () => {
      delete node.dataset.mobileViewport
      delete node.dataset.mobileCompact
      node.style.removeProperty('--mobile-viewport-height')
      node.style.removeProperty('--mobile-viewport-top')
    }
    const update = () => {
      // Preserve native pinch zoom/panning instead of chasing its dimensions.
      if (Math.abs(viewport.scale - 1) > 0.02) {
        clear()
        return
      }
      const height = Math.min(window.innerHeight, viewport.height)
      if (!Number.isFinite(height) || height <= 0) return
      node.dataset.mobileViewport = 'true'
      node.dataset.mobileCompact = String(height < 560)
      node.style.setProperty('--mobile-viewport-height', height + 'px')
      node.style.setProperty('--mobile-viewport-top', Math.max(0, viewport.offsetTop) + 'px')
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('pageshow', schedule)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('pageshow', schedule)
      clear()
    }
  }, [enabled, ref])
}
