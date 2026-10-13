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

export type DeleteAccountResponse = {
  ok: true
  deleted: {
    accountDeleted: boolean
    authDeleted: number
    sessionsDeleted: number
    revisionsDeleted: number
  }
}

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
  // All EdgeOne Maker frontends must use their OWN origin-scoped /api.
  // Main q-test must never silently target the production Blob backend.
  if (typeof window !== 'undefined' &&
      /(?:^|\.)edgeone\.(?:dev|cool)$/i.test(window.location.hostname)) {
    return path
  }
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
  if (import.meta.env.VITE_QWERTY_SYNC_DISABLED === 'true' || REACT_APP_DEPLOY_ENV === 'pages') {
    throw new SyncApiError(403, 'cloud_disabled', 'GitHub Pages 测试版禁用云账号和云同步。')
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  // Guarded V4 Sync must not trap a learner on the Block screen forever
  // when the network stalls. Aborting the client request is NOT proof that
  // a server CAS did not commit: the next attempt always rechecks metadata.
  const isEventsPilot = path.startsWith('/api/sync/events/v2')
  const abort = (path.startsWith('/api/sync/v2') || isEventsPilot)
    ? new AbortController() : null
  const deadline = abort ? setTimeout(() => abort.abort(),
    isEventsPilot ? 30_000 : 90_000) : null
  let response: Response
  let text: string
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort?.signal,
    })
    text = await response.text()
  } finally {
    if (deadline !== null) clearTimeout(deadline)
  }

  let data: unknown = null

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
    // The currently saved token was superseded by another device. Broadcast
    // only for the still-current local token: late responses from a previous
    // login must not force a newer session out of its workspace.
    if (response.status === 401 && error.error === 'session_revoked' &&
        token && typeof window !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null')
        if (saved?.token === token) {
          window.dispatchEvent(new Event('qwerty:cloud-session-revoked'))
        }
      } catch {
        // A damaged auth record must never authorize an owner transition.
      }
    }
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

export function deleteCloudAccount(token: string, currentPassword: string) {
  return request<DeleteAccountResponse>('/api/auth/account', {
    method: 'DELETE',
    token,
    body: { currentPassword },
  })
}

export function getSyncMeta(token: string) {
  return request<SyncMetaResponse>('/api/sync/meta', { token })
}

export function getSync(token: string) {
  return request<SyncResponse>('/api/sync', { token })
}

/** S2 metadata-only preflight; unsupported cloud formats must fail closed.
 * A missing/null logicalFingerprint must BLOCK rather than authorize a push.
 * Not wired to live UI until S1 production rollout and S2 crash gates pass.
 */
export function getSyncV2Meta(token: string) {
  return request<SyncMetaResponse>('/api/sync/v2/meta', { token })
}

/** Read-only V4 snapshot fetch. MUST verify bytes with
 * verifyDownloadedWorkspaceV4 before any eventual restore.
 */
export function getSyncV2Snapshot(token: string) {
  return request<SyncResponse>('/api/sync/v2', { token })
}

/** S2 verified V4 CAS endpoint. No ordinary UI/legacy V1 caller. */
export function putSyncV2(
  token: string,
  input: {
    baseRevision: number
    logicalFingerprint: string
    payloadBase64: string
    deviceId?: string
    clientFormatVersion: 'qwerty-backup-v4'
  },
) {
  return request<SyncMetaResponse>('/api/sync/v2', {
    method: 'PUT', token, body: input,
  })
}

/** Explicit recovery only. Never reachable from the ordinary Sync button.
 * Server verifies immutable account, pinned remote SHA and format, and CAS.
 */
export function putSyncV2Recovery(
  token: string,
  input: {
    baseRevision: number
    payloadBase64: string
    logicalFingerprint: string
    clientFormatVersion: 'qwerty-backup-v4'
    recoveryMode: 'replace-v4'
    expectedRemoteFormat: 'qwerty-backup-v4'
    expectedRemoteSha256: string
    expectedRemoteLogicalFingerprint?: string | null
    accountConfirmation: string
    deviceId?: string
  },
) {
  return request<SyncMetaResponse>('/api/sync/v2/recovery', {
    method: 'PUT', token, body: input,
  })
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
/** M3.6 pilot only: these functions cannot be invoked from ordinary Sync UI.
 * A failed POST, aborted network, or malformed ACK is always ambiguous.
 * The durable outbox preserves and retries the SAME in-flight bytes.
 */
import type { ChainedBatch, ChainedReceipt } from './multi-device-outbox'

type PublishChainedResponse = { ok: true; stored: true; sha256: string } & ChainedReceipt
type ReadChainedResponse = { ok: true; batch: ChainedBatch & {
  schemaVersion: 2; accountId: string; sha256: string
} }

export function publishChainedEventBatch(token: string, batch: ChainedBatch) {
  return request<PublishChainedResponse>('/api/sync/events/v2', {
    method: 'POST', token, body: batch,
  })
}

export function readChainedEventBatch(token: string, receipt: ChainedReceipt) {
  const query = new URLSearchParams({
    deviceId: receipt.deviceId, sequence: String(receipt.sequence),
    batchId: receipt.batchId, sha256: receipt.sha256,
  })
  return request<ReadChainedResponse>('/api/sync/events/v2?' + query, { token })
}
