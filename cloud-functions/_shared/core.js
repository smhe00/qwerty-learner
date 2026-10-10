/* eslint-env node */
import crypto from 'node:crypto'
import { V4_FORMAT, verifyCompressedV4 } from './sync-v4.js'

export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message || code)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

const ACCOUNT_SCHEMA_VERSION = 1
const SNAPSHOT_SCHEMA_VERSION = 1
const SESSION_SCHEMA_VERSION = 1
const SESSION_TOKEN_PREFIX = 'qs1'
const SESSION_RANDOM_BYTES = 32
const SESSION_CREATE_RETRIES = 8
const DEFAULT_SNAPSHOT_RETENTION = 3
const DEFAULT_SESSION_HISTORY_RETENTION = 3
const DEFAULT_AUTH_HISTORY_RETENTION = 2
export const SYNC_CLIENT_FORMAT_VERSION = 'qwerty-backup-v3'
export const SYNC_SUPPORTED_CLIENT_FORMAT_VERSIONS = [
  SYNC_CLIENT_FORMAT_VERSION,
  'qwerty-dexie-gzip-v2',
]

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEY_LENGTH = 64
const SCRYPT_MAXMEM = 64 * 1024 * 1024

function nowIso() {
  return new Date().toISOString()
}

function unixSeconds() {
  return Math.floor(Date.now() / 1000)
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex')
}

function base64UrlEncode(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function scryptAsync(password, salt, keyLength) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      keyLength,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    )
  })
}

export function normalizeUsername(input) {
  if (typeof input !== 'string') {
    throw new AppError(400, 'invalid_username', 'Username must be a string')
  }

  const username = input.trim().normalize('NFKC')
  const normalizedUsername = username.toLowerCase()

  if (normalizedUsername.length < 3 || normalizedUsername.length > 32) {
    throw new AppError(400, 'invalid_username', 'Username must contain 3-32 characters')
  }
  const hasControlCharacter = [...normalizedUsername].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })

  if (hasControlCharacter || /[\s/\\?#%]/.test(normalizedUsername)) {
    throw new AppError(400, 'invalid_username', 'Username contains unsupported characters')
  }

  return { username, normalizedUsername }
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 4 || password.length > 128) {
    throw new AppError(400, 'invalid_password', 'Password must contain 4-128 characters')
  }
}

async function createPasswordRecord(password) {
  validatePassword(password)
  const salt = crypto.randomBytes(16).toString('base64')
  const hash = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)

  return {
    algorithm: 'scrypt',
    salt,
    hash: hash.toString('base64'),
    keyLength: SCRYPT_KEY_LENGTH,
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }
}

async function verifyPassword(password, record) {
  if (!record || record.algorithm !== 'scrypt' || typeof password !== 'string') return false

  const expected = Buffer.from(record.hash || '', 'base64')
  if (!expected.length) return false

  const actual = await scryptAsync(password, record.salt, expected.length)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function validatePayloadBase64(payloadBase64, maxSyncBytes) {
  if (typeof payloadBase64 !== 'string' || !payloadBase64.length) {
    throw new AppError(400, 'invalid_payload', 'payloadBase64 is required')
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payloadBase64) || payloadBase64.length % 4 !== 0) {
    throw new AppError(400, 'invalid_payload', 'payloadBase64 is not valid Base64')
  }

  const buffer = Buffer.from(payloadBase64, 'base64')
  if (buffer.toString('base64').replace(/=+$/g, '') !== payloadBase64.replace(/=+$/g, '')) {
    throw new AppError(400, 'invalid_payload', 'payloadBase64 is not canonical Base64')
  }
  if (buffer.length > maxSyncBytes) {
    throw new AppError(413, 'payload_too_large', 'Sync payload exceeds server limit', {
      maxBytes: maxSyncBytes,
      actualBytes: buffer.length,
    })
  }

  return buffer
}

function sanitizeDeviceId(deviceId) {
  return typeof deviceId === 'string' && deviceId.trim()
    ? deviceId.trim().slice(0, 128)
    : null
}

