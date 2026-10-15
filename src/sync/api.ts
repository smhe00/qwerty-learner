import type { CloudUser, RemoteSnapshot, RemoteSyncMeta } from './types'
import { V4_HTTP_PART_BYTES, planV4UploadParts } from './v4-http-part-plan'
import { retryIdenticalV4Part, stageImmutableV4Parts } from './v4-http-part-retry'
import { type PerfSample, recordV4TransportSample } from './perf-diagnostics'

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
  { method = 'GET', token, body, binary, partHeaders }: {
    method?: string; token?: string; body?: unknown
    binary?: Uint8Array; partHeaders?: Record<string, string>
  } = {},
): Promise<T> {
  if (import.meta.env.VITE_QWERTY_SYNC_DISABLED === 'true' || REACT_APP_DEPLOY_ENV === 'pages') {
    throw new SyncApiError(403, 'cloud_disabled', 'GitHub Pages 测试版禁用云账号和云同步。')
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (binary !== undefined) headers['Content-Type'] = 'application/octet-stream'
  if (partHeaders) Object.assign(headers, partHeaders)
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
      body: binary === undefined ? (body === undefined ? undefined : JSON.stringify(body))
        : new Uint8Array(binary),
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
type V4PutInput = {
  baseRevision: number
  logicalFingerprint: string
  payloadBase64: string
  deviceId?: string
  clientFormatVersion: 'qwerty-backup-v4'
}
export type V4BinaryPutInput = Omit<V4PutInput, 'payloadBase64'> & {
  payloadBytes: Uint8Array
}
type V4RecoveryInput = V4PutInput & {
  recoveryMode: 'replace-v4'
  expectedRemoteFormat: 'qwerty-backup-v4'
  expectedRemoteSha256: string
  expectedRemoteLogicalFingerprint?: string | null
  accountConfirmation: string
}
export type V4BinaryRecoveryInput = Omit<V4RecoveryInput, 'payloadBase64'> & {
  payloadBytes: Uint8Array
}
const V4_MULTIPART_THRESHOLD_CHARS = 128 * 1024

type V4Timings = Pick<PerfSample, 'blobWriteMs' | 'blobReadbackMs' |
  'partsReadMs' | 'commitCoreMs' | 'cleanupMs' | 'serverTotalMs' |
  'revisionWriteMs' | 'revisionReadbackMs' | 'revisionManifestMs' |
  'revisionChunkCount'>
type V4StageDetails = { failureStage?: PerfSample['failureStage']; timings?: V4Timings }
type V4PartReply = { ok: true; received: true; payloadSha256: string;
  partSha256: string; index: number; timings?: V4Timings }
type V4CommitReply = SyncMetaResponse & { timings?: V4Timings }

function v4TimeNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
function v4Elapsed(start: number): number {
  return Math.max(0, v4TimeNow() - start)
}
function v4ErrorDetails(error: unknown): V4StageDetails {
  const details = error instanceof SyncApiError ? error.details : null
  return details && typeof details === 'object' ? details as V4StageDetails : {}
}
function v4Failure(error: unknown, isCommit: boolean): {
  failureStage: PerfSample['failureStage']
  failureCategory: PerfSample['failureCategory']
  httpStatus?: number
  partIndex?: number
} {
  if (error instanceof SyncApiError) {
    const details = v4ErrorDetails(error)
    const serverStage = details.failureStage
    const stage = ['blob_write', 'blob_readback', 'part_lookup',
      'commit_core', 'revision_chunk', 'revision_manifest'].includes(String(serverStage))
      ? serverStage : isCommit ? 'commit_core' : 'http_request'
    const category = stage === 'blob_write' || stage === 'blob_readback' ||
      stage === 'part_lookup' || stage === 'revision_chunk' ||
      stage === 'revision_manifest' ? 'blob_storage'
      : error.status >= 500 ? 'server_failure' : 'http_failure'
    const partIndex = error.details && typeof error.details === 'object' &&
      'partIndex' in error.details &&
      typeof error.details.partIndex === 'number' &&
      Number.isSafeInteger(error.details.partIndex) &&
      error.details.partIndex >= 0 && error.details.partIndex < 192
      ? error.details.partIndex : undefined
    return { failureStage: stage, failureCategory: category,
      httpStatus: error.status, partIndex }
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return { failureStage: 'http_request', failureCategory: 'network_timeout' }
  }
  return { failureStage: 'http_request', failureCategory: 'network_failure' }
}

/** Timings are observation-only; no new retry or commit semantics. */
function v4Record(
  stage: 'v4-part' | 'v4-commit', elapsedMs: number,
  partIndex: number | undefined, attempt: number | undefined,
  sizeBytes: number, outcome: 'ok' | 'failed',
  timing?: V4Timings, error?: unknown,
): void {
  const failure = error === undefined ? {} : v4Failure(error, stage === 'v4-commit')
  recordV4TransportSample({
    stage, elapsedMs, partIndex, attempt, sizeBytes, outcome,
    ...timing, ...failure,
  })
}


/** Immutable account-scoped parts; only the final manifest invokes V4 CAS.
 * Unknown final commit outcome MUST be reconciled by remote meta first.
 */
async function putV4Multipart(
  token: string,
  input: V4PutInput | V4RecoveryInput | V4BinaryPutInput | V4BinaryRecoveryInput,
  recovery: boolean,
): Promise<SyncMetaResponse> {
  const compressed = 'payloadBytes' in input ? input.payloadBytes :
    Uint8Array.from(atob(input.payloadBase64), char => char.charCodeAt(0))
  const plan = await planV4UploadParts(compressed)
  // At most three independent content-addressed stage requests in flight.
  // The barrier waits for all in-flight requests to settle before commit;
  // no retry or concurrency is permitted for an ambiguous CAS commit.
  await stageImmutableV4Parts(plan.parts, async part => {
    let attempt = 0
    const response = await retryIdenticalV4Part(
      async () => {
        const started = v4TimeNow()
        attempt++
        let reply: V4PartReply
        try {
          reply = await request<V4PartReply>('/api/sync/v2/parts', {
            method: 'POST', token, binary: part.data,
            partHeaders: {
              'X-Qwerty-Payload-Sha256': plan.payloadSha256,
              'X-Qwerty-Part-Sha256': part.partSha256,
              'X-Qwerty-Part-Index': String(part.index),
              'X-Qwerty-Part-Count': String(plan.parts.length),
              'X-Qwerty-Chunk-Bytes': String(V4_HTTP_PART_BYTES),
            },
          })
        } catch (error) {
          v4Record('v4-part', v4Elapsed(started), part.index,
            attempt, part.data.length, 'failed',
            v4ErrorDetails(error).timings, error)
          throw error
        }
        if (!reply.received || reply.index !== part.index ||
            reply.payloadSha256 !== plan.payloadSha256 ||
            reply.partSha256 !== part.partSha256) {
          const mismatch = new SyncApiError(503, 'v4_upload_part_receipt_mismatch',
            'Cloud part acknowledgement is unverified; local V4 snapshot was preserved')
          v4Record('v4-part', v4Elapsed(started), part.index,
            attempt, part.data.length, 'failed', reply.timings, mismatch)
          throw mismatch
        }
        v4Record('v4-part', v4Elapsed(started), part.index,
          attempt, part.data.length, 'ok', reply.timings)
        return reply
      },
      error => !(error instanceof SyncApiError) ||
        (error.status >= 500 && error.status <= 599) ||
        error.code === 'invalid_response',
    )
    // Retain explicit receipt verification at the caller boundary.
    if (!response.received || response.index !== part.index ||
        response.payloadSha256 !== plan.payloadSha256 ||
        response.partSha256 !== part.partSha256) {
      throw new SyncApiError(503, 'v4_upload_part_receipt_mismatch',
        'Cloud part acknowledgement is unverified; local V4 snapshot was preserved')
    }
  })
  const metadata = { ...input } as Record<string, unknown>
  delete metadata.payloadBase64
  delete metadata.payloadBytes
  const started = v4TimeNow()
  try {
    const reply = await request<V4CommitReply>(
      recovery ? '/api/sync/v2/commit/recovery' : '/api/sync/v2/commit',
      recovery
        ? { method: 'POST', token, body: {
          ...metadata, payloadSha256: plan.payloadSha256, count: plan.parts.length,
          wirePartBytes: V4_HTTP_PART_BYTES,
          partSha256s: plan.parts.map(part => part.partSha256),
        } }
        : { method: 'POST', token, partHeaders: {
          // No JSON body: EdgeOne Maker can sporadically fail to consume even
          // tiny POST bodies. Staged blobs are already immutable/SHA pinned.
          'X-Qwerty-Commit-Protocol': 'header-v1',
          'X-Qwerty-Base-Revision': String(input.baseRevision),
          'X-Qwerty-Logical-Fingerprint': input.logicalFingerprint,
          'X-Qwerty-Payload-Sha256': plan.payloadSha256,
          'X-Qwerty-Part-Count': String(plan.parts.length),
          'X-Qwerty-Part-Sha256s': plan.parts.map(part => part.partSha256).join(','),
          'X-Qwerty-Chunk-Bytes': String(V4_HTTP_PART_BYTES),
          ...(input.deviceId ? { 'X-Qwerty-Device-Id': input.deviceId } : {}),
        } },
    )
    v4Record('v4-commit', v4Elapsed(started), undefined, undefined,
      plan.parts.length, 'ok', reply.timings)
    return reply
  } catch (error) {
    v4Record('v4-commit', v4Elapsed(started), undefined, undefined,
      plan.parts.length, 'failed', v4ErrorDetails(error).timings, error)
    // Final commit is NEVER automatically retried after an ambiguous response.
    throw error
  }
}

export function putSyncV2(token: string, input: V4PutInput) {
  if (input.payloadBase64.length > V4_MULTIPART_THRESHOLD_CHARS) {
    return putV4Multipart(token, input, false)
  }
  return request<SyncMetaResponse>('/api/sync/v2', {
    method: 'PUT', token, body: input,
  })
}

/** A one-part snapshot needs one HTTP request, not stage + commit.
 * It still has immutable SHA, six-table validation and V4 CAS on Maker.
 * Never automatically replay an ambiguous direct write.
 */
async function putSyncV2BinaryDirect(
  token: string, input: V4BinaryPutInput,
): Promise<SyncMetaResponse> {
  const plan = await planV4UploadParts(input.payloadBytes)
  if (plan.parts.length !== 1) throw new Error('v4-direct-requires-one-part')
  const started = v4TimeNow()
  try {
    const reply = await request<SyncMetaResponse>('/api/sync/v2/binary/direct', {
      method: 'POST', token, binary: input.payloadBytes,
      partHeaders: {
        'X-Qwerty-Payload-Sha256': plan.payloadSha256,
        'X-Qwerty-Base-Revision': String(input.baseRevision),
        'X-Qwerty-Logical-Fingerprint': input.logicalFingerprint,
        ...(input.deviceId ? { 'X-Qwerty-Device-Id': input.deviceId } : {}),
      },
    })
    if (reply.revision !== input.baseRevision + 1 ||
        reply.payloadSha256 !== plan.payloadSha256 ||
        reply.logicalFingerprint !== input.logicalFingerprint ||
        reply.storageEncoding !== 'binary') {
      throw new SyncApiError(503, 'v4_direct_commit_receipt_mismatch',
        'Direct V4 commit receipt is incomplete; remote revision must be rechecked')
    }
    v4Record('v4-commit', v4Elapsed(started), undefined, undefined,
      input.payloadBytes.length, 'ok')
    return reply
  } catch (error) {
    v4Record('v4-commit', v4Elapsed(started), undefined, undefined,
      input.payloadBytes.length, 'failed', v4ErrorDetails(error).timings, error)
    // Unknown result may already be durable; normal V4 recovery must read
    // remote revision + SHA before any subsequent user-initiated attempt.
    throw error
  }
}

/** New Sync writer: gzip remains raw Uint8Array from local snapshot
 * through HTTP, Maker SHA verification and native Blob storage.
 * HTTP and native Blob objects never exceed 512 KiB. Larger gzip uses
 * bounded parallel immutable staging followed by one guarded commit.
 */
export function putSyncV2Binary(token: string, input: V4BinaryPutInput) {
  return input.payloadBytes.length <= V4_HTTP_PART_BYTES
    ? putSyncV2BinaryDirect(token, input)
    : putV4Multipart(token, input, false)
}

type BinaryManifest = SyncMetaResponse & {
  payloadEncoding: 'binary'
  partSha256s: string[]
  count: number
  chunkBytes: number
}

export async function getSyncV2SnapshotBinary(token: string): Promise<{
  payloadEncoding: 'binary'
  payloadBytes: Uint8Array
} & RemoteSyncMeta> {
  const manifest = await request<BinaryManifest>('/api/sync/v2/binary/manifest', { token })
  if (!manifest.hasData || manifest.payloadEncoding !== 'binary' ||
      !manifest.payloadSha256 || !/^[a-f0-9]{64}$/.test(manifest.payloadSha256) ||
      !Number.isSafeInteger(manifest.count) || manifest.count < 1 ||
      manifest.count > 64 ||
      manifest.chunkBytes !== 512 * 1024 ||
      manifest.count !== Math.ceil(manifest.sizeBytes / manifest.chunkBytes) ||
      manifest.partSha256s?.length !== manifest.count ||
      !manifest.partSha256s.every(sha => /^[a-f0-9]{64}$/.test(sha)) ||
      manifest.sizeBytes > 16 * 1024 * 1024 || manifest.sizeBytes < 1) {
    throw new SyncApiError(503, 'invalid_binary_manifest',
      'Cloud binary V4 manifest failed structural validation')
  }
  const parts: Uint8Array[] = []
  let total = 0
  for (let index = 0; index < manifest.count; index++) {
    const params = new URLSearchParams({
      revision: String(manifest.revision),
      sha: manifest.payloadSha256,
      index: String(index),
    })
    const abort = new AbortController()
    const deadline = setTimeout(() => abort.abort(), 90_000)
    let response: Response
    let bytes: Uint8Array
    try {
      response = await fetch(apiUrl('/api/sync/v2/binary/part?' + params), {
        headers: { Authorization: `Bearer ${token}` },
        signal: abort.signal,
        cache: 'no-store',
      })
      if (!response.ok) throw new SyncApiError(response.status,
        'v4_binary_part_failed', 'Pinned binary V4 download failed')
      bytes = new Uint8Array(await response.arrayBuffer())
    } finally {
      clearTimeout(deadline)
    }
    if (!bytes.length || bytes.length > manifest.chunkBytes ||
        (index !== manifest.count - 1 && bytes.length !== manifest.chunkBytes)) {
      throw new SyncApiError(503, 'v4_binary_part_size_mismatch',
        'Binary V4 part has incorrect bounded size')
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const sha = [...new Uint8Array(digest)]
      .map(x => x.toString(16).padStart(2, '0')).join('')
    if (sha !== manifest.partSha256s[index]) {
      throw new SyncApiError(503, 'v4_binary_part_sha_mismatch',
        'Binary V4 part checksum differs from pinned manifest')
    }
    total += bytes.length
    if (total > manifest.sizeBytes) {
      throw new SyncApiError(503, 'v4_binary_total_size_mismatch',
        'Binary V4 download exceeds declared compressed bytes')
    }
    parts.push(bytes)
  }
  if (total !== manifest.sizeBytes) {
    throw new SyncApiError(503, 'v4_binary_total_size_mismatch',
      'Binary V4 download is incomplete')
  }
  const all = new Uint8Array(total)
  let offset = 0
  for (const part of parts) { all.set(part, offset); offset += part.length }
  const digest = await crypto.subtle.digest('SHA-256', all)
  const sha = [...new Uint8Array(digest)].map(x =>
    x.toString(16).padStart(2, '0')).join('')
  if (sha !== manifest.payloadSha256) {
    throw new SyncApiError(503, 'v4_binary_total_sha_mismatch',
      'Complete binary V4 download failed SHA verification')
  }
  return { ...manifest, payloadEncoding: 'binary', payloadBytes: all }
}

/** One guarded manual Sync transparently migrates a legacy Base64 Blob
 * revision to native binary with no learning-state mutation. A failed/ambiguous
 * migration is reconciled using fresh cloud metadata before continuing.
 */
export async function getSyncV2MetaWithBinaryMigration(
  token: string, prior: RemoteSyncMeta,
) {
  if (!prior.hasData || prior.clientFormatVersion !== 'qwerty-backup-v4' ||
      prior.storageEncoding === 'binary') return prior
  if (!prior.payloadSha256 || !prior.logicalFingerprint) {
    throw new SyncApiError(409, 'v4_binary_migration_missing_evidence',
      'Legacy cloud revision has no verified V4 SHA or fingerprint')
  }
  try {
    await request<SyncMetaResponse>('/api/sync/v2/binary/migrate', {
      method: 'POST', token, body: {
        baseRevision: prior.revision,
        payloadSha256: prior.payloadSha256,
        logicalFingerprint: prior.logicalFingerprint,
      },
    })
  } catch (error) {
    // A lost migration response can still mean the immutable binary revision
    // committed. Only a fresh, verified meta record resolves the ambiguity.
    const current = await getSyncV2Meta(token)
    if (current.storageEncoding !== 'binary' ||
        current.payloadSha256 !== prior.payloadSha256 ||
        current.logicalFingerprint !== prior.logicalFingerprint ||
        current.revision !== prior.revision + 1) throw error
    return current
  }
  const current = await getSyncV2Meta(token)
  if (current.storageEncoding !== 'binary' ||
      current.payloadSha256 !== prior.payloadSha256 ||
      current.logicalFingerprint !== prior.logicalFingerprint ||
      current.revision !== prior.revision + 1) {
    throw new SyncApiError(409, 'v4_binary_migration_changed',
      'Cloud migration changed protected revision evidence')
  }
  return current
}

/** User-confirmed explicit recovery: original pinned SHA and account-ID
 * safeguards are unchanged, only the gzip wire representation is binary.
 */
export function putSyncV2BinaryRecovery(token: string, input: V4BinaryRecoveryInput) {
  return putV4Multipart(token, input, true)
}

/** Explicit recovery retains its original server confirmation preconditions. */
export function putSyncV2Recovery(token: string, input: V4RecoveryInput) {
  if (input.payloadBase64.length > V4_MULTIPART_THRESHOLD_CHARS) {
    return putV4Multipart(token, input, true)
  }
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
