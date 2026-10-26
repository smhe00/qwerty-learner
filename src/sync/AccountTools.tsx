import AdministratorPanel from './AdministratorPanel'
import { closeAccountDialog, isAccountDialogOpen, subscribeAccountDialog } from './account-dialog-events'
import { loadAuth } from './auth'
import { useAdministratorAccess } from './use-administrator-access'
import { Dialog } from '@headlessui/react'
import { useEffect, useSyncExternalStore } from 'react'

/** Read-only inspection keeps the mounted app and its writer lease intact. */
export default function AccountTools() {
  const open = useSyncExternalStore(subscribeAccountDialog, isAccountDialogOpen)
  return open ? <AuthorizedAccountTools /> : null
}

/** Each opening verifies access afresh before mounting any visible dialog. */
function AuthorizedAccountTools() {
  const auth = loadAuth({ preserveExpired: true })
  const expired = !!auth && auth.expiresAt * 1000 <= Date.now()
  const cloudEnabled = REACT_APP_DEPLOY_ENV !== 'pages' && import.meta.env.VITE_QWERTY_SYNC_DISABLED !== 'true'
  const { administrator, checked } = useAdministratorAccess(cloudEnabled && !expired ? auth?.token : undefined)
  useEffect(() => {
    if (checked && !administrator) closeAccountDialog()
  }, [checked, administrator])
  return (
    <Dialog open={administrator} onClose={() => closeAccountDialog()} className="fixed inset-0 z-[60]">
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
        <Dialog.Panel className="focus-overlay-panel max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl p-6" data-account-tools>
          <div className="mb-5 flex items-center justify-between">
            <Dialog.Title className="text-xl font-semibold">云端账号工具</Dialog.Title>
            <button type="button" aria-label="关闭账号工具" onClick={() => closeAccountDialog()} className="rounded-lg px-3 py-2">
              关闭
            </button>
          </div>
          <p className="text-lg">{auth?.user.username ?? '尚未登录'}</p>
          {administrator && <AdministratorPanel key={auth?.user.userId || 'anonymous'} token={expired ? undefined : auth?.token} />}
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
