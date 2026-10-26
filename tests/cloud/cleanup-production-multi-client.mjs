import { cleanupDisposableAccount } from './disposable-account-cleanup.mjs'
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

let failures = 0
for (const username of users) {
  try {
    const result = await cleanupDisposableAccount({ baseUrl, username, password })
    console.log('DISPOSABLE_CLEANUP_PROOF', JSON.stringify(result))
  } catch (error) {
    failures++
    console.error('DISPOSABLE_CLEANUP_UNCONFIRMED', JSON.stringify({
      message: error.message, trace: error.trace || [],
    }))
  }
}
if (failures) process.exitCode = 1
