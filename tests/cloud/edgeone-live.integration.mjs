/* eslint-env node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { getStore, listStores } from '@edgeone/pages-blob'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'

const baseUrlInput = String(process.env.QWERTY_SYNC_BASE_URL || '').trim()
const projectId = process.env.EDGEONE_PROJECT_ID || ''
const apiToken = process.env.EDGEONE_API_TOKEN || ''
const storeName = process.env.BLOB_STORE_NAME || 'qwerty-data'

if (!baseUrlInput) throw new Error('QWERTY_SYNC_BASE_URL is required')

const baseUrl = new URL(baseUrlInput)

async function verifyAdminBlobCredential() {
  try {
    await listStores({
      projectId,
      token: apiToken,
      consistency: 'strong',
    })
  } catch (error) {
    const message = error?.message || String(error)
    throw new Error(
      `EDGEONE_API_TOKEN credential check failed for project ${projectId}: ${message}. Use a Makers API Token created from the EdgeOne Makers API Token page, not eo_token or a TencentCloud SecretKey.`,
    )
  }
}

function apiUrl(path) {
  const url = new URL(path, `${baseUrl.origin}/`)
  for (const [key, value] of baseUrl.searchParams.entries()) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}
if (!projectId) throw new Error('EDGEONE_PROJECT_ID is required for real-Blob verification/cleanup')
if (!apiToken) throw new Error('EDGEONE_API_TOKEN is required for real-Blob verification/cleanup')

const store = getStore({
  name: storeName,
  projectId,
  token: apiToken,
  consistency: 'strong',
})
const storage = createEdgeOneBlobStorage(store)
const cleanupService = createBackendService({ storage })

const username = `edgeone_test_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`
let password = `EdgeOne-Test-A9-${crypto.randomBytes(8).toString('hex')}`
let userId = null

const accessCookies = new Map()

function captureAccessCookies(headers) {
  const setCookies =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get('set-cookie')].filter(Boolean)

  for (const setCookie of setCookies) {
    const pair = setCookie.split(';', 1)[0]
    const separator = pair.indexOf('=')
    if (separator <= 0) continue

    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()

    if (!name) continue
    if (value) accessCookies.set(name, value)
    else accessCookies.delete(name)
  }
}

function accessCookieHeader() {
  return [...accessCookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

async function fetchWithAccessCookies(url, init = {}) {
  let currentUrl = url
  let method = init.method || 'GET'
  let body = init.body
  const baseHeaders = new Headers(init.headers || {})
  if (!baseHeaders.has('User-Agent')) {
    baseHeaders.set(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36',
    )
  }

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const headers = new Headers(baseHeaders)
    const cookie = accessCookieHeader()
    if (cookie) headers.set('Cookie', cookie)

    const response = await fetch(currentUrl, {
      ...init,
      method,
      body,
      headers,
      redirect: 'manual',
    })

    captureAccessCookies(response.headers)

    if (![301, 302, 303, 307, 308].includes(response.status)) return response

    const location = response.headers.get('location')
    if (!location) return response
    if (redirectCount === 5) {
      throw new Error('EdgeOne access protection exceeded 5 redirects')
    }

    currentUrl = new URL(location, currentUrl).toString()

    if (response.status === 303 && method !== 'GET' && method !== 'HEAD') {
      method = 'GET'
      body = undefined
      baseHeaders.delete('Content-Type')
    }
  }

  throw new Error('unreachable EdgeOne access redirect state')
}

async function primeEdgeOneAccessSession() {
  const response = await fetchWithAccessCookies(baseUrl.toString(), {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    },
  })

  // Consume the body so the connection can be cleanly reused. A 200 page or
  // JSON response is sufficient; this step exists only to capture EdgeOne's
  // protected-preview access cookie before POST/PUT API calls.
  await response.arrayBuffer().catch(() => {})

  if (response.status >= 400) {
    throw new Error(
      `EdgeOne protected-access bootstrap failed with HTTP ${response.status}`,
    )
  }
}

async function request(path, { method = 'GET', token, body, headers: extraHeaders = {} } = {}) {
  const headers = { Accept: 'application/json', ...extraHeaders }

  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetchWithAccessCookies(apiUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  let json

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new Error(
      `${method} ${path} returned non-JSON HTTP ${response.status}: ${text.slice(0, 300)}`,
    )
  }

  return { status: response.status, json, headers: response.headers }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForBackendCapability(capability, timeoutMs = 8 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs
  let lastCapabilities = []

  while (Date.now() < deadline) {
    const health = await request('/api/health')
    if (health.status === 200 && health.json?.ok) {
      lastCapabilities = Array.isArray(health.json.capabilities)
        ? health.json.capabilities
        : []

      if (lastCapabilities.includes(capability)) return health
    }

    await sleep(10_000)
  }

  throw new Error(
    `Timed out waiting for deployed backend capability ${capability}; last capabilities: ${JSON.stringify(lastCapabilities)}`,
  )
}

async function listVersions(prefix) {
  const { blobs = [] } = await store.list({
    prefix,
    consistency: 'strong',
  })

  return blobs
    .map((blob) => versionFromKey(blob.key))
    .filter((version) => version !== null)
    .sort((left, right) => left - right)
}

function payload(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

function versionFromKey(key) {
  const match = /\/(\d{12})\.json$/.exec(key)
  return match ? Number(match[1]) : null
}

try {
  await primeEdgeOneAccessSession()

  const health = await waitForBackendCapability('application-auth-rate-limit-v1')
  assert.equal(health.status, 200)
  assert.equal(health.json?.ok, true)
  assert.equal(health.json?.authMode, 'single-active-session')
  assert.ok(health.json.capabilities.includes('bounded-auth-history-v1'))
  assert.ok(health.json.capabilities.includes('same-origin-cors-default-v1'))
  assert.ok(health.json.capabilities.includes('application-auth-rate-limit-v1'))

  await verifyAdminBlobCredential()

  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username,
      password,
      deviceId: 'edgeone-live-register',
    },
  })

  assert.equal(
    registered.status,
    201,
    `register failed: ${JSON.stringify(registered.json)}`,
  )
  assert.equal(registered.json?.ok, true)
  assert.ok(registered.json?.token)
  userId = registered.json.user.userId

  const registerToken = registered.json.token

  const meRegistered = await request('/api/auth/me', { token: registerToken })
  assert.equal(meRegistered.status, 200)

  const firstLogin = await request('/api/auth/login', {
    method: 'POST',
    body: {
      username,
      password,
      deviceId: 'edgeone-live-a',
    },
  })

  assert.equal(firstLogin.status, 200)
  const firstLoginToken = firstLogin.json.token

  const revokedRegistration = await request('/api/auth/me', { token: registerToken })
  assert.equal(revokedRegistration.status, 401)
  assert.equal(revokedRegistration.json?.error, 'session_revoked')

  const secondLogin = await request('/api/auth/login', {
    method: 'POST',
    body: {
      username,
      password,
      deviceId: 'edgeone-live-b',
    },
  })

  assert.equal(secondLogin.status, 200)
  let activeToken = secondLogin.json.token

  const revokedFirstLogin = await request('/api/auth/me', { token: firstLoginToken })
  assert.equal(revokedFirstLogin.status, 401)
  assert.equal(revokedFirstLogin.json?.error, 'session_revoked')

  for (let index = 0; index < 3; index += 1) {
    const extraLogin = await request('/api/auth/login', {
      method: 'POST',
      body: {
        username,
        password,
        deviceId: `edgeone-live-extra-${index}`,
      },
    })
    assert.equal(
      extraLogin.status,
      200,
      `extra login ${index} failed: ${JSON.stringify(extraLogin.json)}`,
    )
    activeToken = extraLogin.json.token
  }

  const usernameHash = activeToken.split('.')[1]
  const retainedSessionsAfterLogins = await listVersions(
    `accounts/${usernameHash}/sessions/`,
  )
  assert.deepEqual(retainedSessionsAfterLogins, [4, 5, 6])

  const meta0 = await request('/api/sync/meta', { token: activeToken })
  assert.equal(meta0.status, 200)
  assert.equal(meta0.json?.revision, 0)

  let baseRevision = 0
  let latestPayload = null

  for (let revision = 1; revision <= 6; revision += 1) {
    latestPayload = payload({
      revision,
      source: 'edgeone-live-integration',
      value: `snapshot-${revision}`,
    })

    const uploaded = await request('/api/sync', {
      method: 'PUT',
      token: activeToken,
      body: {
        baseRevision,
        payloadBase64: latestPayload,
        deviceId: 'edgeone-live-b',
        clientFormatVersion: 'integration-v1',
      },
    })

    assert.equal(uploaded.status, 200)
    assert.equal(uploaded.json?.revision, revision)
    baseRevision = revision
  }

  const stale = await request('/api/sync', {
    method: 'PUT',
    token: activeToken,
    body: {
      baseRevision: 5,
      payloadBase64: payload({ stale: true }),
      deviceId: 'edgeone-live-b',
      clientFormatVersion: 'integration-v1',
    },
  })

  assert.equal(stale.status, 409)
  assert.equal(stale.json?.error, 'sync_conflict')

  const downloaded = await request('/api/sync', { token: activeToken })
  assert.equal(downloaded.status, 200)
  assert.equal(downloaded.json?.revision, 6)
  assert.equal(downloaded.json?.payloadBase64, latestPayload)

  const retainedRevisions = await listVersions(`users/${userId}/revisions/`)
  assert.deepEqual(retainedRevisions, [4, 5, 6])

  for (let index = 0; index < 3; index += 1) {
    const nextPassword = `EdgeOne-Changed-${index}-A9-${crypto
      .randomBytes(6)
      .toString('hex')}`

    const changed = await request('/api/auth/change-password', {
      method: 'POST',
      token: activeToken,
      body: {
        currentPassword: password,
        newPassword: nextPassword,
        deviceId: `edgeone-live-password-${index}`,
      },
    })

    assert.equal(changed.status, 200)
    activeToken = changed.json.token
    password = nextPassword
  }

  const retainedAuthVersions = await listVersions(
    `accounts/${usernameHash}/auth/`,
  )
  const retainedSessionVersions = await listVersions(
    `accounts/${usernameHash}/sessions/`,
  )

  assert.deepEqual(retainedAuthVersions, [3, 4])
  assert.deepEqual(retainedSessionVersions, [7, 8, 9])

  const afterPasswordChanges = await request('/api/sync', { token: activeToken })
  assert.equal(afterPasswordChanges.status, 200)
  assert.equal(afterPasswordChanges.json?.revision, 6)
  assert.equal(afterPasswordChanges.json?.payloadBase64, latestPayload)

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl: baseUrl.origin,
        userId,
        retainedRevisions,
        retainedAuthVersions,
        retainedSessionVersions,
        latestRevision: 6,
        singleActiveSession: true,
        sameOriginCorsCapability: true,
        applicationAuthRateLimitCapability: true,
      },
      null,
      2,
    ),
  )
} finally {
  try {
    const cleanup = await cleanupService.cleanupTestUser(username)
    console.log('EdgeOne integration cleanup:', cleanup)
  } catch (error) {
    console.error('EdgeOne integration cleanup failed:', error)
    process.exitCode = 1
  }
}
