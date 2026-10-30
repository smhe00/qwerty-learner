import type { CloudAuthState } from '../sync/types'

const KEY = 'qwerty.administrator.session.v1'
/** A legacy hint only blocks learning startup; it never grants console access. */
export const administratorHint = (auth: CloudAuthState | null) =>
  !!auth && (auth.user.role === 'administrator' || /^(admin|smhe)$/i.test(auth.user.username))
export function administratorPath() {
  return (
    (REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner' : '') +
    (window.location.pathname.includes('/mobile') ? '/mobile/admin' : '/admin')
  )
}
export function isAdministratorPath(path = window.location.pathname) {
  return /\/(?:mobile\/)?admin\/?$/.test(path)
}
/** Separate tab-scoped credentials. Never modifies the learning auth/vault. */
export function readAdministratorSession(): CloudAuthState | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    if (
      !value ||
      typeof value.token !== 'string' ||
      !/^admin$/i.test(value.user?.username || '') ||
      !/^[a-f0-9]{32}$/.test(value.user?.userId || '') ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt * 1000 <= Date.now()
    )
      return null
    return value
  } catch {
    return null
  }
}
export function rememberAdministratorSession(auth: CloudAuthState) {
  sessionStorage.setItem(KEY, JSON.stringify(auth))
}
export function forgetAdministratorSession() {
  sessionStorage.removeItem(KEY)
}
