/* eslint-env node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { DAY_MS, DRAIN_MS, createIdleAccounts } from '../cloud-functions/_shared/idle-accounts.js'
import { withRetry } from '../cloud-functions/_shared/storage/edgeone-blob.js'

const nonce = () => crypto.randomBytes(16).toString('hex')
const jsonOptions = { type: 'json', consistency: 'strong' }

/** All engine paths are remapped below a fresh sandbox prefix, never account data. */
export function qualificationScope(rawClients, { runId = nonce(), onTrack = () => {} } = {}) {
  assert.match(runId, /^[a-f0-9]{32}$/)
  assert.equal(rawClients.length, 2)
  const root = `idle-qualification/v1/${runId}/`
  const tracked = new Set()
  const deleted = []
  let writes = 0
  function namespace(name, client = 0, hooks = {}) {
    assert.match(name, /^[a-z][a-z0-9-]{0,39}$/)
    assert.ok(client === 0 || client === 1)
    const base = root + name + '/'
    const raw = rawClients[client]
    function key(relative, prefix = false) {
      assert.equal(typeof relative, 'string')
      assert.ok((prefix && relative === '') || /^[A-Za-z0-9_./-]+$/.test(relative))
      assert.ok(!relative.startsWith('/') && !relative.includes('//'))
      assert.ok(!relative.split('/').some(part => part === '.' || part === '..'))
      assert.ok(prefix || (relative.length > 0 && !relative.endsWith('/')))
      return base + relative
    }
    return {
      async get(relative, options = {}) {
        return raw.get(key(relative), { ...options, consistency: 'strong' })
      },
      async setJSON(relative, value) {
        const physical = key(relative)
        tracked.add(physical)
        // Persist the ledger BEFORE a remote write: a lost ACK may have committed.
        onTrack({ runId, root, keys: [...tracked] })
        writes++
        await raw.setJSON(physical, value)
        await hooks.afterWrite?.(relative)
      },
      async delete(relative) {
        const physical = key(relative)
        // The engine also deletes absent return markers; scope remains mandatory.
        tracked.add(physical)
        onTrack({ runId, root, keys: [...tracked] })
        await hooks.beforeDelete?.(relative)
        writes++
        await raw.delete(physical)
        deleted.push({ namespace: name, key: relative })
        await hooks.afterDelete?.(relative)
      },
      async list({ prefix = '' } = {}) {
        const physicalPrefix = key(prefix, true)
        const result = await raw.list({ prefix: physicalPrefix, consistency: 'strong' })
        assert.ok(Array.isArray(result?.blobs), 'Incomplete sandbox listing')
        const blobs = result.blobs.map(blob => {
          assert.equal(typeof blob.key, 'string')
          assert.ok(blob.key.startsWith(physicalPrefix), 'Foreign provider listing refused')
          return { ...blob, key: blob.key.slice(base.length) }
        })
        return { blobs }
      },
    }
  }
  async function cleanup() {
    let failures = 0
    for (const key of tracked) {
      assert.ok(key.startsWith(root))
      try {
        await withRetry(() => rawClients[0].delete(key))
        assert.equal(await withRetry(() => rawClients[1].get(key, jsonOptions)), null)
      } catch { failures++ }
    }
    let remaining = null
    try {
      const listed = await withRetry(() => rawClients[1].list({ prefix: root, consistency: 'strong' }))
      assert.ok(Array.isArray(listed?.blobs))
      assert.ok(listed.blobs.every(blob => typeof blob.key === 'string' && blob.key.startsWith(root)))
      remaining = listed.blobs.length
    } catch { failures++ }
    return { confirmed: failures === 0 && remaining === 0, failures, remaining, trackedKeys: tracked.size }
  }
  return { namespace, cleanup, root, tracked, deleted, writes: () => writes }
}

