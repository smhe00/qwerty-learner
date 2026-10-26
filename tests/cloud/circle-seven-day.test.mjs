/* eslint-env node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { AppError } from '../../cloud-functions/_shared/core.js'
import { resetAuthRateLimitMemoryForTest } from '../../cloud-functions/_shared/auth-rate-limit.js'
import { createCircleV3Storage, root, windowDays } from '../../cloud-functions/_shared/circle/bounded-storage.js'
import { createCircleBoundedService } from '../../cloud-functions/_shared/circle/bounded-service.js'
import { circleAccountHasActivity, createCircleOpenGateway } from '../../cloud-functions/_shared/circle/open-gateway.js'
import { activityKey, createDailyViews } from '../../cloud-functions/_shared/circle/daily-view.js'
import { sweepCircleV3 } from '../../cloud-functions/_shared/circle/maintenance.js'
import { createCircleEventLog } from '../../cloud-functions/_shared/circle/event-log.js'
import { createCircleEventualService } from '../../cloud-functions/_shared/circle/service.js'
import { runMaintenance } from '../../scripts/circle-v3-maintenance.mjs'

const OWNER = 'owner_0001'
const MEMBER = 'member_0001'
const OTHER = 'other_0001'
const NOW = Date.parse('2026-10-26T04:00:00Z')
const DAY = '2026-10-26'
const code = (expected) => (error) => error.code === expected
function fixture({ pageSize = 1000, etags = false, usernames = {} } = {}) {
  const data = new Map()
  const calls = []
  const hooks = {}
  const revoked = new Set()
  let time = NOW
  let activeGets = 0
  let peakGets = 0
  const blob = {
    async get(key, options) {
      calls.push({ op: 'get', key, ...options })
      activeGets++; peakGets = Math.max(peakGets, activeGets)
      try {
        if (hooks.get) {
          const override = await hooks.get(key, options)
          if (override !== undefined) return override
        }
        return structuredClone(data.get(key) ?? null)
      } finally { activeGets-- }
    },
    async getWithHeaders(key, options) {
      const value=await this.get(key, options)
      return value===null?null:{body:JSON.stringify(value),headers:etags?{etag:crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}: {}}
    },
    async setJSON(key, value) {
      calls.push({ op: 'set', key })
      if (hooks.beforeSet) await hooks.beforeSet(key, value)
      data.set(key, structuredClone(value))
      if (hooks.afterSet) await hooks.afterSet(key, value)
    },
    async delete(key) {
      calls.push({ op: 'delete', key })
      if (hooks.beforeDelete) await hooks.beforeDelete(key)
      data.delete(key)
      if (hooks.afterDelete) await hooks.afterDelete(key)
    },
    async list(options) {
      calls.push({ op: 'list', ...options })
      if (hooks.list) {
        const override = await hooks.list(options)
        if (override !== undefined) return override
      }
      const keys = [...data.keys()].filter((k) => k.startsWith(options.prefix)).sort()
      let items = keys.map((key) => ({ key, ...(etags ? {etag: crypto.createHash('sha256').update(JSON.stringify(data.get(key))).digest('hex')} : {}) }))
      if (options.directories) {
        const dirs = new Set()
        items = keys.flatMap((key) => {
          const slash = key.indexOf('/', options.prefix.length)
          if (slash < 0) return [{ key }]
          dirs.add(key.slice(0, slash + 1))
          return []
        })
        items.push(...[...dirs].map((directory) => ({ directory })))
        items.sort((a, b) => (a.key || a.directory).localeCompare(b.key || b.directory))
      }
      const start = Number(options.cursor || 0)
      const limit = options.paginate === false ? pageSize : items.length
      const slice = items.slice(start, start + limit)
      return { blobs: slice.filter((v) => v.key), directories: slice.filter((v) => v.directory).map((v) => v.directory),
        ...(start + limit < items.length ? { cursor: String(start + limit) } : {}) }
    },
  }
  const backend = {
    async me(token) {
      if (!token || revoked.has(token) || token === 'bad') throw new AppError(401, 'session_revoked', 'Revoked')
      return { user: { userId: token, ...(usernames[token] ? {username:usernames[token]} : {}) } }
    },
  }
  const storage = createCircleV3Storage(blob)
  const service = createCircleBoundedService({ storage, authenticate: backend.me, now: () => time })
  const create = (token = OWNER, input = {}) => service.createCircle(token,
    { name: 'Circle', operationId: crypto.randomUUID(), ...input })
  return { data, calls, hooks, revoked, blob, storage, service, backend, create,
    clock: (value) => { time = value }, now: () => time, peak: () => peakGets }
}
const publish = (f, id, user = MEMBER, day = DAY, input = {}) => f.service.publishProgress(user, id, day,
  { eventId: 'progress_0001', completed: true, newWords: 12, ...input })
async function pair(f) {
  const c = await f.create()
  await f.service.joinCircle(MEMBER, c.inviteCode)
  return c
}

test('membership write/delete/rejoin is bounded, owner included, removal allows return and close cannot reopen', async () => {
  const f = fixture()
  const c = await pair(f)
  assert.equal(c.consistency, 'strong')
  assert.equal(c.readbackConfirmed, true)
  assert.equal((await f.service.listMyCircles(MEMBER)).circles.length, 1)
  const count = f.data.size
  for (let i = 0; i < 12; i++) {
    await f.service.leaveCircle(MEMBER, c.circleId)
    assert.equal(await f.storage.get(root(c.circleId) + 'members/' + MEMBER + '.json'), null)
    await assert.rejects(f.service.getCircle(MEMBER, c.circleId), code('not_circle_member'))
    await f.service.joinCircle(MEMBER, c.inviteCode)
  }
  assert.equal(f.data.size, count)
  await f.service.removeMember(OWNER, c.circleId, MEMBER)
  await f.service.joinCircle(MEMBER, c.inviteCode)
  assert.equal((await f.service.getCircle(OWNER, c.circleId)).members.length, 2)
  await assert.rejects(f.service.leaveCircle(OWNER, c.circleId), code('owner_cannot_leave'))
  await assert.rejects(f.service.closeCircle(MEMBER, c.circleId), code('not_circle_owner'))
  await f.service.closeCircle(OWNER, c.circleId)
  await f.service.closeCircle(OWNER, c.circleId)
  await assert.rejects(f.service.joinCircle(MEMBER, c.inviteCode), code('circle_closed'))
  assert.equal((await f.service.listMyCircles(MEMBER)).circles.length, 0)
  assert.equal((await f.service.listMyCircles(OWNER)).circles.length, 0)
  assert.ok(f.calls.filter((c) => c.op === 'get' && /\/(?:members|meta|closed)/.test(c.key))
    .every((c) => c.consistency === 'strong'))
})

test('create retry is stable, conflicting input rejected and closing frees one of three slots', async () => {
  const f = fixture()
  const operationId = crypto.randomUUID()
  const first = await f.create(OWNER, { operationId })
  const retry = await f.create(OWNER, { operationId })
  assert.equal(first.inviteCode, retry.inviteCode)
  await assert.rejects(f.create(OWNER, { operationId, name: 'Different' }), code('circle_operation_conflict'))
  await f.create()
  await f.create()
  await assert.rejects(f.create(), code('circle_account_limit'))
  assert.equal((await f.service.listMyCircles(OWNER)).circles.length, 3)
  await f.service.closeCircle(OWNER, first.circleId)
  await assert.rejects(f.create(OWNER, { operationId }), code('circle_closed'))
  await f.create()
  const otherCircle = await f.create(OTHER)
  await assert.rejects(f.service.joinCircle(OWNER, otherCircle.inviteCode), code('circle_account_limit'))
})

test('50-member check is advisory; concurrent joins may both pass without losing either membership', async () => {
  const f = fixture()
  const c = await f.create()
  for (let i = 0; i < 48; i++) await f.service.joinCircle('user_' + String(i).padStart(4, '0'), c.inviteCode)
  let arrivals = 0
  let release
  const barrier = new Promise((resolve) => { release = resolve })
  f.hooks.list = async ({ prefix }) => {
    if (prefix === root(c.circleId) + 'members/') {
      arrivals++
      if (arrivals === 2) release()
      await barrier
    }
  }
  await Promise.all([f.service.joinCircle(MEMBER, c.inviteCode), f.service.joinCircle(OTHER, c.inviteCode)])
  delete f.hooks.list
  const view = await f.service.getCircle(OWNER, c.circleId)
  assert.equal(view.members.length, 51)
  assert.equal(view.capacity.hardLimit, false)
  assert.equal(view.capacity.aboveSoftLimit, true)
  await assert.rejects(f.service.joinCircle('late_0001', c.inviteCode), code('circle_member_limit'))
  // Existing members can retry even while above the advisory cap.
  await f.service.joinCircle(MEMBER, c.inviteCode)
})

test('partial index write, unknown member commit and unknown delete can be repaired by same operation', async () => {
  const f = fixture()
  const c = await f.create()
  const key = root(c.circleId) + 'members/' + MEMBER + '.json'
  f.hooks.beforeSet = async (k) => { if (k === key) throw new Error('before commit') }
  await assert.rejects(f.service.joinCircle(MEMBER, c.inviteCode), code('circle_write_unknown'))
  assert.equal((await f.service.listMyCircles(MEMBER)).circles.length, 0)
  assert.equal(f.data.has(key), false)
  delete f.hooks.beforeSet
  f.hooks.afterSet = async (k) => { if (k === key) throw new Error('lost response') }
  await assert.rejects(f.service.joinCircle(MEMBER, c.inviteCode), code('circle_write_unknown'))
  assert.equal(f.data.has(key), true)
  delete f.hooks.afterSet
  await f.service.joinCircle(MEMBER, c.inviteCode)
  f.hooks.afterDelete = async (k) => { if (k === key) throw new Error('lost delete response') }
  await assert.rejects(f.service.leaveCircle(MEMBER, c.circleId), code('circle_write_unknown'))
  assert.equal(f.data.has(key), false)
  delete f.hooks.afterDelete
  await f.service.leaveCircle(MEMBER, c.circleId)
  assert.equal((await f.service.listMyCircles(MEMBER)).circles.length, 0)
})

test('strong readback mismatch never acknowledges membership; hold precedes any social record', async () => {
  const f = fixture()
  const c = await f.create()
  const member = root(c.circleId) + 'members/' + MEMBER + '.json'
  f.hooks.get = async (key) => key === member ? null : undefined
  await assert.rejects(f.service.joinCircle(MEMBER, c.inviteCode), code('circle_write_unknown'))
  delete f.hooks.get
  await f.service.joinCircle(MEMBER, c.inviteCode)
  const writes = f.calls.filter((v) => v.op === 'set')
  for (let i = 0; i < writes.length; i++) {
    if (writes[i].key.startsWith('social/v3/')) assert.match(writes[i - 1].key, /^social\/v2\/accounts\/.+\/used\.json$/)
  }
  assert.equal(await circleAccountHasActivity({ getStore: () => f.blob, userId: MEMBER }), true)
})

test('progress merges OR/MAX, retries do not add objects, conflicting operation is omitted, clap is per actor', async () => {
  const f = fixture()
  const c = await pair(f)
  await publish(f, c.circleId, MEMBER, DAY, { completed: false, newWords: 15 })
  await publish(f, c.circleId, MEMBER, DAY, { eventId: 'progress_0002', completed: true, newWords: 8 })
  const size = f.data.size
  await publish(f, c.circleId, MEMBER, DAY, { eventId: 'progress_0002', completed: true, newWords: 8 })
  assert.equal(f.data.size, size)
  let progress = await f.service.getProgress(OWNER, c.circleId, DAY)
  assert.equal(progress[0].newWords, 15)
  assert.equal(progress[0].completed, true)
  await f.service.reactProgress(OWNER, c.circleId, MEMBER, DAY)
  await f.service.reactProgress(OWNER, c.circleId, MEMBER, DAY)
  assert.equal((await f.service.getReactions(MEMBER, c.circleId, MEMBER, DAY)).count, 1)
  await assert.rejects(f.service.reactProgress(MEMBER, c.circleId, MEMBER, DAY), code('progress_not_found'))
  await publish(f, c.circleId, MEMBER, DAY, { eventId: 'progress_0001', completed: false, newWords: 17 })
  progress = await f.service.getProgress(OWNER, c.circleId, DAY)
  assert.equal(progress[0].newWords, 8)
  assert.equal((await f.service.getDay(OWNER, c.circleId, DAY)).ignoredActivityConflicts, 1)
})

test('history uses persisted summary without raw GETs; new source keys invalidate it and reads stay bounded', async () => {
  const f = fixture({ pageSize: 3 })
  const c = await pair(f)
  const day = '2026-10-20'
  for (let i = 0; i < 20; i++) await publish(f, c.circleId, MEMBER, day,
    { eventId: 'progress_' + String(i).padStart(4, '0'), newWords: i })
  const first = await f.service.getDay(OWNER, c.circleId, day)
  f.calls.length = 0
  const second = await f.service.getDay(OWNER, c.circleId, day)
  assert.deepEqual(second, first)
  assert.equal(f.calls.filter((c) => c.op === 'get' && c.key.includes('/days/')).length, 0)
  assert.equal(f.calls.filter((c) => c.op === 'get' && c.key.includes('/summaries/')).length, 1)
  await publish(f, c.circleId, MEMBER, day, { eventId: 'progress_late', newWords: 99 })
  const late = await f.service.getDay(OWNER, c.circleId, day)
  assert.notEqual(late.sourceHash, first.sourceHash)
  assert.equal(late.progress[0].newWords, 99)
  assert.ok(f.peak() <= 8)
})

test('cached activity is filtered by live membership and returning member can see unexpired self reports', async () => {
  const f = fixture()
  const c = await pair(f)
  await publish(f, c.circleId)
  await f.service.shareAchievement(MEMBER, c.circleId, 'ACH_FIRST_DAY')
  await f.service.reactProgress(OWNER, c.circleId, MEMBER, DAY)
  await f.service.getDay(OWNER, c.circleId, DAY)
  await f.service.removeMember(OWNER, c.circleId, MEMBER)
  const removed = await f.service.getDay(OWNER, c.circleId, DAY)
  assert.deepEqual(removed.progress, [])
  assert.deepEqual(removed.reactionCounts, [])
  assert.deepEqual(removed.achievements, [])
  await f.service.joinCircle(MEMBER, c.inviteCode)
  assert.equal((await f.service.getShowcase(OWNER, c.circleId, MEMBER)).length, 1)
})

test('Beijing calendar window keeps today plus six, rejects past/future and invalid dates', async () => {
  const f = fixture()
  const c = await pair(f)
  await publish(f, c.circleId, MEMBER, '2026-10-20')
  await assert.rejects(publish(f, c.circleId, MEMBER, '2026-10-19'), code('circle_day_expired'))
  await assert.rejects(publish(f, c.circleId, MEMBER, '2026-10-27'), code('circle_day_expired'))
  await assert.rejects(publish(f, c.circleId, MEMBER, '2026-02-30'), code('invalid_day'))
  f.clock(Date.parse('2026-10-26T15:59:59Z'))
  await f.service.getProgress(MEMBER, c.circleId, '2026-10-20')
  f.clock(Date.parse('2026-10-26T16:00:00Z'))
  await assert.rejects(f.service.getProgress(MEMBER, c.circleId, '2026-10-20'), code('circle_day_expired'))
  await publish(f, c.circleId, MEMBER, '2026-10-27')
  assert.deepEqual(windowDays(Date.parse('2024-03-01T00:00:00Z')).slice(0, 2), ['2024-03-01', '2024-02-29'])
})

test('missing listed activity, forged key, bad cache and repeated cursors fail closed', async () => {
  const f = fixture()
  const c = await pair(f)
  await publish(f, c.circleId)
  const key = [...f.data.keys()].find((k) => k.includes('/days/'))
  f.hooks.get = async (k) => k === key ? null : undefined
  await assert.rejects(f.service.getDay(OWNER, c.circleId, DAY), code('circle_activity_uncertain'))
  delete f.hooks.get
  await f.service.getDay(OWNER, c.circleId, DAY)
  const summaryKey = [...f.data.keys()].find((k) => k.includes('/summaries/'))
  f.data.get(summaryKey).data.progress[0].newWords = 999
  await assert.rejects(f.service.getDay(OWNER, c.circleId, DAY), code('circle_summary_uncertain'))
  f.hooks.list = async ({ prefix }) => prefix.includes('/days/')
    ? { blobs: [{ key: 'accounts/sensitive.json' }] } : undefined
  f.calls.length = 0
  await assert.rejects(f.service.getDay(OWNER, c.circleId, DAY))
  assert.equal(f.calls.some((c) => c.op === 'get' && c.key === 'accounts/sensitive.json'), false)
  f.hooks.list = async ({ prefix }) => prefix.includes('/days/') ? { blobs: [], cursor: 'again' } : undefined
  await assert.rejects(f.service.getDay(OWNER, c.circleId, DAY), code('circle_listing_uncertain'))
})

test('revocation during activity write prevents acknowledgement and strangers cannot read or mutate', async () => {
  const f = fixture()
  const c = await pair(f)
  await assert.rejects(f.service.getCircle(OTHER, c.circleId), code('not_circle_member'))
  await assert.rejects(publish(f, c.circleId, OTHER), code('not_circle_member'))
  f.hooks.afterSet = async (key) => { if (key.includes('/days/')) f.revoked.add(MEMBER) }
  await assert.rejects(publish(f, c.circleId), code('session_revoked'))
  assert.equal([...f.data.keys()].filter((k) => k.includes('/days/')).length, 1)
})

test('inactive-circle cleanup paginates before deleting, resumes small batches and preserves control/legacy/current', async () => {
  const f = fixture({ pageSize: 2 })
  const c = await pair(f)
  const expiredDay = '2026-10-19'
  const currentKey = root(c.circleId) + 'days/' + DAY + '/' + MEMBER + '/'
  await publish(f, c.circleId)
  for (let i = 0; i < 7; i++) {
    const record = { schemaVersion: 3, circleId: c.circleId, day: expiredDay,
      actorUserId: MEMBER, type: 'progress', payload: { eventId: 'old_event_' + i, newWords: i, completed: true } }
    f.data.set(activityKey(record), record)
  }
  const daily = createDailyViews(f.storage)
  await daily.read(c.circleId, expiredDay)
  await f.service.getDay(OWNER, c.circleId, DAY)
  await publish(f, c.circleId, MEMBER, DAY, { eventId: 'another_progress', newWords: 20 })
  await f.service.getDay(OWNER, c.circleId, DAY)
  f.data.set('social/v2/circles/legacy/events/old.json', { historical: true })
  const protectedKeys = [...f.data.keys()].filter((k) => !k.includes('/days/') && !k.includes('/summaries/'))
  let state
  let steps = 0
  let deleted = 0
  do {
    const result = await sweepCircleV3(f.blob, { now: NOW, execute: true, checkpoint: state, maxPages: 2, maxDeletes: 2 })
    assert.ok(result.pages <= 2)
    assert.ok(result.deleted <= 2)
    state = result.checkpoint
    deleted += result.deleted
    assert.ok(++steps < 100)
  } while (state)
  assert.equal([...f.data.keys()].filter((k) => k.includes('/' + expiredDay + '/')).length, 0)
  assert.equal([...f.data.keys()].filter((k) => k.startsWith(currentKey)).length, 2)
  assert.equal([...f.data.keys()].filter((k) => k.includes('/summaries/')).length, 1)
  assert.equal(deleted, 8)
  protectedKeys.forEach((k) => assert.ok(f.data.has(k), k))
})

test('dry-run cleanup never deletes; forged checkpoint cannot target private or live records', async () => {
  const f = fixture()
  const c = await pair(f)
  await publish(f, c.circleId)
  const key = [...f.data.keys()].find((k) => k.includes('/days/'))
  for (const target of ['accounts/secret.json', root(c.circleId) + 'meta.json', key]) {
    await assert.rejects(sweepCircleV3(f.blob, { now: NOW, execute: true,
      checkpoint: { schemaVersion: 3, execute: true, oldest: '2026-10-20', tasks: [{ kind: 'delete', key: target }] } }))
  }
  await sweepCircleV3(f.blob, { now: NOW })
  assert.equal(f.calls.filter((c) => c.op === 'delete').length, 0)
  let calls = 0
  await assert.rejects(runMaintenance({ argv: ['--execute'], env: {}, getStore: () => { calls++ } }))
  assert.equal(calls, 0)
})

test('default public gateway uses v3, authenticates and applies rate limits; QC2 remains readable', async () => {
  resetAuthRateLimitMemoryForTest()
  const f = fixture()
  const counters = new Map()
  const rateStorage = {
    async getAuthRateLimitCounter(k, w) { return counters.get(k + w) ?? null },
    async setAuthRateLimitCounter(k, w, v) { counters.set(k + w, v) },
    async pruneAuthRateLimitCounters() {},
  }
  const gateway = createCircleOpenGateway({ backend: f.backend, getStore: () => f.blob, rateStorage, now: f.now })
  const call = async (path, method = 'GET', token = OWNER, body) => {
    const response = await gateway.handle({ clientIp: '192.0.2.5', request: new Request('https://q.smhe.cn/api/circle/v2' + path,
      { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }) })
    return { status: response.status, data: await response.json() }
  }
  const input = { name: 'Gateway', operationId: crypto.randomUUID() }
  assert.equal((await call('', 'POST', null, input)).status, 401)
  assert.equal((await call('', 'POST', 'bad', input)).status, 401)
  assert.equal(f.data.size, 0)
  const c = await call('', 'POST', OWNER, input)
  assert.equal(c.status, 202)
  assert.equal(c.data.consistency, 'strong')
  assert.match(c.data.result.inviteCode, /^QC3-/)
  const id = c.data.result.circleId
  assert.equal((await call('/' + id)).data.result.schemaVersion, 3)
  assert.equal((await call('/mine')).data.result.circles.length, 1)
  assert.equal((await call('/' + id + '/days/' + DAY)).status, 200)
  assert.equal((await call('/join', 'POST', MEMBER, { inviteCode: c.data.result.inviteCode })).status, 202)
  assert.equal((await call('/' + id + '/progress/' + DAY, 'POST', MEMBER,
    { eventId: 'gateway_event', completed: true, newWords: 10, actorUserId: OWNER })).status, 400)
  const log = createCircleEventLog(f.blob)
  const legacy = createCircleEventualService({ log, authenticate: f.backend.me })
  const oldInput = { name: 'Legacy', operationId: crypto.randomUUID() }
  const old = await legacy.createCircle(OWNER, oldInput)
  const oldEvents = [...f.data.keys()].filter((k) => k.includes('/events/'))
  assert.equal((await call('/' + old.circleId)).data.result.schemaVersion, 2)
  assert.equal((await call('/join', 'POST', OTHER, { inviteCode: old.inviteCode })).status, 202)
  const oldRetry = await call('', 'POST', OWNER, oldInput)
  assert.equal(oldRetry.data.result.inviteCode, old.inviteCode)
  assert.equal([...f.data.keys()].filter((k) => k.endsWith('/meta.json')).length, 1)
  oldEvents.forEach((k) => assert.ok(f.data.has(k)))
  for (let i = 0; i < 70; i++) {
    const response = await call('/mine')
    if (response.status === 429) return
  }
  assert.fail('rate limit not enforced')
})


test('a late summary overwrite is detected by source hash and one summary object remains', async () => {
  const f = fixture()
  const c = await pair(f)
  await publish(f, c.circleId)
  await f.service.getDay(OWNER, c.circleId, DAY)
  const key = root(c.circleId) + 'summaries/' + DAY + '/view.json'
  const old = structuredClone(f.data.get(key))
  await publish(f, c.circleId, MEMBER, DAY, { eventId: 'late_event_01', newWords: 100 })
  assert.equal((await f.service.getDay(OWNER, c.circleId, DAY)).progress[0].newWords, 100)
  f.data.set(key, old) // A slow earlier request writes after a newer request.
  assert.equal((await f.service.getDay(OWNER, c.circleId, DAY)).progress[0].newWords, 100)
  assert.equal([...f.data.keys()].filter((k) => k.includes('/summaries/')).length, 1)
})

test('50-member all-to-all reactions fit the public response budget as counts', async () => {
  const f = fixture()
  const c = await f.create()
  const users = [OWNER, ...Array.from({ length: 49 }, (_, i) => 'user_' + String(i).padStart(4, '0'))]
  for (const user of users.slice(1)) await f.service.joinCircle(user, c.inviteCode)
  for (const user of users) await publish(f, c.circleId, user)
  for (const user of users) {
    for (const target of users) {
      if (user === target) continue
      const record = { schemaVersion: 3, circleId: c.circleId, day: DAY, actorUserId: user,
        type: 'clap', payload: { targetUserId: target } }
      f.data.set(activityKey(record), record)
    }
  }
  const view = await f.service.getCircle(OWNER, c.circleId)
  assert.equal(view.reactionCounts.length, 50)
  assert.ok(view.reactionCounts.every((r) => r.count === 49))
  assert.equal(view.claps, undefined)
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, consistency: 'eventual', result: view })) < 65536)
})

test('maintenance drains a partition larger than read budget, even after interrupted delete response', async () => {
  const f = fixture({ pageSize: 1000 })
  const c = await f.create()
  for (let i = 0; i < 10001; i++) {
    f.data.set(root(c.circleId) + 'days/2026-10-19/' + MEMBER + '/' + i.toString(16).padStart(64, '0') + '.json', {})
  }
  let result = await sweepCircleV3(f.blob, { now: NOW, execute: true, maxPages: 4, maxDeletes: 1 })
  let state = result.checkpoint
  assert.ok(state)
  let once = true
  f.hooks.afterDelete = async () => { if (once) { once = false; throw new Error('lost response') } }
  await assert.rejects(sweepCircleV3(f.blob, { now: NOW, execute: true, checkpoint: state }), code('circle_write_unknown'))
  delete f.hooks.afterDelete
  let rounds = 0
  do {
    result = await sweepCircleV3(f.blob, { now: NOW, execute: true, checkpoint: state, maxDeletes: 1000 })
    state = result.checkpoint
    assert.ok(++rounds < 30)
  } while (state)
  assert.equal([...f.data.keys()].filter((key) => key.includes('/days/2026-10-19/')).length, 0)
  assert.ok(f.data.has(root(c.circleId) + 'meta.json'))
})


test('deployed Circle gateway uses the trusted native receiver once, before any storage mutation', async () => {
  resetAuthRateLimitMemoryForTest()
  const f = fixture()
  const counters = new Map()
  const rateStorage = {
    async getAuthRateLimitCounter(k, w) { return counters.get(k + w) ?? null },
    async setAuthRateLimitCounter(k, w, v) { counters.set(k + w, v) },
    async pruneAuthRateLimitCounters() {},
  }
  const gateway = createCircleOpenGateway({ backend: f.backend, getStore: () => f.blob, rateStorage, now: f.now })
  let reads = 0
  const request = {
    url: 'https://t.smhe.cn/api/circle/v2', method: 'POST',
    headers: new Headers({ authorization: 'Bearer ' + OWNER, 'content-type': 'application/json' }),
    // Maker's native body is not required to expose getReader().
    get body() { throw new Error('Web stream receiver must not be touched') },
  }
  const call = async (body, reject = false, authenticated = true) => {
    request.headers.set('authorization', authenticated ? 'Bearer ' + OWNER : '')
    const response = await gateway.handle({ clientIp: '192.0.2.61', request,
      readBody: async (limit) => { reads++; assert.equal(limit, 8192); if(reject) throw new AppError(503, 'request_body_unavailable', 'receiver'); return body },
    })
    return { status: response.status, value: await response.json() }
  }
  assert.equal((await call({ name: '', operationId: crypto.randomUUID() })).value.error, 'invalid_circle_input')
  assert.equal(f.data.size, 0)
  assert.equal((await call({ name: 'hh', operationId: crypto.randomUUID(), actor: OTHER })).value.error, 'unexpected_field')
  assert.equal(f.data.size, 0)
  assert.equal((await call({}, true)).value.error, 'request_body_unavailable')
  assert.equal(f.data.size, 0)
  const before = reads
  assert.equal((await call({}, false, false)).status, 401)
  assert.equal(reads, before)
  const created = await call({ name: 'hh', operationId: crypto.randomUUID() })
  assert.equal(created.status, 202)
  assert.match(created.value.result.inviteCode, /^QC3-/)
  assert.equal(reads, before + 1)
})


test('custom Chinese/English passphrase joins directly, owner rotation invalidates the old phrase without removing members', async () => {
  const f=fixture(); const input={name:'中文圈',operationId:crypto.randomUUID(),passphrase:'  每天学 English  '}
  const c=await f.create(OWNER,input)
  assert.equal(c.inviteCode,'每天学 English')
  assert.equal((await f.service.joinCircle(MEMBER,'每天学 English')).circleId,c.circleId)
  const stored=f.data.get(root(c.circleId)+'meta.json')
  assert.equal(stored.inviteText,'每天学 English')
  assert.equal((await f.service.getCircle(OWNER,c.circleId)).ownerInviteCode,'每天学 English')
  assert.equal((await f.service.getCircle(MEMBER,c.circleId)).ownerInviteCode,undefined)
  assert.equal((await f.service.getDay(MEMBER,c.circleId,DAY)).ownerInviteCode,undefined)
  assert.ok(f.calls.some(x=>x.op==='list'&&x.prefix.startsWith('social/v3/passphrases/')&&x.consistency==='strong'))
  await assert.rejects(f.service.setPassphrase(MEMBER,c.circleId,{passphrase:'越权操作'}),code('not_circle_owner'))
  await f.service.setPassphrase(OWNER,c.circleId,{passphrase:'一起学中文 ABC'})
  await assert.rejects(f.service.joinCircle(OTHER,'每天学 English'),code('invalid_invite'))
  assert.equal((await f.service.joinCircle(OTHER,'一起学中文 ABC')).circleId,c.circleId)
  assert.equal((await f.service.getCircle(MEMBER,c.circleId)).members.length,3)
  const retry=await f.service.createCircle(OWNER,input)
  assert.equal(retry.circleId,c.circleId);assert.equal(retry.inviteChanged,true);assert.equal(retry.inviteCode,undefined)
  await assert.rejects(f.service.joinCircle(OTHER,'每天学 English'),code('invalid_invite'))
})

test('Unicode normalization, case distinction and passphrase length validation are deterministic', async () => {
  const f=fixture()
  for(const passphrase of ['', 'a', '中', 'a'.repeat(33), 'ab\ncd', 'ab\u200bcd']) {
    await assert.rejects(f.create(OWNER,{passphrase}),code('invalid_circle_passphrase'))
  }
  assert.equal(f.data.size,0)
  const c=await f.create(OWNER,{passphrase:'Café 中文'})
  assert.equal((await f.service.joinCircle(MEMBER,'Cafe\u0301 中文')).circleId,c.circleId)
  await assert.rejects(f.service.joinCircle(OTHER,'café 中文'),code('invalid_invite'))
})

test('occupied passphrases are rejected and closure releases the lookup entry', async () => {
  const f=fixture();const c=await f.create(OWNER,{passphrase:'共同学习'})
  await assert.rejects(f.create(OTHER,{passphrase:'共同学习'}),code('circle_passphrase_taken'))
  assert.equal((await f.service.listMyCircles(OTHER)).circles.length,0)
  await f.service.closeCircle(OWNER,c.circleId)
  assert.equal([...f.data.keys()].filter(k=>k.startsWith('social/v3/passphrases/')).length,0)
  const next=await f.create(OTHER,{passphrase:'共同学习'})
  assert.equal((await f.service.joinCircle(MEMBER,'共同学习')).circleId,next.circleId)
})

test('simultaneous same-phrase creations never route a join to an arbitrary circle', async () => {
  const f=fixture();let arrived=0;let release;const gate=new Promise(resolve=>{release=resolve})
  f.hooks.beforeSet=async key=>{if(key.endsWith('/meta.json')){if(++arrived===2)release();await gate}}
  await Promise.all([f.create(OWNER,{passphrase:'并发口令'}),f.create(OTHER,{passphrase:'并发口令'})])
  await assert.rejects(f.service.joinCircle(MEMBER,'并发口令'),code('circle_passphrase_conflict'))
  assert.equal((await f.service.listMyCircles(MEMBER)).circles.length,0)
})

test('legacy invitation can be changed by its owner and original creation retry never restores it', async () => {
  const f=fixture();const input={name:'Old',operationId:crypto.randomUUID()};const c=await f.create(OWNER,input)
  await f.service.joinCircle(MEMBER,c.inviteCode)
  await f.service.setPassphrase(OWNER,c.circleId,{passphrase:'新的 English'})
  await assert.rejects(f.service.joinCircle(OTHER,c.inviteCode),code('invalid_invite'))
  const retry=await f.service.createCircle(OWNER,input)
  assert.equal(retry.inviteChanged,true)
  assert.equal((await f.service.joinCircle(OTHER,'新的 English')).circleId,c.circleId)
})


test('owner invitation is server-readable without hints; old hashed records remain compatible and corruption fails closed', async () => {
  const f=fixture();const c=await f.create(OWNER,{passphrase:'原有口令 English'})
  const key=root(c.circleId)+'meta.json'
  const old=f.data.get(key);delete old.inviteText;f.data.set(key,old)
  assert.equal((await f.service.getCircle(OWNER,c.circleId)).ownerInviteCode,undefined)
  await f.service.setPassphrase(OWNER,c.circleId,{passphrase:'原有口令 English'})
  assert.equal((await f.service.getDay(OWNER,c.circleId,DAY)).ownerInviteCode,'原有口令 English')
  await f.service.joinCircle(MEMBER,'原有口令 English')
  assert.equal(JSON.stringify(await f.service.getCircle(MEMBER,c.circleId)).includes('原有口令 English'),false)
  f.data.set(key,{...f.data.get(key),inviteText:'已损坏的口令'})
  await assert.rejects(f.service.getCircle(OWNER,c.circleId),code('circle_control_uncertain'))
})

test('parallel detail reads retain final session, membership and closure checks', async () => {
  for(const change of ['revoke','remove','close']) {
    const f=fixture();const c=await pair(f)
    f.hooks.list=async ({prefix})=>{
      if(prefix.includes('/days/')) {
        if(change==='revoke')f.revoked.add(MEMBER)
        if(change==='remove')f.data.delete(root(c.circleId)+'members/'+MEMBER+'.json')
        if(change==='close')f.data.set(root(c.circleId)+'closed.json',{schemaVersion:3,circleId:c.circleId,closed:true})
      }
    }
    await assert.rejects(f.service.getDay(MEMBER,c.circleId,DAY),code(change==='revoke'?'session_revoked':change==='remove'?'not_circle_member':'circle_closed'))
  }
})

test('daily source listing and summary read start concurrently without losing cache validation', async () => {
  let release
  const waiting=new Promise(resolve=>{release=resolve})
  const storage={
    keys:async()=>{await waiting;return []},
    get:async()=>{release();return null},
  }
  const result=await createDailyViews(storage).read('a'.repeat(24),DAY)
  assert.deepEqual(result.progress,[])
})


test('nicknames are circle-scoped, blank defaults to authenticated username, and create retry keeps exact nickname', async () => {
  const f=fixture({etags:true,usernames:{[OWNER]:'OwnerName',[MEMBER]:'小明'}})
  const input={name:'昵称圈',operationId:crypto.randomUUID(),passphrase:'昵称口令',nickname:'  晨读者  '}
  const c=await f.service.createCircle(OWNER,input)
  await f.service.joinCircle(MEMBER,c.inviteCode,{nickname:'  '})
  let view=await f.service.getCircle(OWNER,c.circleId)
  assert.equal(view.members.find(m=>m.userId===OWNER).nickname,'晨读者')
  assert.equal(view.members.find(m=>m.userId===MEMBER).nickname,'小明')
  await f.service.createCircle(OWNER,input)
  await assert.rejects(f.service.createCircle(OWNER,{...input,nickname:'改名'}),code('circle_operation_conflict'))
  const other=await f.create(OWNER,{passphrase:'另一个口令'})
  await f.service.joinCircle(MEMBER,other.inviteCode,{nickname:'English Buddy'})
  assert.equal((await f.service.getCircle(OWNER,other.circleId)).members.find(m=>m.userId===OWNER).nickname,'OwnerName')
  assert.equal((await f.service.getCircle(OWNER,other.circleId)).members.find(m=>m.userId===MEMBER).nickname,'English Buddy')
  assert.equal((await f.service.getCircle(MEMBER,c.circleId)).members.find(m=>m.userId===MEMBER).nickname,'小明')
  for(const nickname of ['x'.repeat(33),'x\ny','x\u200by',42,null]) await assert.rejects(f.service.joinCircle(OTHER,c.inviteCode,{nickname}),code('invalid_circle_nickname'))
  assert.equal((await f.service.listMyCircles(OTHER)).circles.length,0)
})

test('roster cache avoids peer GETs at 50 members, invalidates on same-key nickname change and cannot admit a removed user', async () => {
  const f=fixture({etags:true});const c=await f.create(OWNER,{nickname:'圈主'})
  for(let i=0;i<49;i++){const uid='peer_'+String(i).padStart(4,'0');f.data.set(root(c.circleId)+'members/'+uid+'.json',{schemaVersion:3,circleId:c.circleId,userId:uid,nickname:'同学 '+i})}
  assert.equal((await f.service.getCircle(OWNER,c.circleId)).members.length,50)
  f.calls.length=0
  await f.service.getCircle(OWNER,c.circleId)
  assert.equal(f.calls.filter(c=>c.op==='get'&&c.key.includes('/members/peer_')).length,0)
  const key=root(c.circleId)+'members/peer_0000.json';f.data.set(key,{...f.data.get(key),nickname:'新昵称'})
  assert.equal((await f.service.getCircle(OWNER,c.circleId)).members.find(m=>m.userId==='peer_0000').nickname,'新昵称')
  await f.service.removeMember(OWNER,c.circleId,'peer_0000')
  await assert.rejects(f.service.getCircle('peer_0000',c.circleId),code('not_circle_member'))
  assert.equal((await f.service.getCircle(OWNER,c.circleId)).members.length,49)
})

test('no-ETag provider never reuses stale nickname cache; old records and legacy callers stay compatible', async () => {
  const f=fixture();const c=await pair(f)
  assert.equal((await f.service.getCircle(OWNER,c.circleId)).members.find(m=>m.userId===MEMBER).nickname,undefined)
  await f.service.joinCircle(MEMBER,c.inviteCode,{nickname:'A'})
  assert.equal((await f.service.getCircle(OWNER,c.circleId)).members.find(m=>m.userId===MEMBER).nickname,'A')
  await f.service.joinCircle(MEMBER,c.inviteCode)
  assert.equal((await f.service.getCircle(OWNER,c.circleId)).members.find(m=>m.userId===MEMBER).nickname,'A')
  await f.service.leaveCircle(MEMBER,c.circleId)
  await f.service.joinCircle(MEMBER,c.inviteCode,{nickname:'B'})
  assert.equal((await f.service.getCircle(OWNER,c.circleId)).members.find(m=>m.userId===MEMBER).nickname,'B')
  assert.equal(f.data.has(root(c.circleId)+'roster.json'),false)
})

test('daily maintenance ignores the non-date roster cache', async () => {
  const f=fixture({etags:true});const c=await f.create(OWNER,{nickname:'Owner'})
  await f.service.getCircle(OWNER,c.circleId)
  assert.ok(f.data.has(root(c.circleId)+'roster.json'))
  let checkpoint=null,done=false
  while(!done){const result=await sweepCircleV3(f.blob,{now:NOW,execute:true,checkpoint});done=result.complete;checkpoint=result.checkpoint}
  assert.ok(f.data.has(root(c.circleId)+'roster.json'))
})


test('roster cache never binds a changed GET body to an older listed ETag', async () => {
  const f=fixture({etags:true});const c=await f.create(OWNER,{nickname:'Old'})
  f.hooks.get=async key=>key.endsWith('/members/'+OWNER+'.json')?{...f.data.get(key),nickname:'New'}:undefined
  await f.service.getCircle(OWNER,c.circleId)
  assert.equal(f.data.has(root(c.circleId)+'roster.json'),false)
  f.hooks.get=undefined
  assert.equal((await f.service.getCircle(OWNER,c.circleId)).members[0].nickname,'Old')
})


test('gateway reuses only initial admission identity; final read authentication remains fresh on every request', async () => {
  resetAuthRateLimitMemoryForTest()
  const f = fixture({etags:true})
  const c = await pair(f)
  let checks = 0
  const backend = {async me(token) { checks++; return f.backend.me(token) }}
  const rateStorage = {async getAuthRateLimitCounter(){return null},async setAuthRateLimitCounter(){}}
  const gateway = createCircleOpenGateway({backend,getStore:()=>f.blob,rateStorage,now:f.now})
  const read = () => gateway.handle({clientIp:'192.0.2.81',request:new Request('https://q.smhe.cn/api/circle/v2/'+c.circleId,{headers:{authorization:'Bearer '+MEMBER}})})
  assert.equal((await read()).status,200)
  assert.equal(checks,2,'one live admission and one live final session check')
  checks=0
  f.hooks.list=async options=>{if(options.prefix.includes('/days/'))f.revoked.add(MEMBER)}
  assert.equal((await read()).status,401,'revoked while loading data must not receive a view')
  assert.equal(checks,2)
  f.hooks.list=undefined
  checks=0
  assert.equal((await read()).status,401,'admission identity never survives to another request')
  assert.equal(checks,1)
})