function createSession(identity, authVersion, version, sessionTtlSeconds, deviceId) {
  const randomSecret = base64UrlEncode(crypto.randomBytes(SESSION_RANDOM_BYTES))
  const token = `${SESSION_TOKEN_PREFIX}.${identity.usernameHash}.${randomSecret}`
  const issuedAt = unixSeconds()
  const expiresAt = issuedAt + sessionTtlSeconds

  return {
    token,
    record: {
      schemaVersion: SESSION_SCHEMA_VERSION,
      version,
      userId: identity.userId,
      usernameHash: identity.usernameHash,
      authVersion,
      tokenHash: sha256Hex(token),
      deviceId: sanitizeDeviceId(deviceId),
      createdAt: nowIso(),
      issuedAt,
      expiresAt,
    },
    expiresAt,
    expiresIn: sessionTtlSeconds,
  }
}

function parseSessionToken(token) {
  if (typeof token !== 'string') {
    throw new AppError(401, 'invalid_token', 'Invalid session token')
  }

  const parts = token.split('.')
  if (
    parts.length !== 3 ||
    parts[0] !== SESSION_TOKEN_PREFIX ||
    !/^[a-f0-9]{64}$/.test(parts[1]) ||
    !/^[A-Za-z0-9_-]{40,64}$/.test(parts[2])
  ) {
    throw new AppError(401, 'invalid_token', 'Invalid session token')
  }

  return {
    usernameHash: parts[1],
    tokenHash: sha256Hex(token),
  }
}

