import crypto from 'node:crypto'

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

function base64UrlEncodeBuffer(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlEncodeJson(value) {
  return base64UrlEncodeBuffer(Buffer.from(JSON.stringify(value), 'utf8'))
}

function base64UrlDecodeToBuffer(value) {
  let base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) base64 += '='
  return Buffer.from(base64, 'base64')
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
  if (/[\x00-\x1f\x7f\s/\\?#%]/.test(normalizedUsername)) {
    throw new AppError(400, 'invalid_username', 'Username contains unsupported characters')
  }

  return { username, normalizedUsername }
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new AppError(400, 'invalid_password', 'Password must contain 8-128 characters')
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

export function createBackendService({
  storage,
  sessionSecret,
  sessionTtlSeconds = 7 * 24 * 60 * 60,
  maxSyncBytes = 4 * 1024 * 1024,
}) {
  if (!storage) throw new Error('storage is required')
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32) {
    throw new Error('APP_SESSION_SECRET must contain at least 32 characters')
  }

  async function getCurrentAuth(identity) {
    const latest = await storage.getLatestAuth(identity.usernameHash)
    return latest || identity.initialAuth
  }

  function issueSession(identity, authVersion) {
    const issuedAt = unixSeconds()
    const payload = {
      iss: 'qwerty-sync-gateway',
      sub: identity.userId,
      uah: identity.usernameHash,
      av: authVersion,
      iat: issuedAt,
      exp: issuedAt + sessionTtlSeconds,
    }
    const headerPart = base64UrlEncodeJson({ alg: 'HS256', typ: 'JWT' })
    const payloadPart = base64UrlEncodeJson(payload)
    const signingInput = `${headerPart}.${payloadPart}`
    const signature = crypto.createHmac('sha256', sessionSecret).update(signingInput).digest()
    return {
      token: `${signingInput}.${base64UrlEncodeBuffer(signature)}`,
      expiresAt: payload.exp,
      expiresIn: sessionTtlSeconds,
    }
  }

  function verifyTokenSignature(token) {
    if (typeof token !== 'string') throw new AppError(401, 'invalid_token', 'Invalid session token')
    const parts = token.split('.')
    if (parts.length !== 3) throw new AppError(401, 'invalid_token', 'Invalid session token')

    const signingInput = `${parts[0]}.${parts[1]}`
    const expected = crypto.createHmac('sha256', sessionSecret).update(signingInput).digest()
    let actual
    let payload

    try {
      actual = base64UrlDecodeToBuffer(parts[2])
      payload = JSON.parse(base64UrlDecodeToBuffer(parts[1]).toString('utf8'))
    } catch {
      throw new AppError(401, 'invalid_token', 'Invalid session token')
    }

    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      throw new AppError(401, 'invalid_token', 'Invalid session token')
    }
    if (
      !payload ||
      payload.iss !== 'qwerty-sync-gateway' ||
      typeof payload.sub !== 'string' ||
      typeof payload.uah !== 'string' ||
      typeof payload.av !== 'number'
    ) {
      throw new AppError(401, 'invalid_token', 'Invalid session token')
    }
    if (typeof payload.exp !== 'number' || payload.exp < unixSeconds()) {
      throw new AppError(401, 'session_expired', 'Session has expired')
    }
    return payload
  }

  async function authenticate(token) {
    const payload = verifyTokenSignature(token)
    const identity = await storage.getAccount(payload.uah)
    if (!identity || identity.status !== 'active' || identity.userId !== payload.sub) {
      throw new AppError(401, 'session_revoked', 'Session is no longer valid')
    }
    const currentAuth = await getCurrentAuth(identity)
    if (!currentAuth || currentAuth.version !== payload.av) {
      throw new AppError(401, 'session_revoked', 'Session is no longer valid')
    }
    return { payload, identity, currentAuth }
  }

  function publicUser(identity) {
    return { userId: identity.userId, username: identity.username, createdAt: identity.createdAt }
  }

  async function register(usernameInput, password) {
    const { username, normalizedUsername } = normalizeUsername(usernameInput)
    validatePassword(password)

    const usernameHash = sha256Hex(normalizedUsername)
    const initialAuth = {
      version: 1,
      password: await createPasswordRecord(password),
      createdAt: nowIso(),
    }
    const identity = {
      schemaVersion: ACCOUNT_SCHEMA_VERSION,
      userId: randomHex(16),
      username,
      normalizedUsername,
      usernameHash,
      initialAuth,
      status: 'active',
      createdAt: nowIso(),
    }

    const created = await storage.createAccount(usernameHash, identity)
    if (!created) throw new AppError(409, 'username_taken', 'Username is already registered')

    const session = issueSession(identity, 1)
    return { user: publicUser(identity), ...session }
  }

  async function login(usernameInput, password) {
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

    const session = issueSession(identity, currentAuth.version)
    return { user: publicUser(identity), ...session }
  }

  async function me(token) {
    const { identity } = await authenticate(token)
    return { user: publicUser(identity) }
  }

  async function changePassword(token, currentPassword, newPassword) {
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
    const created = await storage.createAuthVersion(identity.usernameHash, nextAuth.version, nextAuth)
    if (!created) {
      throw new AppError(409, 'account_update_conflict', 'Account changed concurrently, please retry')
    }

    const session = issueSession(identity, nextAuth.version)
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
      deviceId: snapshot.deviceId || null,
      clientFormatVersion: snapshot.clientFormatVersion || null,
    }
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
      return { ...metaFromSnapshot(null), payloadEncoding: 'base64', payloadBase64: null }
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
      throw new AppError(400, 'invalid_base_revision', 'baseRevision must be a non-negative integer')
    }

    const payload = validatePayloadBase64(input.payloadBase64, maxSyncBytes)
    const current = await storage.getLatestRevision(identity.userId)
    const currentRevision = current ? current.revision : 0

    if (baseRevision !== currentRevision) {
      throw new AppError(409, 'sync_conflict', 'Remote data has changed', {
        current: metaFromSnapshot(current ? current.snapshot : null),
      })
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
      deviceId: typeof input.deviceId === 'string' ? input.deviceId.slice(0, 128) : null,
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

    return metaFromSnapshot(snapshot)
  }

  async function cleanupTestUser(usernameInput) {
    const { normalizedUsername } = normalizeUsername(usernameInput)
    const usernameHash = sha256Hex(normalizedUsername)
    const identity = await storage.getAccount(usernameHash)
    if (!identity) return { accountDeleted: false, revisionsDeleted: 0, authDeleted: 0 }
    return storage.deleteUserData(usernameHash, identity.userId)
  }

  return {
    register,
    login,
    me,
    changePassword,
    syncMeta,
    getSync,
    putSync,
    cleanupTestUser,
  }
}
