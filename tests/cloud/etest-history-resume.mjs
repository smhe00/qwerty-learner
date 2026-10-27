/* eslint-env node */
/** Isolated browser driver + real etest Blob; not full V4 adoption or physical-device proof. */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { cleanupDisposableAccount } from './disposable-account-cleanup.mjs'
import { retrySafeBodyRequest } from '../../cloud-functions/_shared/safe-body-retry.js'

const base = 'https://t.smhe.cn', sha = process.env.EXPECTED_SHA
assert.equal(process.env.GITHUB_REF_NAME, 'edgeone-test')
assert.match(sha || '', /^[a-f0-9]{40}$/)
assert.match(process.env.GITHUB_RUN_ID || '', /^\d+$/)
const username = 'e2e_hr_' + process.env.GITHUB_RUN_ID + '_' + (process.env.GITHUB_RUN_ATTEMPT || '1')
assert.ok(username.length <= 32)
const password = randomBytes(24).toString('base64url'), deviceId = 'qwerty-web-' + randomUUID()
let writeUnknown = false, account, browser
const failures = [], summaries = []
const safeCode = x => typeof x === 'string' && /^[a-z0-9_-]{1,100}$/.test(x) ? x : 'unknown'
async function call(path, method = 'GET', body, expected = 200) {
  const started = performance.now()
  if (method !== 'GET') writeUnknown = true
  const reply = await retrySafeBodyRequest(async () => {
    const response = await fetch(base + path, { method, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(90000), headers: { 'Content-Type': 'application/json',
        ...(account?.token ? { Authorization: 'Bearer ' + account.token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }, { path, method })
  console.log('HISTORY_LIVE_HTTP', JSON.stringify({ path: path.split('?')[0], method,
    status: reply.status, elapsedMs: Math.round(performance.now() - started), code: safeCode(reply.body?.error),
    requestId: reply.body?.requestId || null, receive: reply.body?.details?.receive || null,
    nonJson: reply.body === null }))
  assert.equal(reply.status, expected, path.split('?')[0] + ' HTTP ' + reply.status + ' ' + safeCode(reply.body?.error))
  if (method !== 'GET') writeUnknown = false
  return reply.body
}
async function version() {
  const response = await fetch(base + '/source-commit.txt?history_resume=' + Date.now(),
    { cache: 'no-store', signal: AbortSignal.timeout(20000) })
  const marker = (await response.text()).trim()
  assert.equal(response.status, 200); assert.match(marker, /^[a-f0-9]{7,40}$/); assert.ok(sha.startsWith(marker))
}
await version()
const compiled = await build({ stdin: { contents: `export { createHistoryContinuation } from './src/sync/history-verification-continuation';
export { historyCache } from './src/sync/history-verification-cache';
export { inspectWitnessedDeviceConvergence } from './src/sync/m3-witnessed-receiver';`, resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'historyProbe', target: 'es2020' })
try {
  const health = await call('/api/health')
  assert.equal(health.authMode, 'single-active-session')
  account = await call('/api/auth/register', 'POST', { username, password, deviceId }, 201)
  assert.ok(account.token && account.user?.userId)
  let head = null
  const expectedIds = []
  for (let sequence = 1; sequence <= 20; sequence++) {
    const event = { attemptId: randomUUID(), dict: 'synthetic-history-resume', word: 'synthetic' + sequence,
      timeStamp: 1800000000 + sequence, chapter: -1, timing: [], wrongCount: 0, mistakes: {},
      sourceMode: 'learn', learnItemKind: 'acquisition' }
    expectedIds.push(event.attemptId)
    const batch = await call('/api/sync/events/v2', 'POST', { deviceId, batchId: randomUUID(), sequence,
      previous: head ? { batchId: head.batchId, sha256: head.sha256 } : null, events: [event] }, 201)
    head = { deviceId: batch.deviceId, sequence: batch.sequence, batchId: batch.batchId, sha256: batch.sha256 }
    assert.equal(head.sequence, sequence)
  }
  browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  // Intercept only this synthetic driver document, never any API or app route.
  const driver = base + '/__history-resume-driver'
  await context.route(driver, route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><title>Isolated history continuation driver</title>' }))
  const page = await context.newPage()
  const open = async () => {
    if (page.url() === driver) await page.reload({ waitUntil: 'domcontentloaded' })
    else await page.goto(driver, { waitUntil: 'domcontentloaded' })
    await page.addScriptTag({ content: compiled.outputFiles[0].text })
  }
  const run = async label => {
    await version()
    await open()
    // If the document crashes, retain uncertainty; never reauthenticate for teardown.
    writeUnknown = true
    const result = await page.evaluate(async ({ token, userId, head, expectedIds }) => {
      const probe = globalThis.historyProbe
      let unknown = false, downloads = 0
      const request = async (path, body) => {
        if (body) unknown = true
        const response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store',
          signal: AbortSignal.timeout(90000), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}) })
        const data = await response.json()
        if (!response.ok) throw Object.assign(Error('history-request-failed'), { status: response.status, code: data.error })
        if (body) unknown = false
        return data
      }
      const before = await probe.historyCache.read(userId)
      const port = await probe.createHistoryContinuation({ accountId: userId, generation: 1, heads: [head],
        cache: probe.historyCache, assertOwner: async () => {}, canContinue: () => true,
        verify: cursor => request('/api/sync/events/v2/verify-set', { heads: [head], segmented: true, cursor }),
        read: receipt => { downloads++; return request('/api/sync/events/v2?' + new URLSearchParams({ ...receipt, sequence: String(receipt.sequence) })) } })
      const result = await probe.inspectWitnessedDeviceConvergence({ accountId: userId, heads: [head], localRecords: [], port })
      const after = await probe.historyCache.read(userId)
      const actual = result.remoteEvents?.map(row => row.attemptId).sort()
      return { status: result.status, reason: result.reason, completed: result.verifiedReceipts,
        total: result.totalReceipts, remoteCount: result.remoteAttemptCount, downloads, unknown,
        previousVerified: before?.verified ?? 0, cachedBatches: Object.keys(after?.batches || {}).length,
        exactUnion: actual ? JSON.stringify(actual) === JSON.stringify([...expectedIds].sort()) : false,
        partialHasNoEvents: result.status === 'pending' ? !('remoteEvents' in result) : undefined,
        publishReady: result.publishReady, convergenceComplete: result.convergenceComplete }
    }, { token: account.token, userId: account.user.userId, head, expectedIds })
    writeUnknown = result.unknown
    summaries.push({ label, ...result })
    console.log('HISTORY_LIVE_PAGE', JSON.stringify(summaries.at(-1)))
    assert.equal(result.publishReady, false); assert.equal(result.convergenceComplete, false)
    return result
  }
  const first = await run('verify-first-document')
  assert.equal(first.status, 'pending'); assert.equal(first.completed, 16); assert.equal(first.total, 20)
  assert.equal(first.downloads, 0); assert.equal(first.partialHasNoEvents, true)
  const second = await run('verify-after-reload-download-partial')
  assert.equal(second.previousVerified, 16); assert.equal(second.status, 'pending')
  assert.equal(second.reason, 'verification-download-pending'); assert.equal(second.downloads, 16)
  assert.equal(second.partialHasNoEvents, true)
  const third = await run('download-after-second-reload')
  assert.equal(third.previousVerified, 20); assert.equal(third.status, 'witnessed')
  assert.equal(third.downloads, 4); assert.equal(third.remoteCount, 20); assert.equal(third.exactUnion, true)
  // Alter only this disposable browser's non-authoritative cache, never cloud or working learning tables.
  await page.evaluate(async userId => {
    const cache = globalThis.historyProbe.historyCache, state = await cache.read(userId)
    Object.values(state.batches)[0].batch.events[0].word = 'synthetic-tamper'
    await cache.save(userId, state)
  }, account.user.userId)
  const corrupt = await run('tampered-cache-after-reload')
  assert.equal(corrupt.status, 'blocked'); assert.equal(corrupt.reason, 'witness-evidence-digest-mismatch')
  await version()
} catch (error) {
  failures.push(error)
  console.error('HISTORY_LIVE_APPLICATION_FAILED', error.name, error.message)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (account?.user?.userId) {
    if (writeUnknown) failures.push(Error('Cleanup deferred: uncertain mutation; no login or DELETE'))
    else try {
      const proof = await cleanupDisposableAccount({ baseUrl: base, username, password, userId: account.user.userId, token: account.token })
      console.log('HISTORY_LIVE_CLEANUP', JSON.stringify(proof))
    } catch (error) {
      failures.push(error); console.error('HISTORY_LIVE_CLEANUP_FAILED', JSON.stringify({ message: error.message, trace: error.trace || [] }))
    }
  }
}
if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '))
console.log('PASS real Blob segmented history and cross-document cache resume; exact source ' + sha)
