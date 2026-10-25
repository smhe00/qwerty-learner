/* eslint-env node */
import crypto from 'node:crypto'
import { V4_FORMAT, verifyCompressedV4 } from './sync-v4.js'
import {
  issueDeviceCheckoutDeclaration,
  readDeviceCheckoutDeclaration,
} from './device-checkout.js'

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
const EVENT_BATCH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EVENT_DEVICE_ID = /^qwerty-web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_EVENT_BATCH_BYTES = 96 * 1024
const MAX_EVENT_BATCH_ROWS = 32
const MAX_EVENT_SEQUENCE = 1_000_000_000
const EVENT_SHA = /^[a-f0-9]{64}$/
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

function canonicalEventJson(value, depth = 0) {
  if (depth > 20) throw new AppError(400, 'invalid_event_batch', 'Event batch nesting limit exceeded')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map(row => canonicalEventJson(row, depth + 1)).join(',') + ']'
  }
  if (value && typeof value === 'object' &&
      (Object.getPrototypeOf(value) === Object.prototype ||
       Object.getPrototypeOf(value) === null)) {
    const keys = Object.keys(value).sort()
    if (keys.some(key => key === '__proto__' || key === 'constructor' ||
      key === 'prototype')) {
      throw new AppError(400, 'invalid_event_batch', 'Unsafe event field')
    }
    return '{' + keys.map(key =>
      JSON.stringify(key) + ':' + canonicalEventJson(value[key], depth + 1)).join(',') + '}'
  }
  throw new AppError(400, 'invalid_event_batch', 'Event contains unsupported JSON values')
}

function validateImmutableEventBatch(input, accountId) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !EVENT_DEVICE_ID.test(input.deviceId) ||
      !EVENT_BATCH_UUID.test(input.batchId) ||
      !Array.isArray(input.events) || input.events.length < 1 ||
      input.events.length > MAX_EVENT_BATCH_ROWS) {
    throw new AppError(400, 'invalid_event_batch', 'Invalid device, batch ID or event count')
  }
  const seen = new Set()
  for (const row of input.events) {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        !EVENT_BATCH_UUID.test(row.attemptId) ||
        typeof row.dict !== 'string' || row.dict.length < 1 || row.dict.length > 128 ||
        typeof row.word !== 'string' || row.word.length < 1 || row.word.length > 128 ||
        !Number.isSafeInteger(row.timeStamp) || row.timeStamp < 0 ||
        row.timeStamp > 86_400_000_000 ||
        !['learn', 'typing'].includes(row.sourceMode) ||
        Object.prototype.hasOwnProperty.call(row, 'id') ||
        Object.prototype.hasOwnProperty.call(row, 'fsrsShadow') ||
        (row.reviewBaseStateFingerprint !== undefined &&
          (!/^[0-9a-f]{64}$/.test(row.reviewBaseStateFingerprint) ||
            row.sourceMode !== 'learn' ||
            row.chapter !== -1 ||
            row.reviewRatingDecision?.eligible !== true)) ||
        seen.has(row.attemptId)) {
      throw new AppError(400, 'invalid_event_batch', 'Invalid immutable word attempt')
    }
    seen.add(row.attemptId)
  }
  const body = {
    schemaVersion: 1, accountId,
    deviceId: input.deviceId, batchId: input.batchId, events: input.events,
  }
  const canonical = canonicalEventJson(body)
  if (Buffer.byteLength(canonical, 'utf8') > MAX_EVENT_BATCH_BYTES) {
    throw new AppError(413, 'event_batch_too_large', 'Event batch exceeds bounded limit')
  }
  const sha256 = sha256Hex(canonical)
  return { ...body, sha256 }
}


// M3.2 - opaque immutable predecessor links; no shared mutable device head.
function validateChainInput(input, accountId) {
  const old = validateImmutableEventBatch(input, accountId)
  if (!Number.isSafeInteger(input.sequence) ||
      input.sequence < 1 || input.sequence > MAX_EVENT_SEQUENCE ||
      (input.sequence === 1 && input.previous !== null) ||
      (input.sequence > 1 &&
       (!input.previous || typeof input.previous !== 'object' ||
        Array.isArray(input.previous) ||
        !EVENT_BATCH_UUID.test(input.previous.batchId) ||
        !EVENT_SHA.test(input.previous.sha256)))) {
    throw new AppError(400, 'invalid_event_chain',
      'A batch must have a positive sequence and exact predecessor receipt')
  }
  if (input.previous && (
      Object.keys(input.previous).sort().join(',') !== 'batchId,sha256')) {
    throw new AppError(400, 'invalid_event_chain', 'Invalid predecessor shape')
  }
  const chain = {
    schemaVersion: 2,
    accountId,
    deviceId: old.deviceId,
    batchId: old.batchId,
    sequence: input.sequence,
    previous: input.previous === null ? null : {
      batchId: input.previous.batchId,
      sha256: input.previous.sha256,
    },
    events: old.events,
  }
  const canonical = canonicalEventJson(chain)
  if (Buffer.byteLength(canonical, 'utf8') > MAX_EVENT_BATCH_BYTES) {
    throw new AppError(413, 'event_batch_too_large', 'Chain batch exceeds limit')
  }
  return { ...chain, sha256: sha256Hex(canonical) }
}

