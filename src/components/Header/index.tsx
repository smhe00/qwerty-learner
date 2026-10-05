import logo from '@/assets/logoData'
import { infoPanelStateAtom } from '@/store'
import { useSetAtom } from 'jotai'
import type { PropsWithChildren } from 'react'
import type React from 'react'
import { useCallback } from 'react'

const Header: React.FC<PropsWithChildren> = ({ children }) => {
  const setInfoPanelState = useSetAtom(infoPanelStateAtom)

  const openAppreciation = useCallback(() => {
    setInfoPanelState((state) => ({ ...state, donate: true }))
  }, [setInfoPanelState])

  return (
    <header className="container z-20 mx-auto w-full px-10 py-6">
      <div className="flex w-full flex-col items-center justify-between space-y-3 lg:flex-row lg:space-y-0">
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
              <span className="ml-2 font-medium text-slate-500 dark:text-slate-300">Plus</span>
            </h1>
            <span className="mt-2 pl-1 text-[0.65rem] font-medium tracking-[0.16em] text-slate-400 dark:text-slate-500 lg:text-xs">
              打字 · 背单词
            </span>
          </div>
        </button>
        <nav className="my-card on element flex w-auto flex-wrap content-center items-center justify-end gap-3 rounded-xl bg-white p-4 transition-colors duration-300 dark:bg-gray-800">
          {children}
        </nav>
      </div>
    </header>
  )
}

export default Header
