import { Dialog } from '@headlessui/react'
import type React from 'react'
import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import IconX from '~icons/tabler/x'

export type NavigationOverlayState = {
  backgroundLocation?: {
    pathname: string
    search?: string
    hash?: string
  }
}

export const AUXILIARY_PATHS = new Set([
  '/gallery', '/analysis', '/achievements', '/error-book', '/friend-links',
])

export function getAuxiliaryBackground(
  pathname: string,
  search: string,
  state: unknown,
) {
  if (!AUXILIARY_PATHS.has(pathname)) return undefined
  const stored = (state as NavigationOverlayState | null)?.backgroundLocation
  const isMain = stored?.pathname === '/typing' || stored?.pathname === '/learn'
  if (isMain) return {
    pathname: stored.pathname,
    search: stored.search ?? '',
    hash: stored.hash ?? '',
    state: null,
    key: 'underlying-main-route',
  }
  // Direct deep links remain dialogs. The background must be an actual
  // working Learn/Typing route rather than an empty or stale screen.
  const isLearn = search.includes('mode=learn') ||
    search.includes('from=learn') ||
    pathname === '/achievements'
  return {
    pathname: isLearn ? '/learn' : '/typing',
    search: '',
    hash: '',
    state: null,
    key: 'direct-auxiliary-background',
  }
}

type NavigationOverlayProps = {
  title: string
  size: 'md' | 'lg' | 'xl'
  children: React.ReactNode
}

const sizes = {
  // Window dimensions follow the information load rather than the viewport.
  md: 'h-auto max-h-[78vh] max-w-2xl',
  lg: 'h-[min(80vh,800px)] max-w-5xl',
  xl: 'h-[min(88vh,920px)] max-w-7xl',
}

export default function NavigationOverlay({ title, size, children }: NavigationOverlayProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const isAchievementCollection = location.pathname === '/achievements'
  const saved = (location.state as NavigationOverlayState | null)?.backgroundLocation
  const background = getAuxiliaryBackground(location.pathname, location.search, location.state)

  const close = useCallback(() => {
    if (saved && (saved.pathname === '/learn' || saved.pathname === '/typing')) {
      navigate(-1)
    } else {
      navigate(background?.pathname ?? '/learn', { replace: true })
    }
  }, [background?.pathname, navigate, saved])

  return (
    <Dialog as="div" className="relative z-40" open onClose={close}>
      <div className="fixed inset-0 backdrop-blur-[3px]" style={{ background: "var(--focus-backdrop)" }} aria-hidden="true" />
      <div
        className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto p-3 sm:p-5"
        onKeyDown={(event) => {
          // ESC means "don't know" on Learn. Never let dialog keystrokes
          // reach the still-mounted typing/learning keyboard handlers.
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
        onKeyUp={(event) => event.stopPropagation()}
      >
        <Dialog.Panel
          className={`focus-overlay-panel flex min-h-0 w-full ${isAchievementCollection ? '!max-w-[900px] !h-[min(94vh,1010px)] !rounded-[25px]' : sizes[size]} flex-col overflow-hidden rounded-[20px]`}
          data-navigation-dialog={location.pathname.slice(1)}
        >
          {isAchievementCollection ? <Dialog.Title className="sr-only">{title}</Dialog.Title> : (
            <div className="focus-overlay-header flex shrink-0 items-center justify-between px-5 py-3.5">
              <Dialog.Title className="text-lg font-semibold tracking-tight">{title}</Dialog.Title>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 dark:text-slate-300 dark:hover:bg-slate-700"
                onClick={close}
                aria-label="返回"
                title="关闭窗口并返回原页面"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>
          )}
          <div className={`focus-overlay-body min-h-0 flex-1 overflow-auto ${isAchievementCollection ? "!p-0" : "p-3 sm:p-5"}`} data-navigation-dialog-body>
            {children}
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
