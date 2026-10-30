import type { CloudAuthState } from '../sync/types'
import AdministratorApplication from './AdministratorApplication'
import { administrationEnabled, administrationRequest } from './client'
import {
  administratorHint,
  administratorPath,
  isAdministratorPath,
  readAdministratorSession,
  rememberAdministratorSession,
} from './session'
import { createRoot } from 'react-dom/client'

export async function mountAdministratorApplication(root: HTMLElement | null) {
  if (!root) throw new Error('Missing administrator root')
  let admissionError = ''
  // Legacy admin login stays in its old namespace without restoring, exporting,
  // deleting or reassigning its learning workspace. Copy only the credential
  // after fresh server authorization; never mutate the S1-protected auth pointer.
  if (!isAdministratorPath() && !readAdministratorSession() && administrationEnabled) {
    try {
      const legacy = JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null') as CloudAuthState | null
      if (administratorHint(legacy) && legacy && legacy.expiresAt * 1000 > Date.now()) {
        if (!/^admin$/i.test(legacy.user.username)) throw new Error('管理员请使用 admin 重新登录。')
        const access = await administrationRequest<{ administrator: boolean }>('/api/admin/access', {
          token: legacy.token,
          anonymous: true,
        })
        if (access.administrator !== true) throw new Error('该账号未通过管理员权限核验。')
        rememberAdministratorSession(legacy)
      }
    } catch (error) {
      admissionError = error instanceof Error ? error.message : '管理身份核验失败。'
    }
  }
  window.history.replaceState(null, '', administratorPath())
  document.title = '管理控制台 · QWERTY Plus'
  createRoot(root).render(<AdministratorApplication admissionError={admissionError} />)
}
