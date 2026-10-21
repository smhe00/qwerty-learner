import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-m3-receiver-'))
const out = join(tmp, 'receiver.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/m3-witnessed-receiver.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { inspectWitnessedDeviceConvergence: inspect } =
  await import(pathToFileURL(out).href)

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const device = n => 'qwerty-web-' + id(n)
const accountId = 'account-immutable-1'
const stamp = 1800000000
const row = (n, word = 'alpha', timeStamp = stamp + n * 86400, more = {}) => ({
  attemptId: id(n), word, timeStamp, dict: 'school', chapter: -1,
  timing: [], wrongCount: 0, mistakes: {},
  sourceMode: 'learn', learnItemKind: 'review',
  reviewRatingDecision: { eligible: true, rating: 'good',
    confidence: 1, reasonCodes: ['m3-test'] }, ...more,
})
const receipt = (deviceNum, seq, batchNum) => ({
  deviceId: device(deviceNum), sequence: seq,
  batchId: id(batchNum), sha256: String(batchNum).padStart(64, 'a'),
})
const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return '{' + Object.keys(value).sort().map(k =>
    JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
}
const hash = value => createHash('sha256').update(canonical(value)).digest('hex')

const batch = (deviceNum, seq, batchNum, events, prior = null) => ({
  schemaVersion: 2, accountId, ...receipt(deviceNum, seq, batchNum),
  previous: prior ? { batchId: prior.batchId, sha256: prior.sha256 } : null,
  events,
})
const makePort = (batches, opts = {}) => {
  let calls = 0
  let owner = true
  const byId = new Map(batches.map(b => [canonical(receiptFrom(b)), b]))
  const collect = heads => {
    const visited = new Set()
    const rows = new Map()
    for (const head of heads) {
      let at = head
      while (at) {
        const key = canonical(at)
        if (visited.has(key)) break
        const data = byId.get(key)
        if (!data) throw new Error('unverified-prefix')
        visited.add(key)
        for (const event of data.events) {
          if (rows.has(event.attemptId) &&
              canonical(rows.get(event.attemptId)) !== canonical(event)) {
            throw new Error('conflicting-attempt')
          }
          rows.set(event.attemptId, event)
        }
        at = data.sequence === 1 ? null : {
          deviceId: data.deviceId, sequence: data.sequence - 1,
          batchId: data.previous.batchId, sha256: data.previous.sha256,
        }
      }
    }
    return rows
  }
  const port = {
    async assertOwner() {
      calls++
      if (!owner || (opts.revokeAfter && calls >= opts.revokeAfter)) {
        throw new Error('account-owner-changed')
      }
    },
    async verifyHeads(heads) {
      const rows = collect(heads)
      const entries = [...rows].map(([key, value]) =>
        [key, canonical(value)]).sort(([a], [b]) => a.localeCompare(b))
      return { verified: true, publishReady: false,
        convergenceComplete: false, listingIsAuthoritative: false,
        uniqueAttemptCount: entries.length,
        evidenceSha256: opts.fakeDigest ?? hash(entries) }
    },
    async read(head) {
      if (opts.hide?.some(x => canonical(x) === canonical(head))) {
        throw new Error('temporary-pop-miss')
      }
      const b = byId.get(canonical(head))
      if (!b) throw new Error('missing-immutable-batch')
      return { ok: true, batch: opts.rewrite ? opts.rewrite(b) : b }
    },
  }
  return { port, setOwner: value => { owner = value }, getCalls: () => calls }
}
const receiptFrom = b => ({
  deviceId: b.deviceId, sequence: b.sequence,
  batchId: b.batchId, sha256: b.sha256,
})

test('M2: three device chains converge to same read-only UUID/FSRS projection in any head order', async () => {
  const a = batch(1, 1, 11, [row(1, 'alpha', stamp,
    { learnItemKind: 'acquisition', reviewRatingDecision: undefined })])
  const b = batch(2, 1, 12, [row(2, 'alpha', stamp + 86400)])
  const c = batch(3, 1, 13, [row(3, 'beta', stamp + 86400, {
    learnItemKind: 'acquisition', reviewRatingDecision: undefined })])
  const { port } = makePort([a, b, c])
  const opts = { accountId, localRecords: [row(4, 'other')], port }
  const heads = [receiptFrom(a), receiptFrom(b), receiptFrom(c)]
  const x = await inspect({ ...opts, heads })
  const y = await inspect({ ...opts, heads: [heads[2], heads[0], heads[1]] })
  assert.equal(x.status, 'witnessed')
  assert.equal(x.publishReady, false)
  assert.equal(x.convergenceComplete, false)
  assert.equal(x.remoteAttemptCount, 3)
  assert.equal(x.projection.uniqueAttempts, 4)
  assert.deepEqual(x.projection.words, y.projection.words)
  assert.deepEqual(x.remoteEvents, y.remoteEvents)
  assert.equal(x.projection.words.find(w => w.word === 'alpha').fsrsState.reviewCount, 1)
  assert.equal(x.projection.words.find(w => w.word === 'alpha').fsrsState.schedulerState.kind, 'fsrs6')
})

test('M3: bounded linked history de-duplicates an exact retransmission', async () => {
  const one = batch(1, 1, 21, [row(10, 'alpha', stamp)])
  const two = batch(1, 2, 22, [row(10, 'alpha', stamp), row(11, 'beta')],
    receiptFrom(one))
  const { port } = makePort([one, two])
  const view = await inspect({ accountId, heads: [receiptFrom(two)],
    localRecords: [], port })
  assert.equal(view.status, 'witnessed')
  assert.equal(view.remoteAttemptCount, 2)
  assert.equal(view.projection.uniqueAttempts, 2)
})

test('M4: server digest mismatch never gives an applicable partial result', async () => {
  const a = batch(1, 1, 31, [row(21)])
  const { port } = makePort([a], { fakeDigest: '0'.repeat(64) })
  const view = await inspect({ accountId, heads: [receiptFrom(a)],
    localRecords: [], port })
  assert.deepEqual(view, { status: 'blocked', reason: 'witness-evidence-digest-mismatch',
    publishReady: false, convergenceComplete: false, remoteAttemptCount: 0 })
})

test('M4: stale POP, auth switch and wrong account refuse partial convergence', async () => {
  const a = batch(1, 1, 41, [row(31)])
  const scenarios = [
    makePort([a], { hide: [receiptFrom(a)] }),
    makePort([a], { revokeAfter: 3 }),
    makePort([a], { rewrite: b => ({ ...b, accountId: 'somebody-else' }) }),
  ]
  for (const { port } of scenarios) {
    const view = await inspect({ accountId, heads: [receiptFrom(a)],
      localRecords: [], port })
    assert.equal(view.status, 'blocked')
    assert.equal(view.remoteAttemptCount, 0)
    assert.equal(view.publishReady, false)
  }
})

test('M4: same UUID with altered evidence and forged numeric ID fail closed', async () => {
  const a = batch(1, 1, 51, [row(41)])
  const b = batch(2, 1, 52, [row(41, 'alpha', stamp + 41 * 86400,
    { wrongCount: 3 })])
  const { port } = makePort([a])
  const ref = await inspect({ accountId, heads: [receiptFrom(a)],
    localRecords: [row(41, 'alpha', stamp + 41 * 86400, { wrongCount: 2 })], port })
  assert.equal(ref.status, 'blocked')
  assert.match(ref.reason, /identity-conflict/)
  const { port: bad } = makePort([batch(3, 1, 53,
    [{ ...row(43), id: 1 }])])
  const forged = await inspect({ accountId,
    heads: [receipt(3, 1, 53)], localRecords: [], port: bad })
  assert.equal(forged.status, 'blocked')
  // The locally mocked server also treats conflicting batches as invalid.
  await assert.rejects(() => makePort([a, b]).port.verifyHeads(
    [receiptFrom(a), receiptFrom(b)]), /conflicting-attempt/)
})

test('M4: too many device heads, missing predecessor and forked sequence are blocked', async () => {
  const first = batch(1, 1, 61, [row(51)])
  const second = batch(1, 2, 62, [row(52)], receiptFrom(first))
  const { port } = makePort([first, second])
  assert.equal((await inspect({ accountId, heads: [],
    localRecords: [], port })).status, 'blocked')
  const missing = await inspect({ accountId,
    heads: [receiptFrom(second)],
    localRecords: [], port: makePort([second], {}).port })
  assert.equal(missing.status, 'blocked')
  const fork = batch(1, 2, 63, [row(53)], receiptFrom(first))
  const forks = await inspect({ accountId, heads: [receiptFrom(second), receiptFrom(fork)],
    localRecords: [], port: makePort([first, second, fork]).port })
  assert.equal(forks.status, 'blocked')
})