/** Runs production idle code against real SDK stores; only its clock/failpoints are injected. */
export async function qualifyIdleLifecycle({ clients, onTrack, onCase = () => {}, transport = 'memory-only' }) {
  const scope = qualificationScope(clients, { onTrack })
  const report = {
    check: 'isolated-idle-blob-lifecycle-v1', transport,
    realBlobTested: transport === 'edgeone-blob-sdk', independentSdkClients: 2,
    multiRegionQualified: false, deployedFunctionTested: false,
    productionAccountNamespacesTouched: false, deploymentTriggered: false,
    clockOverrideInProduction: false, cases: [], cleanup: null, verdict: 'FAIL',
  }
  const epoch = Date.parse('2026-01-01T00:00:00Z')
  const adminId = nonce()
  const put = (store, key, value) => withRetry(() => store.setJSON(key, value))
  const read = (store, key) => withRetry(() => store.get(key, jsonOptions))
  async function fixture(name, hooks = {}) {
    const store = scope.namespace(name, 0, hooks)
    const other = scope.namespace(name, 1)
    const userId = nonce()
    const username = `synthetic_${name}`
    const usernameHash = crypto.createHash('sha256').update(username + userId).digest('hex')
    const identity = { userId, usernameHash, username, normalizedUsername: username,
      status: 'active', createdAt: new Date(epoch - 400 * DAY_MS).toISOString() }
    const identityKey = `accounts/${usernameHash}/identity.json`
    const payload = `users/${userId}/snapshot.json`
    const secondPayload = `users/${userId}/second.json`
    const auth = `accounts/${usernameHash}/auth/0001.json`
    const sentinel = `users/${nonce()}/keep.json`
    let now = epoch + 181 * DAY_MS
    const engine = (client = store, execute = true) => createIdleAccounts({
      store: client, adminUserId: adminId, startAt: new Date(epoch).toISOString(),
      execute, clock: () => now,
    })
    await put(store, identityKey, identity)
    await put(store, payload, { synthetic: 'first' })
    await put(store, secondPayload, { synthetic: 'second' })
    await put(store, auth, { synthetic: 'auth-marker-not-a-credential' })
    await put(store, sentinel, { keep: true })
    async function gone() {
      for (const key of [identityKey, payload, secondPayload, auth]) assert.equal(await read(other, key), null)
      assert.deepEqual(await read(other, sentinel), { keep: true })
    }
    return { store, other, identity, identityKey, payload, secondPayload, auth,
      sentinel, engine, gone, advance: ms => { now += ms }, setAge: days => { now = epoch + days * DAY_MS } }
  }
  let phase = 'not-started'
  async function check(name, operation) {
    phase = name
    const started = Date.now()
    try {
      await operation()
      const result = { name, passed: true, elapsedMs: Date.now() - started }
      report.cases.push(result)
      onCase(result)
    } catch (error) {
      const result = { name, passed: false, elapsedMs: Date.now() - started }
      report.cases.push(result)
      onCase(result)
      throw error
    }
  }
  try {
    await check('activation-floor-and-180-day-boundary', async () => {
      const f = await fixture('boundary')
      const before = scope.writes()
      for (const [age, action] of [[0, 'retain'], [179, 'retain'], [180, 'candidate']]) {
        f.setAge(age)
        const result = await f.engine().run()
        assert.equal(result.results[0].action, action)
        assert.equal(Date.parse(result.results[0].expiresAt), epoch + 180 * DAY_MS)
      }
      assert.equal(scope.writes(), before, 'Preview may not write target data')
      await assert.rejects(f.engine(f.store, false).run({ dryRun: false }), { code: 'idle_cleanup_disabled' })
      assert.equal(scope.writes(), before)
    })
    await check('drain-identity-last-and-repeated-delete', async () => {
      let f
      const hooks = { beforeDelete: async key => {
        if (key !== f.identityKey) return
        for (const own of [f.payload, f.secondPayload, f.auth]) assert.equal(await read(f.other, own), null)
        assert.deepEqual(await read(f.other, f.sentinel), { keep: true })
      } }
      f = await fixture('identity-last', hooks)
      assert.equal((await f.engine().run({ dryRun: false })).results[0].action, 'draining')
      assert.deepEqual(await read(f.other, f.payload), { synthetic: 'first' })
      f.advance(DRAIN_MS)
      assert.equal((await f.engine().run({ dryRun: false })).results[0].action, 'deleted')
      await f.gone()
      assert.equal((await f.engine(f.other).run({ dryRun: false })).results.length, 0)
      await f.gone()
      await assert.rejects(f.engine(f.other).touch(f.identity), { code: 'account_cleanup_pending' })
    })
    await check('return-during-drain-cancels', async () => {
      const f = await fixture('cancel')
      assert.equal((await f.engine().run({ dryRun: false })).results[0].action, 'draining')
      await assert.rejects(f.engine(f.other).touch(f.identity), { code: 'account_cleanup_pending' })
      f.advance(DRAIN_MS)
      assert.equal((await f.engine().run({ dryRun: false })).results[0].action, 'cancelled')
      assert.deepEqual(await read(f.other, f.identityKey), f.identity)
      assert.deepEqual(await read(f.other, f.payload), { synthetic: 'first' })
      assert.equal((await f.engine(f.other).run()).results[0].action, 'retain')
    })
    await check('ambiguous-delete-ack-and-new-worker-resume', async () => {
      let interrupted = false
      let armed = false
      const hooks = {
        beforeDelete: async () => { if (interrupted) throw Error('Injected interruption') },
        afterDelete: async () => { if (armed) { interrupted = true; throw Error('Injected lost acknowledgement') } },
      }
      const f = await fixture('lost-ack', hooks)
      await f.engine().run({ dryRun: false })
      f.advance(DRAIN_MS)
      armed = true
      assert.equal((await f.engine().run({ dryRun: false })).results[0].action, 'error')
      assert.deepEqual(await read(f.other, f.identityKey), f.identity)
      const absent = await Promise.all([f.payload, f.secondPayload, f.auth].map(key => read(f.other, key)))
      assert.ok(absent.some(value => value === null), 'A real delete must precede the injected lost ACK')
      // New engine + independent SDK client, without any old process-local cursor.
      assert.equal((await f.engine(f.other).run({ dryRun: false })).results[0].action, 'deleted')
      await f.gone()
    })
    await check('time-budget-checkpoint-and-next-day-resume', async () => {
      let f
      let armed = false
      let injected = false
      f = await fixture('budget', { afterDelete: async () => {
        if (armed && !injected) { injected = true; f.advance(36_000) }
      } })
      assert.equal((await f.engine().runDaily()).counts.draining, 1)
      f.advance(DRAIN_MS)
      armed = true
      const result = await f.engine().runDaily()
      assert.equal(result.status, 'paused')
      assert.deepEqual(await read(f.other, f.identityKey), f.identity)
      f.advance(DAY_MS)
      assert.equal((await f.engine(f.other).runDaily()).counts.deleted, 1)
      await f.gone()
    })
    await check('active-admin-smhe-and-circle-exemptions', async () => {
      const f = await fixture('protected')
      const rows = [
        { ...f.identity, userId: adminId },
        { ...f.identity, normalizedUsername: 'smhe' },
      ]
      for (const identity of rows) {
        await put(f.store, f.identityKey, identity)
        const before = scope.writes()
        assert.equal((await f.engine().run({ dryRun: false })).results[0].action, 'protected')
        assert.equal(scope.writes(), before)
      }
      await put(f.store, f.identityKey, f.identity)
      await put(f.store, `social/v2/accounts/${f.identity.userId}/used.json`, { used: true })
      assert.equal((await f.engine().run({ dryRun: false })).results[0].action, 'circle_hold')
      await f.store.delete(`social/v2/accounts/${f.identity.userId}/used.json`)
      await f.engine(f.other).touch(f.identity)
      f.advance(179 * DAY_MS)
      assert.equal((await f.engine().run({ dryRun: false })).results[0].action, 'retain')
      assert.deepEqual(await read(f.other, f.payload), { synthetic: 'first' })
    })
    await check('two-independent-workers-repeat-daily-trigger', async () => {
      const f = await fixture('overlap')
      await f.engine().runDaily()
      f.advance(DRAIN_MS)
      const results = await Promise.all([f.engine().runDaily(), f.engine(f.other).runDaily()])
      assert.ok(results.some(result => result.status !== 'already_ran'))
      // One later daily invocation may resume a race-interrupted scan.
      f.advance(DAY_MS)
      await f.engine(f.other).runDaily()
      await f.gone()
      const before = scope.writes()
      assert.equal((await f.engine().runDaily()).status, 'already_ran')
      assert.equal(scope.writes(), before)
      await f.engine(f.other).beforeRegister(f.identity.usernameHash)
    })
    await check('foreign-provider-listing-fails-before-delete', async () => {
      const f = await fixture('foreign-list')
      const poisoned = {
        get: f.store.get.bind(f.store), setJSON: f.store.setJSON.bind(f.store), delete: f.store.delete.bind(f.store),
        list: async options => ({ blobs: [...(await f.store.list(options)).blobs, { key: 'outside/not-an-account.json' }] }),
      }
      const before = scope.writes()
      await assert.rejects(f.engine(poisoned).run({ dryRun: false }))
      assert.equal(scope.writes(), before)
      assert.deepEqual(await read(f.other, f.identityKey), f.identity)
      assert.deepEqual(await read(f.other, f.sentinel), { keep: true })
    })
    report.verdict = 'PASS'
  } catch (error) {
    report.failedCase = phase
    report.failureType = error?.name === 'AssertionError' ? 'assertion' : 'storage-or-runner'
    // Never include SDK exception messages, request headers, tokens or provider paths.
  } finally {
    report.cleanup = await scope.cleanup()
    if (!report.cleanup.confirmed) report.verdict = 'FAIL'
  }
  return report
}
