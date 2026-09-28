import type { CloudUser, RemoteSnapshot, RemoteSyncMeta } from './types'

type ApiErrorBody = {
  error?: string
  message?: string
  details?: unknown
}

type AuthResponse = {
  ok: true
  user: CloudUser
  token: string
  expiresAt: number
  expiresIn: number
}

type SyncMetaResponse = { ok: true } & RemoteSyncMeta
type SyncResponse = { ok: true } & RemoteSnapshot

export class SyncApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'SyncApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function apiUrl(path: string) {
  const configuredBase = String(import.meta.env.VITE_QWERTY_SYNC_BASE_URL || '').trim()
  if (!configuredBase) return path

  const base = new URL(configuredBase)
  const url = new URL(path, `${base.origin}/`)

  for (const [key, value] of base.searchParams.entries()) {
    url.searchParams.set(key, value)
  }

  return url.toString()
}

async function request<T>(
  path: string,
  { method = 'GET', token, body }: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  let data: unknown = null
  const text = await response.text()

  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new SyncApiError(
        response.status,
        'invalid_response',
        `Cloud API returned non-JSON HTTP ${response.status}`,
      )
    }
  }

  if (!response.ok) {
    const error = (data || {}) as ApiErrorBody
    throw new SyncApiError(
      response.status,
      error.error || 'request_failed',
      error.message || `Cloud request failed with HTTP ${response.status}`,
      error.details,
    )
  }

  return data as T
}

export function register(username: string, password: string, deviceId?: string) {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: { username, password, deviceId },
  })
}

export function login(username: string, password: string, deviceId?: string) {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: { username, password, deviceId },
  })
}

export function getMe(token: string) {
  return request<{ ok: true; user: CloudUser }>('/api/auth/me', { token })
}

export function getSyncMeta(token: string) {
  return request<SyncMetaResponse>('/api/sync/meta', { token })
}

export function getSync(token: string) {
  return request<SyncResponse>('/api/sync', { token })
}

export function putSync(
  token: string,
  input: {
    baseRevision: number
    payloadBase64: string
    deviceId?: string
    clientFormatVersion: string
  },
) {
  return request<SyncMetaResponse>('/api/sync', {
    method: 'PUT',
    token,
    body: input,
  })
}
