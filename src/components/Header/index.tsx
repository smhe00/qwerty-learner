import logo from '@/assets/logoData'
import QuickSyncAction from '@/components/QuickSyncAction'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import { infoPanelStateAtom } from '@/store'
import { openAccountDialog } from '@/sync/account-dialog-events'
import { loadAuth } from '@/sync/auth'
import { useSetAtom } from 'jotai'
import { ChevronDown, Settings2, UserCircle2 } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import type React from 'react'
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'

const Header: React.FC<PropsWithChildren> = ({ children }) => {
  const layoutRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const [toolbarLayout, setToolbarLayout] = useState<'single' | 'stacked' | 'below'>('below')
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const opening = useRef<number | null>(null)
  const closing = useRef<number | null>(null)
  const clearMenuTimers = useCallback(() => {
    if (opening.current !== null) window.clearTimeout(opening.current)
    if (closing.current !== null) window.clearTimeout(closing.current)
    opening.current = null
    closing.current = null
  }, [])
  useEffect(() => () => clearMenuTimers(), [clearMenuTimers])
  useEffect(() => {
    if (!accountMenuOpen) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountMenuRef.current?.contains(event.target)) {
        clearMenuTimers()
        setAccountMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [accountMenuOpen, clearMenuTimers])
  const hoverAccount = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    clearMenuTimers()
    opening.current = window.setTimeout(() => setAccountMenuOpen(true), 170)
  }
  const leaveAccount = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    clearMenuTimers()
    closing.current = window.setTimeout(() => setAccountMenuOpen(false), 200)
  }

  useLayoutEffect(() => {
    const header = layoutRef.current
    const nav = navRef.current
    if (!header || !nav) return
    const rows = Array.from(nav.children) as HTMLElement[]
    if (!rows.length) return
    const siblings = Array.from(header.children).filter((child) => child !== nav) as HTMLElement[]
    const measure = () => {
      const style = getComputedStyle(nav)
      const inset =
        parseFloat(style.paddingLeft) +
        parseFloat(style.paddingRight) +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.borderRightWidth)
      const widths = rows.map((row) => row.getBoundingClientRect().width)
      const gap = parseFloat(getComputedStyle(header).columnGap)
      const available =
        header.clientWidth - siblings.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0) - siblings.length * gap
      // Measure the intrinsic groups, not the flex box left over after wrapping.
      // A compact two-row menu stays beside the brand until it truly cannot fit.
      const singleWidth = widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * parseFloat(style.columnGap) + inset
      const stackedWidth = Math.max(...widths) + inset
      setToolbarLayout(available >= singleWidth ? 'single' : available >= stackedWidth ? 'stacked' : 'below')
    }
    const observer = new ResizeObserver(measure)
    ;[header, ...rows, ...siblings].forEach((element) => observer.observe(element))
    measure()
    return () => observer.disconnect()
  }, [])

  const typing = useContext(TypingContext)
  const inspectAccount = (event: React.MouseEvent) => {
    // Do not let the opening click become an outside-click on the new dialog.
    event.stopPropagation()
    typing?.dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: false })
    openAccountDialog()
  }
  const setInfoPanelState = useSetAtom(infoPanelStateAtom)
  const auth = loadAuth({ preserveExpired: true })
  const canUseAccount = REACT_APP_DEPLOY_ENV !== 'pages'
  const accountExpired = !!auth && auth.expiresAt * 1000 <= Date.now()

  const openAppreciation = useCallback(() => {
    setInfoPanelState((state) => ({ ...state, donate: true }))
  }, [setInfoPanelState])

  return (
    <header className="z-20 mx-auto w-full max-w-screen-2xl px-4 py-3 sm:px-6 lg:px-8 lg:py-4">
      <div
        ref={layoutRef}
        data-toolbar-layout={toolbarLayout}
        data-has-account={canUseAccount}
        className="focus-header-layout w-full items-center gap-x-3 gap-y-3 xl:gap-x-12"
      >
        <button
          className="flex shrink-0 items-center rounded-xl no-underline hover:no-underline"
          type="button"
          onClick={openAppreciation}
          aria-label="打开赞赏页面"
          title="赞赏本站维护者"
        >
          <img src={logo} className="mr-3 h-12 w-12 lg:h-14 lg:w-14" alt="Qwerty Plus Logo" />
          <div className="flex flex-col items-start leading-none">
            <h1 className="whitespace-nowrap text-2xl font-semibold tracking-tight lg:text-3xl">
              <span className="text-slate-800 dark:text-slate-100">Qwerty</span>
              <span className="ml-1.5 font-medium" style={{ color: 'var(--focus-brand-warm)' }}>
                Plus
              </span>
            </h1>
            <span className="mt-2 text-[0.65rem] font-medium tracking-[0.1em] lg:text-xs" style={{ color: 'var(--focus-text-muted)' }}>
              练打字 · 记单词 · 云同步
            </span>
          </div>
        </button>
        <nav
          ref={navRef}
          data-toolbar-layout={toolbarLayout}
          className="focus-header-nav mx-auto grid w-max max-w-full shrink-0 content-center items-center justify-items-center gap-x-2 gap-y-2 rounded-2xl px-2 py-2.5 transition-colors duration-200"
        >
          {children}
        </nav>
        {canUseAccount && (auth ? (
          <div
            ref={accountMenuRef}
            data-account-dropdown
            className="relative z-30 shrink-0 justify-self-end"
            onPointerEnter={hoverAccount}
            onPointerLeave={leaveAccount}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                clearMenuTimers()
                setAccountMenuOpen(false)
              }
            }}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                event.currentTarget.blur()
                clearMenuTimers()
                setAccountMenuOpen((value) => !value)
              }}
              className="focus-surface flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors hover:text-indigo-600"
              aria-label={'账号：' + auth.user.username + '，展开操作菜单'}
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              aria-controls="focus-account-menu"
              title={accountExpired ? '会话已过期，展开账号操作' : '展开账号操作'}
              data-account-entry
            >
              <UserCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="max-w-28 truncate">{auth.user.username}</span>
              {accountExpired && <span className="text-xs text-amber-600 dark:text-amber-400">已过期</span>}
              <ChevronDown className={'h-4 w-4 shrink-0 opacity-60 transition-transform ' + (accountMenuOpen ? 'rotate-180' : '')} aria-hidden="true" />
            </button>
            {accountMenuOpen && (
              <div
                id="focus-account-menu"
                role="menu"
                aria-label="账号操作"
                data-account-menu
                className="absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border p-1.5 shadow-xl"
                style={{ background: 'var(--focus-surface)', borderColor: 'var(--focus-border)', boxShadow: 'var(--focus-shadow-overlay)' }}
              >
                <div role="none">
                  <QuickSyncAction target={window.location.pathname === '/typing' ? '/typing' : '/learn'} variant="menu"
                    beforeSave={() => typing?.dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: false })} />
                </div>
                <div className="my-1 border-t" style={{ borderColor: 'var(--focus-border)' }} />
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={(event) => {
                    clearMenuTimers()
                    setAccountMenuOpen(false)
                    event.currentTarget.blur()
                    inspectAccount(event)
                  }}
                >
                  <Settings2 className="h-[19px] w-[19px]" aria-hidden="true" />
                  <span>账号管理</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={inspectAccount}
            className="focus-surface flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors hover:text-indigo-600"
            aria-label="账号：登录或注册"
            title="登录后可以同步各设备学习记录"
            data-account-entry
          >
            <UserCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="max-w-28 truncate">登录 / 注册</span>
          </button>
        ))}
      </div>
    </header>
  )
}

export default Header