function sanitizeDeviceId(deviceId) {
  return typeof deviceId === 'string' && deviceId.trim()
    ? deviceId.trim().slice(0, 128)
    : null
}

function createSession(identity, authVersion, version, sessionTtlSeconds, deviceId, signToken) {
  const randomSecret = base64UrlEncode(crypto.randomBytes(SESSION_RANDOM_BYTES))
  const baseToken = `${SESSION_TOKEN_PREFIX}.${identity.usernameHash}.${randomSecret}`
  const token = signToken ? signToken(baseToken, identity) : baseToken
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
    (parts.length !== 3 && parts.length !== 4) ||
    (parts.length === 4 && !/^[A-Za-z0-9_-]{43}$/.test(parts[3])) ||
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
  maxSyncBytes = 16 * 1024 * 1024,
  snapshotRetention = DEFAULT_SNAPSHOT_RETENTION,
  sessionHistoryRetention = DEFAULT_SESSION_HISTORY_RETENTION,
  authHistoryRetention = DEFAULT_AUTH_HISTORY_RETENTION,
  multiSessionEnabled = false,
  eventPilotEnabled = false,
  activityGuard = null,
  registrationGuard = null,
  credentials = null,
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
    if (credentials?.managedName?.(identity.normalizedUsername) && !credentials.matches(identity)) {
      throw new AppError(403, 'administrator_identity_mismatch', 'Administrator identity does not match the binding')
    }
    if (credentials?.matches(identity)) return { version: 1, environmentManaged: true }
    const latest = await storage.getLatestAuth(identity.usernameHash)
    return latest || identity.initialAuth
  }

  async function getCurrentSession(identity) {
    const latest = await storage.getLatestSession(identity.usernameHash)
    return latest || identity.initialSession
  }

  // Independent sessions have unique immutable per-token keys. No shared
  // monotonically incremented session slot or non-atomic Blob CAS is involved.
  async function issueIndependentSession(identity, authVersion, deviceId) {
    if (typeof storage.createIndependentSession !== 'function') {
      throw new Error('Independent session storage unavailable')
    }
    const candidate = createSession(identity, authVersion, 1, sessionTtlSeconds, deviceId, credentials?.sign)
    candidate.record.sessionId = randomHex(16)
    candidate.record.mode = 'independent'
    if (!(await storage.createIndependentSession(
      identity.usernameHash, candidate.record.tokenHash, candidate.record
    ))) {
      throw new AppError(503, 'session_creation_unverified',
        'Independent session could not be safely persisted')
    }
    return {
      token: candidate.token,
      expiresAt: candidate.expiresAt,
      expiresIn: candidate.expiresIn,
    }
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
        credentials?.sign,
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

    if ((credentials && !credentials.accepts(token, identity)) ||
        (!credentials && token.split('.').length !== 3)) {
      throw new AppError(401, 'session_revoked', 'Session credentials have changed')
    }

    // Legacy latest-session records remain valid if and only if they were
    // already current. This permits a gated rollout without reviving old tokens.
    // New sessions live under disjoint random token-hash keys.
    let currentSession = null
    if (multiSessionEnabled) {
      if (typeof storage.getIndependentSession !== 'function') {
        throw new Error('Independent session storage unavailable')
      }
      currentSession = await storage.getIndependentSession(
        identity.usernameHash, parsed.tokenHash
      )
    }
    if (!currentSession) {
      const legacySession = await getCurrentSession(identity)
      if (legacySession &&
          secureHexEqual(legacySession.tokenHash, parsed.tokenHash)) {
        currentSession = legacySession
      }
    }
    if (!currentSession ||
        currentSession.userId !== identity.userId ||
        currentSession.usernameHash !== identity.usernameHash ||
        !secureHexEqual(currentSession.tokenHash, parsed.tokenHash)) {
      throw new AppError(401, 'session_revoked', 'Session is no longer current')
    }
    // A per-session tombstone is monotonic, never an overwritten active record.
    // Check even with the feature disabled to respect prior revocations on rollback.
    if (typeof storage.getSessionRevocation === 'function' &&
        await storage.getSessionRevocation(identity.usernameHash, parsed.tokenHash)) {
      throw new AppError(401, 'session_revoked', 'Session was revoked')
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

    if (activityGuard) await activityGuard(identity)
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
    if (registrationGuard) await registrationGuard(usernameHash)
    const existingIdentity = await storage.getAccount(usernameHash)
    if (existingIdentity) {
      throw new AppError(409, 'username_taken', 'Username is already registered')
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

    const managedRegistration = !!credentials?.managedName?.(normalizedUsername)
    if (managedRegistration && !credentials.matches(identityBase)) {
      throw new AppError(409, 'administrator_account_reserved', 'Administrator identity is already bound')
    }
    if (managedRegistration && !credentials.verify(password)) {
      throw new AppError(401, 'incorrect_password', 'Enter the configured administrator password to register SMHE')
    }
    const initialAuth = managedRegistration
      ? { version: 1, environmentManaged: true, createdAt: nowIso() }
      : { version: 1, password: await createPasswordRecord(password), createdAt: nowIso() }

    const initialSession = createSession(
      identityBase,
      initialAuth.version,
      1,
      sessionTtlSeconds,
      deviceId,
      credentials?.sign,
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

    if (managedRegistration && credentials.authorize) await credentials.authorize(identity)
    if (activityGuard) await activityGuard(identity)
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
      throw new AppError(401, 'account_not_found', 'Account does not exist')
    }

    const currentAuth = await getCurrentAuth(identity)
    const passwordValid = currentAuth.environmentManaged
      ? credentials.verify(password) : await verifyPassword(password, currentAuth.password)
    if (!passwordValid) {
      throw new AppError(401, 'incorrect_password', 'Password is incorrect')
    }

    if (currentAuth.environmentManaged && credentials.authorize) await credentials.authorize(identity)
    if (activityGuard) await activityGuard(identity)
    const session = multiSessionEnabled
      ? await issueIndependentSession(identity, currentAuth.version, deviceId)
      : await issueNextSession(identity, currentAuth.version, deviceId)
    return { user: publicUser(identity), ...session }
  }

  async function me(token) {
    const { identity, currentSession } = await authenticate(token)

    return {
      user: publicUser(identity),
      session: {
        version: currentSession.version,
        sessionId: currentSession.sessionId || null,
        deviceId: currentSession.deviceId || null,
        expiresAt: currentSession.expiresAt,
      },
    }
  }

  async function changePassword(token, currentPassword, newPassword, deviceId) {
    const { identity, currentAuth } = await authenticate(token)
    if (currentAuth.environmentManaged) {
      throw new AppError(403, 'environment_password_managed', 'Change the administrator password in server environment variables')
    }
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

    const session = multiSessionEnabled
      ? await issueIndependentSession(identity, nextAuth.version, deviceId)
      : await issueNextSession(identity, nextAuth.version, deviceId)
    return { user: publicUser(identity), ...session }
  }

  async function revokeSession(token) {
    if (!multiSessionEnabled) {
      throw new AppError(404, 'not_found', 'Independent sessions are not enabled')
    }
    const { identity, currentSession } = await authenticate(token)
    if (typeof storage.revokeSessionToken !== 'function' ||
        typeof storage.getSessionRevocation !== 'function') {
      throw new Error('Independent session revocation storage unavailable')
    }
    await storage.revokeSessionToken(identity.usernameHash, currentSession.tokenHash)
    const marker = await storage.getSessionRevocation(
      identity.usernameHash, currentSession.tokenHash
    )
    if (!marker || marker.revoked !== true) {
      throw new AppError(503, 'session_revocation_unverified',
        'Session revocation could not be verified')
    }
    return { revoked: true }
  }

  function requireEventPilot() {
    // Immutable append-only learning evidence is independent of how many
    // login sessions are valid. Every operation below still authenticates
    // its CURRENT bearer and checks the submitting device ID.
    if (!eventPilotEnabled) {
      throw new AppError(404, 'not_found', 'Event-batch pilot is disabled')
    }
    if (typeof storage.putImmutableEventBatch !== 'function' ||
        typeof storage.getImmutableEventBatch !== 'function') {
      throw new Error('Event-batch storage is unavailable')
    }
  }

  async function publishLearningBatch(token, input = {}) {
    requireEventPilot()
    const { identity } = await authenticate(token)
    const record = validateImmutableEventBatch(input, identity.userId)
    const stored = await storage.putImmutableEventBatch(
      identity.userId, record.deviceId, record.batchId, record.sha256, record
    )
    // An ambiguous response, stale read, or differing object is never ACKed.
    // Retrying the same immutable envelope is safe and idempotent.
    const confirmed = await storage.getImmutableEventBatch(
      identity.userId, record.deviceId, record.batchId, record.sha256
    )
    if (!stored || !confirmed || canonicalEventJson(confirmed) !== canonicalEventJson(record)) {
      throw new AppError(503, 'event_batch_unverified',
        'Published event batch is not yet independently verified')
    }
    return {
      stored: true, accountId: identity.userId, deviceId: record.deviceId,
      batchId: record.batchId, sha256: record.sha256,
      attemptCount: record.events.length,
      // A single durable batch is NOT proof of complete multi-device convergence.
      convergenceComplete: false,
    }
  }

  async function readLearningBatch(token, selector = {}) {
    requireEventPilot()
    const { identity } = await authenticate(token)
    if (!EVENT_DEVICE_ID.test(selector.deviceId) ||
        !EVENT_BATCH_UUID.test(selector.batchId) ||
        typeof selector.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(selector.sha256)) {
      throw new AppError(400, 'invalid_event_selector', 'Invalid batch receipt')
    }
    const record = await storage.getImmutableEventBatch(
      identity.userId, selector.deviceId, selector.batchId, selector.sha256
    )
    if (!record) throw new AppError(404, 'event_batch_not_visible', 'Batch is not yet visible')
    let verified
    try {
      verified = validateImmutableEventBatch(record, identity.userId)
    } catch {
      throw new AppError(503, 'event_batch_integrity_failed',
        'Event batch failed payload validation')
    }
    if (verified.sha256 !== selector.sha256 ||
        record.accountId !== identity.userId ||
        record.deviceId !== selector.deviceId ||
        record.batchId !== selector.batchId ||
        canonicalEventJson(record) !== canonicalEventJson(verified)) {
      throw new AppError(503, 'event_batch_integrity_failed',
        'Event batch receipt failed integrity check')
    }
    return { batch: verified, convergenceComplete: false }
  }

  async function observeLearningBatchReceipts(token) {
    requireEventPilot()
    const { identity } = await authenticate(token)
    if (typeof storage.observeImmutableEventBatches !== 'function') {
      throw new Error('Event-batch receipt discovery unavailable')
    }
    const view = await storage.observeImmutableEventBatches(identity.userId)
    const seen = new Map()
    const conflicts = new Set()
    for (const receipt of view.receipts) {
      const key = receipt.deviceId + ':' + receipt.batchId
      const previous = seen.get(key)
      if (previous && previous !== receipt.sha256) conflicts.add(key)
      else seen.set(key, receipt.sha256)
    }
    return {
      observed: view.receipts, observedCount: view.receipts.length,
      conflictingBatchIds: [...conflicts].sort(),
      truncated: view.truncated,
      convergenceComplete: false, listingIsAuthoritative: false,
    }
  }


  function requireChainPilot() {
    requireEventPilot()
    if (typeof storage.putImmutableChainedBatch !== 'function' ||
        typeof storage.getImmutableChainedBatch !== 'function') {
      throw new Error('Chained event storage unavailable')
    }
  }

  async function verifiedChainReceipt(accountId, selector) {
    const record = await storage.getImmutableChainedBatch(
      accountId, selector.deviceId, selector.sequence,
      selector.batchId, selector.sha256)
    if (!record) return null
    let verified
    try {
      verified = validateChainInput(record, accountId)
    } catch {
      throw new AppError(503, 'event_chain_integrity_failed',
        'Chained event batch failed integrity validation')
    }
    if (verified.sha256 !== selector.sha256 ||
        verified.sequence !== selector.sequence ||
        verified.batchId !== selector.batchId ||
        verified.deviceId !== selector.deviceId ||
        canonicalEventJson(verified) !== canonicalEventJson(record)) {
      throw new AppError(503, 'event_chain_integrity_failed',
        'Chained event batch does not match its immutable receipt')
    }
    return verified
  }

  async function publishChainedLearningBatch(token, input = {}) {
    requireChainPilot()
    const { identity, currentSession } = await authenticate(token)
    const candidate = validateChainInput(input, identity.userId)
    if (currentSession.deviceId !== candidate.deviceId) {
      throw new AppError(403, 'event_device_mismatch',
        'Batch device ID does not match the authenticated session')
    }
    if (candidate.sequence > 1) {
      // Resolve the full predecessor receipt by exact key, not an eventually
      // consistent list or shared head. Missing predecessor is retryable.
      const previous = await verifiedChainReceipt(identity.userId, {
        deviceId: candidate.deviceId, sequence: candidate.sequence - 1,
        ...candidate.previous,
      })
      if (!previous) {
        throw new AppError(503, 'event_chain_predecessor_not_visible',
          'Predecessor not visible: retain this batch and retry')
      }
      if (previous.sequence + 1 !== candidate.sequence) {
        throw new AppError(409, 'event_chain_sequence_conflict',
          'Predecessor is not the immediately preceding batch')
      }
    }
    const stored = await storage.putImmutableChainedBatch(
      identity.userId, candidate.deviceId, candidate.sequence,
      candidate.batchId, candidate.sha256, candidate)
    const confirmed = await verifiedChainReceipt(identity.userId, candidate)
    if (!stored || !confirmed) {
      throw new AppError(503, 'event_chain_unverified',
        'Chained batch lacks an independently verified receipt')
    }
    return {
      stored: true,
      accountId: identity.userId,
      deviceId: candidate.deviceId,
      sequence: candidate.sequence,
      batchId: candidate.batchId,
      sha256: candidate.sha256,
      attemptCount: candidate.events.length,
      predecessorVerified: true,
      convergenceComplete: false,
    }
  }

  /**
   * M2.10: authenticated device checkout DECLARATION pilot.
   * Requires an existing immutable event head and an exact current V4
   * revision/sha. This does NOT prove the caller's local IDB contents or
   * provide any authorization for automatic six-table merging.
   */
  async function issueChainedCheckout(token, input = {}) {
    requireChainPilot()
    const { identity, currentSession } = await authenticate(token)
    return issueDeviceCheckoutDeclaration({
      accountId: identity.userId, deviceId: currentSession.deviceId,
    }, input, {
      verifyExactCloudRevision: async (accountId, revision, fingerprint) => {
        if (accountId !== identity.userId) return false
        const current = storage.getLatestRevisionMeta
          ? await storage.getLatestRevisionMeta(accountId)
          : await storage.getLatestRevision(accountId)
        return Boolean(current && current.revision === revision &&
          current.snapshot?.clientFormatVersion === V4_FORMAT &&
          current.snapshot.logicalFingerprint === fingerprint)
      },
      verifyExactChainedHead: async (accountId, head) => Boolean(
        accountId === identity.userId &&
        await verifiedChainReceipt(accountId, head),
      ),
      putImmutable: (accountId, deviceId, checkoutId, checksum, record) =>
        storage.putImmutableDeviceCheckout(
          accountId, deviceId, checkoutId, checksum, record),
      readExact: (accountId, deviceId, checkoutId, checksum) =>
        storage.getImmutableDeviceCheckout(
          accountId, deviceId, checkoutId, checksum),
    })
  }

  async function readChainedCheckout(token, selector = {}) {
    requireChainPilot()
    const { identity, currentSession } = await authenticate(token)
    return readDeviceCheckoutDeclaration({
      accountId: identity.userId, deviceId: currentSession.deviceId,
    }, selector, {
      readExact: (accountId, deviceId, checkoutId, checksum) =>
        storage.getImmutableDeviceCheckout(
          accountId, deviceId, checkoutId, checksum),
    })
  }

  async function readChainedLearningBatch(token, selector = {}) {
    requireChainPilot()
    const { identity } = await authenticate(token)
    if (!EVENT_DEVICE_ID.test(selector.deviceId) ||
        !EVENT_BATCH_UUID.test(selector.batchId) ||
        !EVENT_SHA.test(selector.sha256) ||
        !Number.isSafeInteger(selector.sequence) ||
        selector.sequence < 1 || selector.sequence > MAX_EVENT_SEQUENCE) {
      throw new AppError(400, 'invalid_event_chain_selector', 'Invalid chained batch receipt')
    }
    const batch = await verifiedChainReceipt(identity.userId, selector)
    if (!batch) throw new AppError(404, 'event_chain_not_visible',
      'Chained batch receipt not visible')
    return { batch, convergenceComplete: false }
  }

  async function verifyChainedLearningHistory(token, selector = {}) {
    requireChainPilot()
    const { identity } = await authenticate(token)
    if (!EVENT_DEVICE_ID.test(selector.deviceId) ||
        !EVENT_BATCH_UUID.test(selector.batchId) ||
        !EVENT_SHA.test(selector.sha256) ||
        !Number.isSafeInteger(selector.sequence) ||
        selector.sequence < 1 || selector.sequence > 128) {
      throw new AppError(400, 'invalid_event_chain_selector',
        'Invalid receipt or history exceeds bounded verification window')
    }
    const seen = new Set()
    const attempts = new Map()
    let totalAttempts = 0
    const entries = []
    let current = selector
    while (current.sequence > 0) {
      const batch = await verifiedChainReceipt(identity.userId, current)
      if (!batch) {
        return {
          verified: false, reason: 'gap-or-stale-read', verifiedCount: entries.length,
          missing: current, convergenceComplete: false,
        }
      }
      if (seen.has(batch.sha256)) {
        throw new AppError(409, 'event_chain_cycle', 'Chained event cycle detected')
      }
      seen.add(batch.sha256)
      for (const event of batch.events) {
        const evidence = canonicalEventJson(event)
        const prior = attempts.get(event.attemptId)
        if (prior !== undefined && prior !== evidence) {
          throw new AppError(409, 'event_chain_attempt_conflict',
            'Same attempt UUID has contradictory evidence in linked batches')
        }
        attempts.set(event.attemptId, evidence)
        totalAttempts += 1
      }
      entries.push({ sequence: batch.sequence,
        batchId: batch.batchId, sha256: batch.sha256 })
      if (batch.sequence === 1) {
        return {
          verified: true, reason: 'linked-to-genesis', verifiedCount: entries.length,
          uniqueAttemptCount: attempts.size,
          duplicateAttemptCount: totalAttempts - attempts.size,
          receipts: entries.reverse(), convergenceComplete: false,
          // Complete *one claimed device chain*, not all devices or forks.
          deviceChainOnly: true,
        }
      }
      current = { deviceId: batch.deviceId, sequence: batch.sequence - 1,
        ...batch.previous }
    }
    throw new AppError(503, 'event_chain_integrity_failed',
      'Sequence ended without a verified genesis batch')
  }


  /**
   * M3.5: validate a caller-WITNESSED set of immutable per-device heads.
   * This gives deterministic integrity evidence, NOT a complete account
   * discovery proof: an eventually consistent Blob list may hide other heads.
   * No V4 snapshot or learning state is written by this operation.
   */
  async function verifyWitnessedChainSet(token, input = {}) {
    requireChainPilot()
    const { identity } = await authenticate(token)
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        !Array.isArray(input.heads) || input.heads.length < 1 ||
        input.heads.length > 4) {
      throw new AppError(400, 'invalid_event_head_set',
        'Provide between one and four explicit immutable device heads')
    }
    const uniqueHeads = new Map()
    for (const head of input.heads) {
      if (!head || typeof head !== 'object' || Array.isArray(head) ||
          Object.keys(head).sort().join(',') !==
            'batchId,deviceId,sequence,sha256' ||
          !EVENT_DEVICE_ID.test(head.deviceId) ||
          !EVENT_BATCH_UUID.test(head.batchId) ||
          !EVENT_SHA.test(head.sha256) ||
          !Number.isSafeInteger(head.sequence) ||
          head.sequence < 1 || head.sequence > 128) {
        throw new AppError(400, 'invalid_event_head_set',
          'Each witnessed head must be a bounded exact receipt')
      }
      const key = [head.deviceId, head.sequence, head.batchId, head.sha256].join(':')
      uniqueHeads.set(key, head)
    }
    const heads = [...uniqueHeads.values()].sort((a, b) =>
      a.deviceId.localeCompare(b.deviceId) ||
      a.sequence - b.sequence ||
      a.batchId.localeCompare(b.batchId) ||
      a.sha256.localeCompare(b.sha256))
    const witnessed = new Map()
    const attempts = new Map()
    const chainLengths = []
    let receiptsRead = 0
    let duplicates = 0
    for (const head of heads) {
      let current = head
      let length = 0
      while (current) {
        // Limit exact Blob reads under the EdgeOne function deadline. Do not
        // transform an unverified partial prefix into a successful verdict.
        if (receiptsRead >= 128) {
          return { verified: false, reason: 'verification-budget-exceeded',
            receiptsRead, convergenceComplete: false }
        }
        const batch = await verifiedChainReceipt(identity.userId, current)
        receiptsRead += 1
        if (!batch) {
          return { verified: false, reason: 'gap-or-stale-read',
            missing: current, receiptsRead, convergenceComplete: false }
        }
        const deviceSequence = batch.deviceId + ':' + batch.sequence
        const existing = witnessed.get(deviceSequence)
        if (existing && existing !== batch.sha256) {
          throw new AppError(409, 'event_chain_fork_conflict',
            'Witnessed heads disagree on the same device sequence')
        }
        witnessed.set(deviceSequence, batch.sha256)
        for (const event of batch.events) {
          const canonical = canonicalEventJson(event)
          const previous = attempts.get(event.attemptId)
          if (previous !== undefined) {
            if (previous !== canonical) {
              throw new AppError(409, 'event_chain_attempt_conflict',
                'Witnessed devices disagree on immutable attempt evidence')
            }
            duplicates += 1
          } else {
            attempts.set(event.attemptId, canonical)
          }
        }
        length += 1
        current = batch.sequence === 1 ? null : {
          deviceId: batch.deviceId, sequence: batch.sequence - 1,
          ...batch.previous,
        }
      }
      chainLengths.push(length)
    }
    // Digest is independent of head order, retransmission, local Dexie IDs
    // and Blob listing order. It covers the witnessed event set ONLY.
    const canonicalSet = [...attempts].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0)
    const evidenceSha256 = sha256Hex(canonicalEventJson(canonicalSet))
    return {
      verified: true,
      reason: 'witnessed-heads-verified',
      witnessSetOnly: true,
      headCount: heads.length,
      deviceCount: new Set(heads.map(head => head.deviceId)).size,
      receiptsRead,
      chainLengths,
      uniqueAttemptCount: attempts.size,
      duplicateAttemptCount: duplicates,
      evidenceSha256,
      listingIsAuthoritative: false,
      convergenceComplete: false,
      publishReady: false,
    }
  }

  async function observeChainedLearningReceipts(token) {
    requireChainPilot()
    const { identity } = await authenticate(token)
    if (typeof storage.observeImmutableChainedBatches !== 'function') {
      throw new Error('Chained receipt observation unavailable')
    }
    const view = await storage.observeImmutableChainedBatches(identity.userId)
    const grouped = new Map()
    const conflicts = []
    const byDevice = new Map()
    for (const receipt of view.receipts) {
      const key = receipt.deviceId + ':' + receipt.sequence
      const entries = grouped.get(key) || []
      entries.push(receipt)
      grouped.set(key, entries)
      const existing = byDevice.get(receipt.deviceId) || new Set()
      existing.add(receipt.sequence)
      byDevice.set(receipt.deviceId, existing)
    }
    for (const [key, receipts] of grouped) {
      if (new Set(receipts.map(item => item.batchId + ':' + item.sha256)).size > 1) {
        conflicts.push(key)
      }
    }
    const visibleGaps = []
    for (const [deviceId, numbers] of byDevice) {
      const maxSequence = Math.max(...numbers)
      // Bound listing to 512 items. We report gaps in a visible prefix, never
      // assert the missing objects do not exist in another POP.
      for (let seq = 1; seq <= maxSequence; seq += 1) {
        if (!numbers.has(seq)) visibleGaps.push(deviceId + ':' + seq)
      }
    }
    return {
      observed: view.receipts,
      observedCount: view.receipts.length,
      visibleForks: conflicts.sort(),
      visibleGaps: visibleGaps.sort(),
      truncated: view.truncated,
      listingIsAuthoritative: false,
      convergenceComplete: false,
    }
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
      storageEncoding: snapshot.payloadEncoding === 'binary' ? 'binary' : 'base64',
    }
  }

  async function deleteAccount(token, currentPassword) {
    const { identity, currentAuth } = await authenticate(token)
    if (credentials?.matches(identity)) {
      throw new AppError(403, 'administrator_protected', 'Administrator account cannot be deleted')
    }

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
    const current = storage.getLatestRevisionMeta
      ? await storage.getLatestRevisionMeta(identity.userId)
      : await storage.getLatestRevision(identity.userId)
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
      payloadBase64: current.snapshot.payloadBase64 ||
        (Buffer.isBuffer(current.snapshot.payloadBytes)
          ? current.snapshot.payloadBytes.toString('base64') : null),
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
  async function putSyncV4(token, input = {}, recovery = false) {
    const { identity } = await authenticate(token)
    // In pilot auth mode multiple valid writers share one V4 revision slot,
    // whose EdgeOne Blob onlyIfNew is NOT atomic. Fail closed until the M2/M3
    // append-only reconciliation protocol provides a no-loss commit path.
    if (multiSessionEnabled) {
      throw new AppError(503, 'multi_device_merge_not_ready',
        'Concurrent-device V4 uploads are disabled until lossless merge is available')
    }
    const baseRevision = input.baseRevision
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
      throw new AppError(400, 'invalid_base_revision', 'V4 baseRevision must be a non-negative safe integer')
    }
    if (input.clientFormatVersion !== V4_FORMAT) {
      throw new AppError(400, 'unsupported_sync_format', 'V4 endpoint requires qwerty-backup-v4')
    }
    const native = Buffer.isBuffer(input.payloadBytes)
    const payload = native ? input.payloadBytes :
      validatePayloadBase64(input.payloadBase64, maxSyncBytes)
    if (payload.length > maxSyncBytes || payload.length < 2 ||
        payload[0] !== 0x1f || payload[1] !== 0x8b) {
      throw new AppError(400, 'invalid_payload', 'Sync V4 payload must be bounded gzip')
    }
    let verified
    try {
      verified = verifyCompressedV4(payload, identity.userId, input.logicalFingerprint)
    } catch (error) {
      throw new AppError(400, 'invalid_v4_workspace',
        error instanceof Error ? error.message : 'Invalid Backup V4 workspace')
    }

    let current
    try {
      current = storage.getLatestRevisionMeta
        ? await storage.getLatestRevisionMeta(identity.userId)
        : await storage.getLatestRevision(identity.userId)
    } catch {
      throw new AppError(503, 'snapshot_metadata_read_failed',
        'Unable to check V4 revision before write; no upload was attempted')
    }
    const currentRevision = current ? current.revision : 0
    if (currentRevision !== baseRevision) {
      throw new AppError(409, 'sync_conflict', 'Remote data changed', {
        current: metaFromSnapshot(current?.snapshot || null),
      })
    }
    if (recovery) {
      // Separate explicit recovery endpoint ONLY. Neither the ordinary V2
      // endpoint nor a forged field in its request can set this capability.
      // The user must have inspected and backed up the exact remote revision.
      const prior = current?.snapshot
      const mode = input.recoveryMode
      const expectedFormat = mode === 'replace-v4' ? V4_FORMAT : null
      if (!prior || !expectedFormat ||
          prior.clientFormatVersion !== expectedFormat ||
          input.expectedRemoteFormat !== expectedFormat ||
          typeof input.expectedRemoteSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(input.expectedRemoteSha256) ||
          input.expectedRemoteSha256 !== prior.dataSha256 ||
          input.accountConfirmation !== identity.userId ||
          (!/^[a-f0-9]{64}$/.test(input.expectedRemoteLogicalFingerprint) ||
            input.expectedRemoteLogicalFingerprint !== prior.logicalFingerprint)) {
        throw new AppError(409, 'recovery_precondition_failed',
          'Explicit recovery confirmation or pinned cloud evidence did not match')
      }
    }
    if (!recovery && current && current.snapshot.clientFormatVersion !== V4_FORMAT) {
      throw new AppError(409, 'unsupported_cloud_format',
        'Only V4 cloud records are supported; old data remains untouched', {
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
      payloadEncoding: native ? 'binary' : 'base64',
      ...(native ? { payloadBytes: payload } :
        { payloadBase64: input.payloadBase64 }),
      deviceId: sanitizeDeviceId(input.deviceId),
      clientFormatVersion: V4_FORMAT,
    }
    // Best-effort revision creation detects visible conflicts, but EdgeOne
    // Blob onlyIfNew is NOT an atomic CAS. Production has one active session;
    // the independent multi-session pilot explicitly rejects V4 writes above.
    // M3 must replace shared-revision races with a no-loss event protocol.
    let created
    try {
      created = await storage.createRevision(identity.userId, revision, snapshot)
    } catch (error) {
      // Preserve ambiguity: NEVER retry with another payload after a transport
      // error. Client must first re-read revision/SHA/fingerprint.
      if (error?.name === 'SnapshotBlobStageError') {
        throw new AppError(503, 'snapshot_blob_stage_failed',
          'V4 Blob storage unavailable; recheck remote metadata before retrying',
          { stage: error.stage, partIndex: error.partIndex })
      }
      throw error
    }
    if (!created) {
      const latest = storage.getLatestRevisionMeta
        ? await storage.getLatestRevisionMeta(identity.userId)
        : await storage.getLatestRevision(identity.userId)
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

  /**
   * New binary transport: no Base64 in the client, Maker staging, V4
   * validator, or persisted Blob. Old V4 data remains read compatible.
   */
  async function getSyncV4BinaryManifest(token) {
    const { identity } = await authenticate(token)
    const latest = await storage.getLatestRevisionMeta(identity.userId)
    const snapshot = latest?.snapshot
    const layout = snapshot?.chunkedPayload
    if (!snapshot || layout?.version !== 3 ||
        snapshot.clientFormatVersion !== V4_FORMAT ||
        snapshot.payloadEncoding !== 'binary') {
      throw new AppError(409, 'v4_binary_migration_required',
        'Cloud revision has not been migrated to binary')
    }
    return { ...metaFromSnapshot(snapshot), payloadEncoding: 'binary',
      chunkBytes: 512 * 1024,
      count: layout.count,
      partSha256s: layout.partSha256s }
  }

  async function getSyncV4BinaryPart(token, revision, sha, index) {
    const { identity } = await authenticate(token)
    const latest = await storage.getLatestRevisionMeta(identity.userId)
    if (!latest || latest.revision !== revision ||
        latest.snapshot?.dataSha256 !== sha ||
        latest.snapshot?.chunkedPayload?.version !== 3) {
      throw new AppError(409, 'sync_conflict',
        'Binary revision changed during download', {
          current: metaFromSnapshot(latest?.snapshot || null),
        })
    }
    const record = await storage.getBinaryRevisionPart(identity.userId,
      revision, sha, index)
    if (!record) {
      throw new AppError(503, 'v4_binary_part_unavailable',
        'Pinned binary Blob part cannot be read')
    }
    return record.bytes
  }

  async function migrateSyncV4Binary(token, expected = {}) {
    const { identity } = await authenticate(token)
    if (multiSessionEnabled) {
      throw new AppError(503, 'multi_device_merge_not_ready',
        'Binary format migration requires the same single-writer V4 safeguard')
    }
    let latest
    try {
      latest = await storage.getLatestRevisionMeta(identity.userId)
    } catch {
      // A storage read failure is an unknown cloud state, not permission to
      // retry a write or to tell the client migration has already completed.
      throw new AppError(503, 'v4_migration_metadata_unavailable',
        'Cannot verify the latest migration revision; read cloud metadata again')
    }
    const snapshot = latest?.snapshot
    if (!snapshot || snapshot.clientFormatVersion !== V4_FORMAT) {
      throw new AppError(409, 'unsupported_cloud_format',
        'Only existing Backup V4 can be migrated to binary')
    }
    if (snapshot.payloadEncoding === 'binary' &&
        snapshot.chunkedPayload?.version === 3) {
      // Idempotence requires evidence of THIS exact migration, not merely
      // any newer binary snapshot. Otherwise a stale client can mistake an
      // unrelated V4 revision for its own successfully completed migration.
      if (!Number.isSafeInteger(expected.baseRevision) ||
          expected.baseRevision + 1 !== latest.revision ||
          expected.payloadSha256 !== snapshot.dataSha256 ||
          expected.logicalFingerprint !== snapshot.logicalFingerprint ||
          snapshot.deviceId !== 'qwerty-binary-storage-migration') {
        throw new AppError(409, 'sync_conflict',
          'Binary cloud revision does not match the pinned migration', {
            current: metaFromSnapshot(snapshot),
          })
      }
      return { ...metaFromSnapshot(snapshot), migrated: false }
    }
    if (!Number.isSafeInteger(expected.baseRevision) ||
        expected.baseRevision !== latest.revision ||
        expected.payloadSha256 !== snapshot.dataSha256 ||
        expected.logicalFingerprint !== snapshot.logicalFingerprint) {
      throw new AppError(409, 'sync_conflict',
        'Migration must pin the exact existing cloud revision and evidence', {
          current: metaFromSnapshot(snapshot),
        })
    }
    const full = await storage.getLatestRevision(identity.userId)
    if (!full || full.revision !== latest.revision ||
        full.snapshot.dataSha256 !== snapshot.dataSha256 ||
        typeof full.snapshot.payloadBase64 !== 'string') {
      throw new AppError(503, 'v4_migration_source_unavailable',
        'Old revision readback could not be verified')
    }
    const bytes = validatePayloadBase64(full.snapshot.payloadBase64, maxSyncBytes)
    if (crypto.createHash('sha256').update(bytes).digest('hex') !==
        snapshot.dataSha256) {
      throw new AppError(503, 'v4_migration_source_unverified',
        'Old revision SHA does not match stored evidence')
    }
    const result = await putSyncV4(token, {
      baseRevision: latest.revision,
      clientFormatVersion: V4_FORMAT,
      logicalFingerprint: snapshot.logicalFingerprint,
      deviceId: 'qwerty-binary-storage-migration',
      payloadBytes: bytes,
    })
    return { ...result, migrated: true }
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
    revokeSession,
    publishLearningBatch,
    readLearningBatch,
    observeLearningBatchReceipts,
    publishChainedLearningBatch,
    readChainedLearningBatch,
    issueChainedCheckout,
    readChainedCheckout,
    verifyChainedLearningHistory,
    verifyWitnessedChainSet,
    observeChainedLearningReceipts,
    deleteAccount,
    syncMeta,
    getSync,
    putSync,
    putSyncV4,
    putSyncV4Recovery: (token, input) => putSyncV4(token, input, true),
    putSyncV4Binary: (token, input) => putSyncV4(token, input, false),
    putSyncV4BinaryRecovery: (token, input) => putSyncV4(token, input, true),
    migrateSyncV4Binary, getSyncV4BinaryManifest, getSyncV4BinaryPart,
    cleanupTestUser,
  }
}
