import { login, register } from './api'
import type { CloudAuthState } from './types'

const AUTH_STORAGE_KEY = 'qwerty.cloudAuth.v1'
const ISOLATED_AUTH_RETENTION_KEY = 'qwerty.s1.isolated-auth-retention'

/**
 * Set only after guarded S1 boot has validated registry ownership.
 * Isolated workspaces must remain owned by their account even if a token
 * expires. Legacy V1 expiration and sign-out semantics stay unchanged.
 */
export function setIsolatedAuthRetention(enabled: boolean): void {
  if (enabled) sessionStorage.setItem(ISOLATED_AUTH_RETENTION_KEY, '1')
  else sessionStorage.removeItem(ISOLATED_AUTH_RETENTION_KEY)
}

function retainExpiredAccountLocally(): boolean {
  try {
    return sessionStorage.getItem(ISOLATED_AUTH_RETENTION_KEY) === '1'
  } catch {
    return false
  }
}

function isValidStoredAuth(value: unknown): value is CloudAuthState {
  if (!value || typeof value !== 'object') return false

  const auth = value as Partial<CloudAuthState>
  return (
    typeof auth.token === 'string' &&
    auth.token.length > 0 &&
    typeof auth.expiresAt === 'number' &&
    !!auth.user &&
    typeof auth.user.userId === 'string' &&
    typeof auth.user.username === 'string'
  )
}

export function loadAuth(options: { preserveExpired?: boolean } = {}): CloudAuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isValidStoredAuth(parsed)) {
      localStorage.removeItem(AUTH_STORAGE_KEY)
      return null
    }

    if (parsed.expiresAt * 1000 <= Date.now() && !options.preserveExpired && !retainExpiredAccountLocally()) {
      localStorage.removeItem(AUTH_STORAGE_KEY)
      return null
    }

    return parsed
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    return null
  }
}

function saveAuth(auth: CloudAuthState) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
  return auth
}

function browserDeviceId() {
  const navigatorInfo = typeof navigator === 'undefined' ? 'browser' : navigator.userAgent
  return `qwerty-web-${navigatorInfo.slice(0, 80)}`
}

export async function registerAndRemember(username: string, password: string) {
  const result = await register(username, password, browserDeviceId())
  return saveAuth({
    user: result.user,
    token: result.token,
    expiresAt: result.expiresAt,
  })
}

export async function loginAndRemember(username: string, password: string) {
  const result = await login(username, password, browserDeviceId())
  return saveAuth({
    user: result.user,
    token: result.token,
    expiresAt: result.expiresAt,
  })
}

export function logout() {
  localStorage.removeItem(AUTH_STORAGE_KEY)
}
