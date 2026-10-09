/* eslint-env node */
// Credential-only cleanup for disposable production E2E accounts.
// Does not depend on the EdgeOne management API token.
const baseUrl = process.env.QWERTY_SYNC_BASE_URL
const password = process.env.QWERTY_E2E_PASSWORD
const users = [
  process.env.QWERTY_E2E_USERNAME,
  process.env.QWERTY_E2E_USERNAME_B,
].filter(Boolean)

if (!baseUrl || !password || users.length !== 2 ||
    !users.every((u) => /^e2e_mc_[0-9]+_[0-9]+_[ab]$/.test(u)) ||
    new Set(users).size !== 2) {
  throw new Error('Refusing cleanup without exact, distinct CI disposable identities')
}

const origin = new URL(baseUrl)
if (origin.protocol !== 'https:') throw new Error('HTTPS endpoint required')

async function request(path, options = {}) {
  const response = await fetch(new URL(path, origin.origin), {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  })
  const result = await response.json().catch(() => null)
  return { response, result }
}

let failures = 0
for (const username of users) {
  try {
    // Only registered test users whose password we generated may be deleted.
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, deviceId: 'ci-e2e-cleanup' }),
    })
    if (login.response.status === 401 || login.result?.error === 'invalid_credentials') {
      console.log('Test identity does not exist or cannot be authenticated; no deletion:', username)
      continue
    }
    if (!login.response.ok || !login.result?.token) {
      throw new Error(`Cleanup authentication HTTP ${login.response.status}`)
    }
    const deletion = await request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${login.result.token}` },
      body: JSON.stringify({ currentPassword: password }),
    })
    if (!deletion.response.ok || deletion.result?.deleted?.accountDeleted !== true) {
      throw new Error(`Cleanup delete HTTP ${deletion.response.status}`)
    }
    console.log('Deleted disposable E2E cloud identity:', username)
  } catch (error) {
    failures++
    console.error('Failed to cleanup E2E identity:', username, String(error?.message || error))
  }
}
if (failures) process.exitCode = 1
