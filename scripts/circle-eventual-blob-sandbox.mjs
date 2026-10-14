/* eslint-env node */
// Explicitly isolated EdgeOne Blob event-log smoke test (not a CAS test).
// No Maker deployment. NEVER use a production or account-data store.
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { getStore } from '@edgeone/pages-blob'
import { createCircleEventLog, digest } from '../cloud-functions/_shared/circle/event-log.js'
import { reduceCircle } from '../cloud-functions/_shared/circle/reducer.js'

if (process.env.CIRCLE_EVENTUAL_BLOB_ACK !== 'RUN_EVENTUAL_CIRCLE_SANDBOX_ONLY' ||
    process.env.CIRCLE_TEST_BLOB_STORE !== 'qwerty-circle-sandbox' ||
    process.env.CIRCLE_TEST_PROJECT_ID !== 'makers-yggquqwubqul' ||
    !process.env.CIRCLE_TEST_API_TOKEN) {
  throw new Error('Circle eventual Blob probe requires explicit isolated sandbox authorization')
}

const store = getStore({
  name: 'qwerty-circle-sandbox',
  projectId: 'makers-yggquqwubqul',
  token: process.env.CIRCLE_TEST_API_TOKEN,
  consistency: 'strong',
})
const circleId = crypto.randomBytes(12).toString('hex')
const root = 'social/v2/circles/' + circleId + '/events/'
const writtenKeys = new Set()
const rawSetJSON = store.setJSON.bind(store)
const guardedStore = {
  async setJSON(key, value, options) {
    if (!key.startsWith(root) || !/^[a-f0-9]{32}\.json$/.test(key.slice(root.length)) ||
        options !== undefined) throw new Error('Unsafe sandbox event write refused')
    // Track BEFORE calling the remote store: a transport failure may commit.
    writtenKeys.add(key)
    return rawSetJSON(key, value)
  },
  get: store.get.bind(store),
  list: store.list.bind(store),
}
const log = createCircleEventLog(guardedStore)
const totalJoins = 12
const result = {
  check: 'circle_eventual_blob_live_v1',
  storage: 'isolated-sandbox',
  circleIdLength: circleId.length,
  operations: 1 + totalJoins,
  casUsed: false,
  concurrency: totalJoins,
  converged: false,
  physicalKeysDistinct: false,
  cleanupConfirmed: false,
  deploymentTriggered: false,
}
let primaryError
try {
  const inviteHash = digest('probe-only-' + circleId)
  const creator = 'probe_owner_000001'
  await log.append({ circleId, actorUserId: creator, type: 'CIRCLE_CREATED',
    operationId: 'probe_create_0001',
    payload: { name: 'Isolated probe', softMemberLimit: 12, inviteHash } })
  const jobs = Array.from({ length: totalJoins }, (_, i) =>
    log.append({
      circleId, actorUserId: 'probe_guest_' + String(i).padStart(6, '0'),
      type: 'JOIN_REQUESTED', operationId: 'probe_join_00001',
      payload: { inviteHash },
    }))
  const submissions = await Promise.allSettled(jobs)
  assert.equal(submissions.filter((s) => s.status === 'fulfilled').length, totalJoins,
    'Some unique-key appends were not acknowledged')
  result.physicalKeysDistinct = writtenKeys.size === result.operations
  assert.equal(result.physicalKeysDistinct, true, 'Unique event key contract failed')
  // Every key is independently addressable. Multi-key listing can lag; retry
  // rather than interpreting a partial snapshot as permanent loss.
  const start = Date.now()
  let lastObserved = 0
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const events = await log.scan(circleId)
      lastObserved = events.length
      if (events.length === result.operations) {
        const view = reduceCircle(circleId, events)
        assert.equal(view.blocked, undefined, 'Reducer blocked complete probe set')
        assert.equal(view.members.length, result.operations)
        assert.equal(view.capacity.hardLimit, false)
        result.converged = true
        break
      }
    } catch {
      // A temporarily unreadable listed key MUST fail closed; retry the whole
      // scan, never skip one event and return a misleading authorized view.
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  result.elapsedMs = Date.now() - start
  result.lastObservedCount = lastObserved
  assert.equal(result.converged, true, 'Events not fully visible within bounded convergence window')
} catch (error) {
  primaryError = error
  result.primaryFailure = error?.name || 'Error'
} finally {
  const failures = []
  for (const key of writtenKeys) {
    try {
      await store.delete(key)
      const after = await store.get(key, { type: 'json', consistency: 'strong' })
      if (after !== null) failures.push(key)
    } catch { failures.push(key) }
  }
  result.cleanupConfirmed = failures.length === 0
  result.cleanupFailures = failures.length
  console.log(JSON.stringify(result))
}
if (primaryError || !result.cleanupConfirmed) {
  throw new Error('Circle eventual Blob sandbox gate failed; consult count-only report')
}
