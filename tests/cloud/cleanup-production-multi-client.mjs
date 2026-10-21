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

// A login is safe to retry on transient 5xx; it does not delete or
// overwrite learning data. Never blindly replay a possibly committed DELETE.
async function loginDisposable(username) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    let answer
    let lastError = null
    try {
      answer = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, deviceId: 'ci-e2e-cleanup' }),
      })
    } catch (error) {
      lastError = error
    }
    if (answer && ![429, 500, 502, 503, 504].includes(answer.response.status)) {
      return answer
    }
    if (attempt === 4) {
      throw new Error('Cleanup login remained unavailable after bounded retries: ' +
        (answer ? 'HTTP ' + answer.response.status :
          (lastError instanceof Error ? lastError.name : 'network_error')))
    }
    console.log('Transient cleanup login failure for disposable identity; retry', attempt)
    await new Promise(resolve => setTimeout(resolve, 500 * attempt))
  }
  throw new Error('Unreachable cleanup login state')
}

let failures = 0
for (const username of users) {
  try {
    // Only registered test users whose password we generated may be deleted.
    const login = await loginDisposable(username)
    if (login.response.status === 401 || login.result?.error === 'invalid_credentials') {
      console.log('Test identity does not exist or cannot be authenticated; no deletion:', username)
      continue
    }
    if (!login.response.ok || !login.result?.token) {
      throw new Error(`Cleanup authentication HTTP ${login.response.status}`)
    }
    if (login.result?.user?.username &&
        login.result.user.username !== username) {
      throw new Error('Cleanup login account identity mismatch')
    }
    const deleteWithToken = token => request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: password }),
    })
    let deletion = await deleteWithToken(login.result.token)
    if (!deletion.response.ok && deletion.response.status >= 500) {
      // A DELETE error may mean partially finished Blob operations.
      // Never issue an unverified blind repeat; first authenticate this
      // exact disposable owner again. Successful re-login proves the
      // account still exists with the expected generated credentials.
      await new Promise(resolve => setTimeout(resolve, 1500))
      const recovery = await loginDisposable(username)
      if (!recovery.response.ok ||
          recovery.result?.user?.username !== username ||
          !recovery.result?.token) {
        throw new Error('Cleanup outcome ambiguous: server 5xx, identity not reverified')
      }
      deletion = await deleteWithToken(recovery.result.token)
    }
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
