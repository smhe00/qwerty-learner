/* eslint-env node */
// etest must advertise the enabled fixture gateway before any qualification writes.
import assert from 'node:assert/strict'
const base=process.env.QWERTY_SYNC_BASE_URL
assert.equal(new URL(base).origin,'https://t.smhe.cn')
const response=await fetch(new URL('/api/health',base),{cache:'no-store',signal:AbortSignal.timeout(15000)})
assert.equal(response.status,200)
const health=await response.json()
assert.ok(health.capabilities?.includes('account-handoff-blob-fixtures-v1'),'Server branch=etest is required; no fixture accounts created')
await import('./session-handoff-live.mjs')
