// RC 2026-09-30 review-multiword-remount production acceptance marker
// RC 2026-09-30 first-review-seeding-v4 production acceptance marker
/* eslint-env node */

import assert from 'node:assert/strict'

const baseUrlInput = String(process.env.QWERTY_SYNC_BASE_URL || '').trim()
const expectedThreshold = Number(process.env.RATE_LIMIT_THRESHOLD || 10)
const roundsToRun = Number(process.env.RATE_LIMIT_ROUNDS || 2)

if (!baseUrlInput) throw new Error('QWERTY_SYNC_BASE_URL is required')
if (!Number.isInteger(expectedThreshold) || expectedThreshold < 1) {
  throw new Error('RATE_LIMIT_THRESHOLD must be a positive integer')
}
if (!Number.isInteger(roundsToRun) || roundsToRun < 1 || roundsToRun > 4) {
  throw new Error('RATE_LIMIT_ROUNDS must be an integer between 1 and 4')
}

const baseUrl = new URL(baseUrlInput)
const accessCookies = new Map()

function apiUrl(path) {
  const url = new URL(path, `${baseUrl.origin}/`)
  for (const [key, value] of baseUrl.searchParams.entries()) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

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

  await response.arrayBuffer().catch(() => {})

  if (response.status >= 400) {
    throw new Error(
      `EdgeOne protected-access bootstrap failed with HTTP ${response.status}`,
    )
  }
}

async function getJson(path) {
  const response = await fetchWithAccessCookies(apiUrl(path), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

  const text = await response.text()
  let json = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // Keep null; caller reports the HTTP/body mismatch.
  }

  return { response, json, text }
}

async function postJson(path, body) {
  const response = await fetchWithAccessCookies(apiUrl(path), {
    method: 'POST',
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await response.text()
  let json = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // Keep null; assertions report a body preview.
  }

  return {
    status: response.status,
    json,
    retryAfter: response.headers.get('retry-after'),
    bodyPreview: text.slice(0, 200),
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForCapability(capability, timeoutMs = 8 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs
  let lastCapabilities = []

  while (Date.now() < deadline) {
    const health = await getJson('/api/health')

    if (health.response.status === 200 && health.json?.ok) {
      lastCapabilities = Array.isArray(health.json.capabilities)
        ? health.json.capabilities
        : []

      if (lastCapabilities.includes(capability)) return
    }

    await sleep(10_000)
  }

  throw new Error(
    `Timed out waiting for ${capability}; last capabilities=${JSON.stringify(lastCapabilities)}`,
  )
}

async function alignToFreshMinuteWindow() {
  const seconds = Math.floor(Date.now() / 1000) % 60
  const waitSeconds = seconds <= 2 ? 0 : 62 - seconds

  if (waitSeconds > 0) {
    console.log(`Waiting ${waitSeconds}s for a fresh fixed rate-limit window...`)
    await sleep(waitSeconds * 1000)
  }
}

async function runRound(round) {
  await alignToFreshMinuteWindow()

  const invalidRegisterBody = {
    username: 'x',
    password: 'RateLimit-Probe-A9',
    deviceId: 'rate-limit-gate',
  }

  const statuses = []

  for (let attempt = 1; attempt <= expectedThreshold; attempt += 1) {
    const result = await postJson('/api/auth/register', invalidRegisterBody)
    statuses.push(result.status)

    assert.equal(
      result.status,
      400,
      `round ${round} attempt ${attempt} should reach application validation before threshold; got HTTP ${result.status}: ${result.bodyPreview}`,
    )
    assert.equal(result.json?.error, 'invalid_username')
  }

  const blocked = await postJson('/api/auth/register', invalidRegisterBody)
  statuses.push(blocked.status)

  assert.equal(
    blocked.status,
    429,
    `round ${round} request ${expectedThreshold + 1} should be rate-limited: ${blocked.bodyPreview}`,
  )
  assert.equal(blocked.json?.error, 'auth_rate_limited')

  const retryAfter = Number(blocked.retryAfter)
  assert.ok(
    Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60,
    `round ${round} invalid Retry-After header: ${blocked.retryAfter}`,
  )

  const loginAfterTrigger = await postJson('/api/auth/login', {
    username: 'x',
    password: 'RateLimit-Probe-A9',
    deviceId: 'rate-limit-gate',
  })

  assert.equal(
    loginAfterTrigger.status,
    429,
    `round ${round} login should share register counter: ${loginAfterTrigger.bodyPreview}`,
  )
  assert.equal(loginAfterTrigger.json?.error, 'auth_rate_limited')

  const healthAfter = await getJson('/api/health')
  assert.equal(
    healthAfter.response.status,
    200,
    `round ${round} limiter must not affect /api/health: ${healthAfter.text.slice(0, 200)}`,
  )
  assert.equal(healthAfter.json?.ok, true)

  return {
    round,
    registerStatuses: statuses,
    retryAfterSeconds: retryAfter,
    loginStatusAfterTrigger: loginAfterTrigger.status,
    healthStatusAfterTrigger: healthAfter.response.status,
  }
}

await primeEdgeOneAccessSession()
await waitForCapability('duplicate-register-protection-v1')

const healthBefore = await getJson('/api/health')
assert.equal(healthBefore.response.status, 200)
assert.equal(healthBefore.json?.ok, true)
assert.ok(healthBefore.json.capabilities.includes('hybrid-auth-rate-limit-v3'))
assert.ok(healthBefore.json.capabilities.includes('blob-transient-retry-v1'))
assert.ok(healthBefore.json.capabilities.includes('duplicate-register-protection-v1'))

const rounds = []
for (let round = 1; round <= roundsToRun; round += 1) {
  rounds.push(await runRound(round))
}

console.log(
  JSON.stringify(
    {
      ok: true,
      limiter: 'hybrid-auth-rate-limit-v3',
      expectedThreshold,
      rounds,
    },
    null,
    2,
  ),
)
