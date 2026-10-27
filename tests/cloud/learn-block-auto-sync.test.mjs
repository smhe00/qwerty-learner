/* eslint-env node */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { build } from 'esbuild'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const work = mkdtempSync(join(tmpdir(), 'qwerty-block-sync-'))
const outfile = join(work, 'block-sync.mjs')
after(() => rmSync(work, { recursive: true, force: true }))
await build({
  entryPoints: [resolve('src/sync/learn-block-sync.ts')],
  outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20',
})
const sync = await import(pathToFileURL(outfile).href)
const data = new Map()
class Store {
  getItem(key) { return data.has(key) ? data.get(key) : null }
  setItem(key, value) { data.set(key, String(value)) }
  removeItem(key) { data.delete(key) }
}
globalThis.localStorage = new Store()
globalThis.sessionStorage = new Store()

test('Block auto-sync defaults OFF and is isolated by immutable account ID', () => {
  assert.equal(sync.blockAutoSyncEnabled('account-a'), false)
  sync.setBlockAutoSyncEnabled('account-a', true)
  assert.equal(sync.blockAutoSyncEnabled('account-a'), true)
  assert.equal(sync.blockAutoSyncEnabled('account-b'), false)
  sync.setBlockAutoSyncEnabled('account-a', false)
  assert.equal(sync.blockAutoSyncEnabled('account-a'), false)
})

test('Only visible milestones / daily completion request auto-sync', () => {
  assert.equal(sync.isVisibleLearnBlockBoundary({ dailyComplete: false }), false)
  assert.equal(sync.isVisibleLearnBlockBoundary({ dailyComplete: false, milestone: 20 }), true)
  assert.equal(sync.isVisibleLearnBlockBoundary({ dailyComplete: true }), true)
  assert.throws(() => sync.stageLearnBlockSync('account-a', { dailyComplete: false, milestone: 20 }))
})

test('Existing daily-completion auto-sync remains available when per-Block toggle is off', () => {
  sync.setBlockAutoSyncEnabled('account-daily', false)
  sync.stageLearnBlockSync('account-daily', { dailyComplete: true })
  assert.equal(sync.readLearnBlockSyncPending('account-daily')?.dailyComplete, true)
  sync.clearLearnBlockSyncHandoff()
})

test('Staged Block handoff binds to account and enables idempotent retry', () => {
  sync.setBlockAutoSyncEnabled('account-a', true)
  sync.stageLearnBlockSync('account-a', { dailyComplete: false, milestone: 20 })
  assert.equal(sync.readLearnBlockSyncPending('account-b'), null)
  assert.equal(sync.readLearnBlockSyncPending('account-a')?.milestone, 20)
  sync.saveLearnBlockSyncOutcome({ kind: 'failed', message: 'network' })
  assert.equal(sync.readLearnBlockSyncOutcome()?.kind, 'failed')
  assert.equal(sync.readLearnBlockSyncPending('account-a')?.dailyComplete, false)
  sync.clearLearnBlockSyncHandoff()
  assert.equal(sync.readLearnBlockSyncPending('account-a'), null)
  assert.equal(sync.readLearnBlockSyncOutcome(), null)
})

test('Corrupt/stale pending handoff never authorizes a cloud operation', () => {
  sync.setBlockAutoSyncEnabled('account-a', true)
  sync.stageLearnBlockSync('account-a', { dailyComplete: true })
  const payload = JSON.parse(data.get(sync.LEARN_BLOCK_PENDING_KEY))
  payload.at -= 22 * 60 * 1000
  data.set(sync.LEARN_BLOCK_PENDING_KEY, JSON.stringify(payload))
  assert.equal(sync.readLearnBlockSyncPending('account-a'), null)
  data.set(sync.LEARN_BLOCK_PENDING_KEY, '{bad json')
  assert.equal(sync.readLearnBlockSyncPending('account-a'), null)
  data.delete(sync.LEARN_BLOCK_PENDING_KEY)
})

test('Opt-in remains OFF when browser local storage is unavailable', () => {
  const original = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
  assert.equal(sync.blockAutoSyncEnabled('account-a'), false)
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original })
})

test('Exhausted-round sync is distinct from mastery and does not enable interim sync', () => {
  sync.setBlockAutoSyncEnabled('account-exhausted', false)
  sync.stageLearnBlockSync('account-exhausted', { dailyComplete: false, roundEnded: true })
  const pending = sync.readLearnBlockSyncPending('account-exhausted')
  assert.equal(pending?.dailyComplete, false)
  assert.equal(pending?.roundEnded, true)
  assert.equal(pending?.milestone, null)
  assert.equal(sync.readLearnBlockSyncPending('different-owner'), null)
  sync.clearLearnBlockSyncHandoff()
  assert.throws(() => sync.stageLearnBlockSync('account-exhausted', { dailyComplete: false, roundEnded: false, milestone: 20 }))
})

test('Malformed round-ended flag cannot authorize a completion handoff', () => {
  sync.stageLearnBlockSync('account-exhausted', { dailyComplete: false, roundEnded: true })
  const pending = JSON.parse(data.get(sync.LEARN_BLOCK_PENDING_KEY))
  data.set(sync.LEARN_BLOCK_PENDING_KEY, JSON.stringify({ ...pending, roundEnded: 'true' }))
  assert.equal(sync.readLearnBlockSyncPending('account-exhausted'), null)
  sync.clearLearnBlockSyncHandoff()
})


test('Optional completion summary is bounded, account-bound, expires, and never authorizes sync', () => {
  const summary = {
    dictionary: 'CET4', title: '今日学习完成', description: '本地已保存', percent: 100,
    progressLabel: '今日学习完成进度',
    metrics: Array.from({ length: 6 }, () => ({ label: '进度', value: '1/1', detail: '100%' })),
  }
  assert.throws(() => sync.stageLearnBlockSync('summary-owner', { dailyComplete: false, summary }))
  sync.stageLearnBlockSync('summary-owner', { dailyComplete: true, summary })
  assert.deepEqual(sync.readLearnBlockSyncPending('summary-owner').summary, summary)
  assert.equal(sync.readLearnBlockSyncPending('other-owner'), null)
  const raw = JSON.parse(data.get(sync.LEARN_BLOCK_PENDING_KEY))
  for (const invalid of [null, { ...summary, percent: 101 }, { ...summary, metrics: [{}] },
    { ...summary, title: 'x'.repeat(201) }, { ...summary, metrics: [null, ...summary.metrics.slice(1)] }]) {
    data.set(sync.LEARN_BLOCK_PENDING_KEY, JSON.stringify({ ...raw, summary: invalid }))
    const pending = sync.readLearnBlockSyncPending('summary-owner')
    assert.equal(pending.dailyComplete, true)
    assert.equal(pending.summary, undefined)
  }
  data.set(sync.LEARN_BLOCK_PENDING_KEY, JSON.stringify({ ...raw, at: Date.now() - 21 * 60 * 1000 }))
  assert.equal(sync.readLearnBlockSyncPending('summary-owner'), null)
  sync.clearLearnBlockSyncHandoff()
})
