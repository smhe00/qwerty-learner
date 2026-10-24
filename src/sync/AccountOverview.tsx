import { closeAccountDialog, isAccountDialogOpen, subscribeAccountDialog } from './account-dialog-events'
import { loadAuth } from './auth'
import { Dialog } from '@headlessui/react'
import { useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'

/** Read-only inspection keeps the mounted app and its writer lease intact. */
export default function AccountOverview() {
  const { pathname } = useLocation()
  const open = useSyncExternalStore(subscribeAccountDialog, isAccountDialogOpen)
  const auth = open ? loadAuth({ preserveExpired: true }) : null
  const expired = !!auth && auth.expiresAt * 1000 <= Date.now()
  const manage = () => {
    const base = REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner/' : '/'
    const mobile = pathname.startsWith('/mobile')
    window.location.assign(base + (mobile ? 'mobile/account?' : '?s1-account=manage&') + 's1-reauth=1')
  }
  return (
    <Dialog open={open} onClose={() => closeAccountDialog()} className="fixed inset-0 z-50">
      <div className="fixed inset-0 backdrop-blur-sm" style={{ background: 'var(--focus-backdrop)' }} aria-hidden="true" />
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            closeAccountDialog()
          }
        }}
        onKeyUp={(event) => event.stopPropagation()}
      >
        <Dialog.Panel className="focus-overlay-panel w-full max-w-md rounded-2xl p-6" data-account-overview>
          <div className="mb-5 flex items-center justify-between">
            <Dialog.Title className="text-xl font-semibold">我的账号</Dialog.Title>
            <button type="button" aria-label="关闭账号窗口" onClick={() => closeAccountDialog()} className="rounded-lg px-3 py-2">
              关闭
            </button>
          </div>
          <p className="text-lg">{auth?.user.username ?? '尚未登录'}</p>
          <p className="my-3 text-sm opacity-75">
            {auth ? (expired ? '登录已过期，本机学习记录仍保留。' : '正在使用这个账号的学习空间。') : '登录后可在不同设备间同步学习记录。'}
          </p>
          <p className="mb-5 text-sm opacity-75">
            {auth ? '查看账号或关闭窗口不会退出，也不会重新加载学习页面。' : '本机已有的学习记录会保留。'}
          </p>
          <button type="button" className="rounded-lg bg-indigo-600 px-4 py-2 text-white" onClick={manage}>
            {auth ? '登录与账号管理' : '登录或注册'}
          </button>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