function secureHexEqual(left, right) {
  if (
    typeof left !== 'string' ||
    typeof right !== 'string' ||
    !/^[a-f0-9]{64}$/.test(left) ||
    !/^[a-f0-9]{64}$/.test(right)
  ) {
    return false
  }

  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

export function createBackendService({
  storage,
  sessionTtlSeconds = 7 * 24 * 60 * 60,
  maxSyncBytes = 4 * 1024 * 1024,
  snapshotRetention = DEFAULT_SNAPSHOT_RETENTION,
  sessionHistoryRetention = DEFAULT_SESSION_HISTORY_RETENTION,
  authHistoryRetention = DEFAULT_AUTH_HISTORY_RETENTION,
}) {
  if (!storage) throw new Error('storage is required')
  if (!Number.isInteger(snapshotRetention) || snapshotRetention < 1) {
    throw new Error('snapshotRetention must be a positive integer')
  }
  if (!Number.isInteger(sessionHistoryRetention) || sessionHistoryRetention < 1) {
    throw new Error('sessionHistoryRetention must be a positive integer')
  }
  if (!Number.isInteger(authHistoryRetention) || authHistoryRetention < 1) {
    throw new Error('authHistoryRetention must be a positive integer')
  }

  async function bestEffortPrune(label, operation) {
    try {
      await operation()
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'cloud_retention_cleanup_failed',
          area: label.toLowerCase(),
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorCode:
            error && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : null,
        }),
      )
    }
  }

  async function getCurrentAuth(identity) {
    const latest = await storage.getLatestAuth(identity.usernameHash)
    return latest || identity.initialAuth
  }

  async function getCurrentSession(identity) {
    const latest = await storage.getLatestSession(identity.usernameHash)
    return latest || identity.initialSession
  }

  async function issueNextSession(identity, authVersion, deviceId) {
    for (let attempt = 0; attempt < SESSION_CREATE_RETRIES; attempt += 1) {
      const current = await getCurrentSession(identity)
      const nextVersion = (current ? current.version : 0) + 1
      const candidate = createSession(
        identity,
        authVersion,
        nextVersion,
        sessionTtlSeconds,
        deviceId,
      )

      const created = await storage.createSessionVersion(
        identity.usernameHash,
        nextVersion,
        candidate.record,
      )

      if (created) {
        if (typeof storage.pruneSessionVersions === 'function') {
          await bestEffortPrune('Session', () =>
            storage.pruneSessionVersions(identity.usernameHash, sessionHistoryRetention),
          )
        }

        return {
          token: candidate.token,
          expiresAt: candidate.expiresAt,
          expiresIn: candidate.expiresIn,
        }
      }
    }

    throw new AppError(
      409,
      'session_update_conflict',
      'Concurrent login activity prevented session creation; please retry',
    )
  }

  async function authenticate(token) {
    const parsed = parseSessionToken(token)
    const identity = await storage.getAccount(parsed.usernameHash)

    if (!identity || identity.status !== 'active') {
      throw new AppError(401, 'invalid_token', 'Invalid session token')
    }

    const currentSession = await getCurrentSession(identity)
    if (
      !currentSession ||
      currentSession.userId !== identity.userId ||
      currentSession.usernameHash !== identity.usernameHash ||
      !secureHexEqual(currentSession.tokenHash, parsed.tokenHash)
    ) {
      throw new AppError(401, 'session_revoked', 'Session is no longer current')
    }

    if (
      typeof currentSession.expiresAt !== 'number' ||
      currentSession.expiresAt <= unixSeconds()
    ) {
      throw new AppError(401, 'session_expired', 'Session has expired')
    }

    const currentAuth = await getCurrentAuth(identity)
    if (!currentAuth || currentSession.authVersion !== currentAuth.version) {
      throw new AppError(401, 'session_revoked', 'Session is no longer valid')
    }

    return { identity, currentAuth, currentSession }
  }

  function publicUser(identity) {
    return {
      userId: identity.userId,
      username: identity.username,
      createdAt: identity.createdAt,
    }
  }

  async function register(usernameInput, password, deviceId) {
    const { username, normalizedUsername } = normalizeUsername(usernameInput)
    validatePassword(password)

    const usernameHash = sha256Hex(normalizedUsername)
    const existingIdentity = await storage.getAccount(usernameHash)
    if (existingIdentity) {
      throw new AppError(409, 'username_taken', 'Username is already registered')
    }

    const initialAuth = {
      version: 1,
      password: await createPasswordRecord(password),
      createdAt: nowIso(),
    }

    const identityBase = {
      schemaVersion: ACCOUNT_SCHEMA_VERSION,
      userId: randomHex(16),
      username,
      normalizedUsername,
      usernameHash,
      status: 'active',
      createdAt: nowIso(),
    }

    const initialSession = createSession(
      identityBase,
      initialAuth.version,
      1,
      sessionTtlSeconds,
      deviceId,
    )

    const identity = {
      ...identityBase,
      initialAuth,
      initialSession: initialSession.record,
    }

    const created = await storage.createAccount(usernameHash, identity)
    if (!created) {
      throw new AppError(409, 'username_taken', 'Username is already registered')
    }

    return {
      user: publicUser(identity),
      token: initialSession.token,
      expiresAt: initialSession.expiresAt,
      expiresIn: initialSession.expiresIn,
    }
  }

  async function login(usernameInput, password, deviceId) {
    const { normalizedUsername } = normalizeUsername(usernameInput)
    const usernameHash = sha256Hex(normalizedUsername)
    const identity = await storage.getAccount(usernameHash)

    if (!identity || identity.status !== 'active') {
      throw new AppError(401, 'invalid_credentials', 'Invalid username or password')
    }

    const currentAuth = await getCurrentAuth(identity)
    if (!(await verifyPassword(password, currentAuth.password))) {
      throw new AppError(401, 'invalid_credentials', 'Invalid username or password')
    }

    const session = await issueNextSession(identity, currentAuth.version, deviceId)
    return { user: publicUser(identity), ...session }
  }

  async function me(token) {
    const { identity, currentSession } = await authenticate(token)

    return {
      user: publicUser(identity),
      session: {
        version: currentSession.version,
        deviceId: currentSession.deviceId || null,
        expiresAt: currentSession.expiresAt,
      },
    }
  }

  async function changePassword(token, currentPassword, newPassword, deviceId) {
    const { identity, currentAuth } = await authenticate(token)
    validatePassword(newPassword)

    if (!(await verifyPassword(currentPassword, currentAuth.password))) {
      throw new AppError(401, 'invalid_credentials', 'Current password is incorrect')
    }

    const nextAuth = {
      version: currentAuth.version + 1,
      password: await createPasswordRecord(newPassword),
      createdAt: nowIso(),
    }

    const created = await storage.createAuthVersion(
      identity.usernameHash,
      nextAuth.version,
      nextAuth,
    )

    if (!created) {
      throw new AppError(
        409,
        'account_update_conflict',
        'Account changed concurrently, please retry',
      )
    }

    if (typeof storage.pruneAuthVersions === 'function') {
      await bestEffortPrune('Auth', () =>
        storage.pruneAuthVersions(identity.usernameHash, authHistoryRetention),
      )
    }

    const session = await issueNextSession(identity, nextAuth.version, deviceId)
    return { user: publicUser(identity), ...session }
  }

  function metaFromSnapshot(snapshot) {
    if (!snapshot) {
      return {
        hasData: false,
        revision: 0,
        updatedAt: null,
        sizeBytes: 0,
        dataSha256: null,
        // S2 read-only metadata contract: V1 has no canonical V4 logical digest.
        payloadSha256: null,
        logicalFingerprint: null,
        deviceId: null,
        clientFormatVersion: null,
      }
    }

    return {
      hasData: true,
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      sizeBytes: snapshot.sizeBytes,
      dataSha256: snapshot.dataSha256,
      // Transport digest and canonical logical digest are different things.
      // Existing V1/V3 snapshots have never had their V4 canonical
      // fingerprint server-verified, so they must never advertise one.
      payloadSha256: snapshot.dataSha256 || null,
      logicalFingerprint:
        snapshot.clientFormatVersion === V4_FORMAT
          ? (snapshot.logicalFingerprint || null)
          : null,
      deviceId: snapshot.deviceId || null,
      clientFormatVersion: snapshot.clientFormatVersion || null,
    }
  }

  async function deleteAccount(token, currentPassword) {
    const { identity, currentAuth } = await authenticate(token)

    if (!(await verifyPassword(currentPassword, currentAuth.password))) {
      throw new AppError(401, 'invalid_credentials', 'Current password is incorrect')
    }

    const deleted = await storage.deleteUserData(identity.usernameHash, identity.userId)
    if (!deleted || deleted.accountDeleted !== true) {
      throw new AppError(500, 'account_delete_failed', 'Cloud account deletion did not complete')
    }

    return { deleted }
  }

  async function syncMeta(token) {
    const { identity } = await authenticate(token)
    const current = await storage.getLatestRevision(identity.userId)
    return metaFromSnapshot(current ? current.snapshot : null)
  }

  async function getSync(token) {
    const { identity } = await authenticate(token)
    const current = await storage.getLatestRevision(identity.userId)

    if (!current) {
      return {
        ...metaFromSnapshot(null),
        payloadEncoding: 'base64',
        payloadBase64: null,
      }
    }

    return {
      ...metaFromSnapshot(current.snapshot),
      payloadEncoding: 'base64',
      payloadBase64: current.snapshot.payloadBase64,
    }
  }

  async function putSync(token, input = {}) {
    const { identity } = await authenticate(token)
    const baseRevision = Number(input.baseRevision)

    if (!Number.isInteger(baseRevision) || baseRevision < 0) {
      throw new AppError(
        400,
        'invalid_base_revision',
        'baseRevision must be a non-negative integer',
      )
    }

    if (!SYNC_SUPPORTED_CLIENT_FORMAT_VERSIONS.includes(input.clientFormatVersion)) {
      throw new AppError(
        400,
        'unsupported_sync_format',
        `clientFormatVersion must be one of ${SYNC_SUPPORTED_CLIENT_FORMAT_VERSIONS.join(', ')}`,
      )
    }

    const payload = validatePayloadBase64(input.payloadBase64, maxSyncBytes)
    if (payload.length < 2 || payload[0] !== 0x1f || payload[1] !== 0x8b) {
      throw new AppError(400, 'invalid_payload', 'Sync payload must be gzip-compressed data')
    }

    const current = await storage.getLatestRevision(identity.userId)
    const currentRevision = current ? current.revision : 0

    if (baseRevision !== currentRevision) {
      throw new AppError(409, 'sync_conflict', 'Remote data has changed', {
        current: metaFromSnapshot(current ? current.snapshot : null),
      })
    }
    // V1 client must never replace a V4-only revision, including an
    // already-open legacy tab whose authentication still works.
    if (current?.snapshot.clientFormatVersion === V4_FORMAT) {
      throw new AppError(409, 'sync_upgrade_required',
        'This workspace has upgraded to Sync V2; V1 write refused')
    }

    const revision = currentRevision + 1
    const snapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      revision,
      updatedAt: nowIso(),
      sizeBytes: payload.length,
      dataSha256: crypto.createHash('sha256').update(payload).digest('hex'),
      payloadEncoding: 'base64',
      payloadBase64: input.payloadBase64,
      deviceId: sanitizeDeviceId(input.deviceId),
      clientFormatVersion:
        input.clientFormatVersion === undefined || input.clientFormatVersion === null
          ? null
          : String(input.clientFormatVersion).slice(0, 64),
    }

    const created = await storage.createRevision(identity.userId, revision, snapshot)
    if (!created) {
      const latest = await storage.getLatestRevision(identity.userId)
      throw new AppError(409, 'sync_conflict', 'Remote data changed during upload', {
        current: metaFromSnapshot(latest ? latest.snapshot : null),
      })
    }

    // The snapshot commit is already durable at this point. Retention cleanup is
    // maintenance only: a cleanup failure must not turn a successful commit into
    // an HTTP failure, otherwise the client could retry an already-committed
    // revision and receive a misleading conflict.
    if (typeof storage.pruneRevisions === 'function') {
      await bestEffortPrune('Snapshot', () =>
        storage.pruneRevisions(identity.userId, snapshotRetention),
      )
    }

    return metaFromSnapshot(snapshot)
  }

  /**
   * Separate V2 endpoint; unchanged legacy V1 paths cannot accidentally
   * submit V4. No implicit V3->V4 migration/overwrite is allowed.
   */
  async function putSyncV4(token, input = {}) {
    const { identity } = await authenticate(token)
    const baseRevision = input.baseRevision
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
      throw new AppError(400, 'invalid_base_revision', 'V4 baseRevision must be a non-negative safe integer')
    }
    if (input.clientFormatVersion !== V4_FORMAT) {
      throw new AppError(400, 'unsupported_sync_format', 'V4 endpoint requires qwerty-backup-v4')
    }
    const payload = validatePayloadBase64(input.payloadBase64, maxSyncBytes)
    if (payload.length < 2 || payload[0] !== 0x1f || payload[1] !== 0x8b) {
      throw new AppError(400, 'invalid_payload', 'Sync V4 payload must be gzip-compressed')
    }
    let verified
    try {
      verified = verifyCompressedV4(payload, identity.userId, input.logicalFingerprint)
    } catch (error) {
      throw new AppError(400, 'invalid_v4_workspace',
        error instanceof Error ? error.message : 'Invalid Backup V4 workspace')
    }

    const current = await storage.getLatestRevision(identity.userId)
    const currentRevision = current ? current.revision : 0
    if (currentRevision !== baseRevision) {
      throw new AppError(409, 'sync_conflict', 'Remote data changed', {
        current: metaFromSnapshot(current?.snapshot || null),
      })
    }
    if (current && current.snapshot.clientFormatVersion !== V4_FORMAT) {
      throw new AppError(409, 'sync_migration_required',
        'Existing V1 cloud data needs explicit migration; V4 write refused', {
          current: metaFromSnapshot(current.snapshot),
        })
    }
    const revision = currentRevision + 1
    const snapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      revision,
      updatedAt: nowIso(),
      sizeBytes: payload.length,
      dataSha256: crypto.createHash('sha256').update(payload).digest('hex'),
      logicalFingerprint: verified.logicalFingerprint,
      payloadEncoding: 'base64',
      payloadBase64: input.payloadBase64,
      deviceId: sanitizeDeviceId(input.deviceId),
      clientFormatVersion: V4_FORMAT,
    }
    // Atomic revision CREATE is the authoritative concurrency gate;
    // an earlier GET/meta cannot authorize overwriting a newer revision.
    if (!(await storage.createRevision(identity.userId, revision, snapshot))) {
      const latest = await storage.getLatestRevision(identity.userId)
      throw new AppError(409, 'sync_conflict', 'Remote data changed during V4 CAS', {
        current: metaFromSnapshot(latest?.snapshot || null),
      })
    }
    if (typeof storage.pruneRevisions === 'function') {
      await bestEffortPrune('Snapshot V4', () =>
        storage.pruneRevisions(identity.userId, snapshotRetention))
    }
    return metaFromSnapshot(snapshot)
  }

  async function cleanupTestUser(usernameInput) {
    const { normalizedUsername } = normalizeUsername(usernameInput)
    const usernameHash = sha256Hex(normalizedUsername)
    const identity = await storage.getAccount(usernameHash)

    if (!identity) {
      return {
        accountDeleted: false,
        authDeleted: 0,
        sessionsDeleted: 0,
        revisionsDeleted: 0,
      }
    }

    return storage.deleteUserData(usernameHash, identity.userId)
  }

  return {
    register,
    login,
    me,
    changePassword,
    deleteAccount,
    syncMeta,
    getSync,
    putSync,
    putSyncV4,
    cleanupTestUser,
  }
}
