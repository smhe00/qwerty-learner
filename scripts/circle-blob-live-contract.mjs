/* eslint-env node */
// Manual only. NEVER run on qwerty-data or any production/user Blob store.
// Requires explicit environmental opt-in and a separate sandbox Store.
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { getStore } from '@edgeone/pages-blob'

const acknowledgement = 'RUN_CIRCLE_SANDBOX_ONLY'
const name = process.env.CIRCLE_TEST_BLOB_STORE
if (process.env.CIRCLE_BLOB_LIVE_ACK !== acknowledgement ||
    !name || !/^[a-z0-9-]{8,64}$/.test(name) ||
    !name.endsWith('-circle-sandbox') || name === 'qwerty-data') {
  throw new Error('Refusing live Blob writes: explicit isolated -circle-sandbox Store required')
}
const projectId = process.env.CIRCLE_TEST_PROJECT_ID
const token = process.env.CIRCLE_TEST_API_TOKEN
if (!projectId || !token) {
  throw new Error('Missing separate nonproduction EdgeOne test credentials')
}

const store = getStore({ name, projectId, token, consistency: 'strong' })
const second = getStore({ name, projectId, token, consistency: 'strong' })
const runId = crypto.randomBytes(12).toString('hex')
const prefix = `social-contract-probe/${runId}/`
const createdKeys = new Set()
let verdict = 'FAILED'
try {
  for (let round = 0; round < 4; round++) {
    const key = `${prefix}round-${round}.json`
    createdKeys.add(key)
    const contenders = Array.from({ length: 48 }, (_v, i) => ({
      runId, round, contender: i,
    }))
    const results = await Promise.allSettled(contenders.map((candidate, i) =>
      (i % 2 ? store : second).setJSON(key, candidate, { onlyIfNew: true })))
    const winners = contenders.filter((_candidate, i) => results[i].status === 'fulfilled')
    assert.equal(winners.length, 1,
      `round ${round}: multiple writes succeeded against the same key`)
    const actual = await second.get(key, { type: 'json', consistency: 'strong' })
    assert.deepEqual(actual, winners[0], `round ${round}: strong read differs`)
    const listing = await store.list({ prefix: key, consistency: 'strong' })
    assert.equal(listing.blobs.filter((blob) => blob.key === key).length, 1)
    await assert.rejects(() => second.setJSON(key,
      { runId, round, contender: 'must-not-overwrite' }, { onlyIfNew: true }))
    assert.deepEqual(await store.get(key, { type: 'json', consistency: 'strong' }),
      winners[0], 'Conflict must never overwrite committed value')
  }
  verdict = 'PASS'
  console.log(JSON.stringify({
    verdict, scope: 'single-process multi-client Blob conditional-create and strong read/list',
    rounds: 4, writersPerRound: 48, storeCategory: 'explicit sandbox',
    note: 'Does not prove multi-region distributed linearizability or privacy erasure',
  }))
} finally {
  const failures = []
  for (const key of createdKeys) {
    try {
      await store.delete(key)
      const after = await second.get(key, { type: 'json', consistency: 'strong' })
      if (after !== null) failures.push(`${key}: deletion not confirmed`)
    } catch (error) {
      failures.push(`${key}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failures.length) {
    console.error(JSON.stringify({ verdict: 'CLEANUP_INCOMPLETE', count: failures.length,
      keys: failures }))
    process.exitCode = 1
  }
}
