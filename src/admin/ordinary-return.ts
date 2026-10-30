import type { CloudAuthState } from '../sync/types'

const KEY = 'qwerty.administrator.return.v1'
export function ordinaryLoginPath() {
  return (
    (REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner' : '') +
    (location.pathname.includes('/mobile') ? '/mobile/account?admin-return=1' : '/?s1-account=manage&admin-return=1')
  )
}
export function isAdministratorReturn() {
  const path = location.pathname.replace(/^\/qwerty-learner/, '').replace(/\/$/, '') || '/'
  return (
    new URLSearchParams(location.search).get('admin-return') === '1' &&
    (path === '/mobile/account' || (path === '/' && new URLSearchParams(location.search).get('s1-account') === 'manage'))
  )
}
export function rememberAdministratorReturn(auth: CloudAuthState) {
  sessionStorage.setItem(KEY, JSON.stringify(auth))
}
export function readAdministratorReturn(): CloudAuthState | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    return value &&
      /^admin$/i.test(value.user?.username || '') &&
      /^[a-f0-9]{32}$/.test(value.user?.userId || '') &&
      typeof value.token === 'string' &&
      value.token &&
      Number.isFinite(value.expiresAt) &&
      value.expiresAt * 1000 > Date.now()
      ? value
      : null
  } catch {
    return null
  }
}
export function forgetAdministratorReturn() {
  sessionStorage.removeItem(KEY)
}
export function ordinaryLoginDestination() {
  const url = new URL(location.href)
  url.searchParams.delete('admin-return')
  return url.pathname + url.search
}
