/* eslint-env node */

import assert from 'node:assert/strict'

const baseUrlInput = String(process.env.QWERTY_SYNC_BASE_URL || '').trim()
const expectedThreshold = Number(process.env.RATE_LIMIT_THRESHOLD || 10)
const maxAttempts = Number(process.env.RATE_LIMIT_MAX_ATTEMPTS || expectedThreshold + 3)

if (!baseUrlInput) throw new Error('QWERTY_SYNC_BASE_URL is required')
if (!Number.isInteger(expectedThreshold) || expectedThreshold < 1) {
  throw new Error('RATE_LIMIT_THRESHOLD must be a positive integer')
}
if (!Number.isInteger(maxAttempts) || maxAttempts <= expectedThreshold) {
  throw new Error('RATE_LIMIT_MAX_ATTEMPTS must be greater than RATE_LIMIT_THRESHOLD')
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

async function request(path, body) {
  const response = await fetchWithAccessCookies(apiUrl(path), {
    method: 'POST',
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await response.text()
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    bodyPreview: text.slice(0, 160),
  }
}

function isRateLimited(response) {
  return response.status === 403 || response.status === 429
}

await primeEdgeOneAccessSession()

const health = await fetchWithAccessCookies(apiUrl('/api/health'), {
  method: 'GET',
  headers: { Accept: 'application/json' },
})
await health.arrayBuffer().catch(() => {})
assert.equal(health.status, 200, 'health must be reachable before the rate-limit probe')

const invalidRegisterBody = {
  username: 'x',
  password: 'RateLimit-Probe-A9',
  deviceId: 'rate-limit-gate',
}

const statuses = []
let blockedAt = null

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = await request('/api/auth/register', invalidRegisterBody)
  statuses.push(result.status)

  if (attempt === 1) {
    assert.equal(
      isRateLimited(result),
      false,
      `probe started from an already rate-limited state (HTTP ${result.status})`,
    )
    assert.equal(
      result.status,
      400,
      `expected application validation HTTP 400 before rate limit, got ${result.status}: ${result.bodyPreview}`,
    )
  }

  if (isRateLimited(result)) {
    blockedAt = attempt
    break
  }
}

assert.ok(
  blockedAt,
  `rate limit did not trigger within ${maxAttempts} register requests; statuses=${statuses.join(',')}`,
)

assert.ok(
  blockedAt >= expectedThreshold,
  `rate limit triggered unexpectedly early at request ${blockedAt}; expected baseline is around ${expectedThreshold + 1}`,
)

const loginAfterTrigger = await request('/api/auth/login', {
  username: 'x',
  password: 'RateLimit-Probe-A9',
  deviceId: 'rate-limit-gate',
})

assert.ok(
  isRateLimited(loginAfterTrigger),
  `login path was not covered by the triggered auth rule; got HTTP ${loginAfterTrigger.status}: ${loginAfterTrigger.bodyPreview}`,
)

const healthAfter = await fetchWithAccessCookies(apiUrl('/api/health'), {
  method: 'GET',
  headers: { Accept: 'application/json' },
})
await healthAfter.arrayBuffer().catch(() => {})

assert.equal(
  healthAfter.status,
  200,
  `rate-limit rule appears broader than auth endpoints; /api/health returned ${healthAfter.status}`,
)

console.log(
  JSON.stringify(
    {
      ok: true,
      expectedThreshold,
      maxAttempts,
      registerStatuses: statuses,
      blockedAt,
      loginStatusAfterTrigger: loginAfterTrigger.status,
      healthStatusAfterTrigger: healthAfter.status,
    },
    null,
    2,
  ),
)
