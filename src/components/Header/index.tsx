import logo from '@/assets/logoData'
import { loadAuth } from '@/sync/auth'
import { UserCircle2 } from 'lucide-react'
import { infoPanelStateAtom } from '@/store'
import { useSetAtom } from 'jotai'
import type { PropsWithChildren } from 'react'
import type React from 'react'
import { useCallback } from 'react'

const Header: React.FC<PropsWithChildren> = ({ children }) => {
  const setInfoPanelState = useSetAtom(infoPanelStateAtom)
  const auth = loadAuth({ preserveExpired: true })
  const canUseAccount = REACT_APP_DEPLOY_ENV !== 'pages'
  const accountExpired = !!auth && auth.expiresAt * 1000 <= Date.now()

  const openAppreciation = useCallback(() => {
    setInfoPanelState((state) => ({ ...state, donate: true }))
  }, [setInfoPanelState])

  return (
    <header className="container z-20 mx-auto w-full px-4 py-3 sm:px-6 lg:px-8 lg:py-4">
      <div className="flex w-full flex-col items-center gap-y-3 lg:flex-row lg:gap-x-4">
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
              <span className="ml-1.5 font-medium" style={{ color: "var(--focus-brand-warm)" }}>Plus</span>
            </h1>
            <span className="mt-2 text-[0.65rem] font-medium tracking-[0.1em] lg:text-xs" style={{ color: "var(--focus-text-muted)" }}>
              打字 · 背单词 · 云备份
            </span>
          </div>
        </button>
        <nav className="focus-header-nav flex min-w-0 max-w-full flex-1 flex-wrap content-center items-center justify-center gap-x-2 gap-y-2 rounded-2xl px-2 py-2.5 transition-colors duration-200 lg:justify-start">
          {children}
        </nav>
        {canUseAccount && (
          <button
            type="button"
            onClick={() => window.location.assign('/?s1-account=manage')}
            className="focus-surface flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
            aria-label={auth ? '账号：' + auth.user.username : '账号：登录或注册'}
            title={auth ? (accountExpired ? '会话已过期；点击重新登录' : '账户管理与安全退出') : '登录或注册'}
            data-account-entry
          >
            <UserCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="max-w-28 truncate">
              {auth ? auth.user.username : '登录 / 注册'}
            </span>
            {accountExpired && <span className="text-xs text-amber-600 dark:text-amber-400">已过期</span>}
          </button>
        )}
      </div>
    </header>
  )
}

export default Header
