import logo from '@/assets/logoData'
import { loadAuth } from '@/sync/auth'
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
    <header className="container z-20 mx-auto w-full px-10 py-6">
      <div className="flex w-full flex-col items-center justify-between gap-y-3 lg:flex-row lg:gap-x-4">
        <button
          className="flex items-center no-underline hover:no-underline"
          type="button"
          onClick={openAppreciation}
          aria-label="打开赞赏页面"
          title="赞赏本站维护者"
        >
          <img src={logo} className="mr-3 h-14 w-14 lg:h-16 lg:w-16" alt="Qwerty Plus Logo" />
          <div className="flex flex-col items-start leading-none">
            <h1 className="whitespace-nowrap text-2xl font-bold tracking-tight lg:text-4xl">
              <span className="text-slate-800 dark:text-slate-100">Qwerty</span>
              <span className="ml-2 font-medium text-[#F0A11C] dark:text-[#FFC85D]">Plus</span>
            </h1>
            <span className="mt-2 pl-1 text-[0.65rem] font-medium tracking-[0.16em] text-slate-400 dark:text-slate-500 lg:text-xs">
              打字 · 背单词 · 云备份
            </span>
          </div>
        </button>
        <nav className="my-card on element flex max-w-full flex-1 flex-wrap content-center items-center justify-end gap-x-3 gap-y-2 rounded-xl bg-white p-4 transition-colors duration-300 dark:bg-gray-800">
          {children}
        </nav>
        {canUseAccount && (
          <button
            type="button"
            onClick={() => window.location.assign('/?s1-account=manage')}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-indigo-400 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            aria-label={auth ? '账号：' + auth.user.username : '账号：登录或注册'}
            title={auth ? (accountExpired ? '会话已过期；点击重新登录' : '账户管理与安全退出') : '登录或注册'}
            data-account-entry
          >
            <span aria-hidden="true" className="text-lg">♙</span>
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
