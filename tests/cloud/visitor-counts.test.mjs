/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readVisitorCounts, recordVisitor } from '../../cloud-functions/_shared/visitor-counts.js'

const a = 'a'.repeat(32), b = 'b'.repeat(32)
function fixture() {
  const objects = new Map(), calls = []
  let now = Date.parse('2026-10-30T15:59:59Z')
  const store = {
    async setJSON(key, data) { calls.push(['write', key, data]); objects.set(key, data) },
    async list({ prefix, cursor = '', limit }) {
      calls.push(['list', prefix])
      const keys = [...objects.keys()].filter(key => key.startsWith(prefix)).sort()
      const start = Number(cursor)
      // Force pagination to verify a day's IDs are counted across pages.
      const pageSize = Math.min(limit, 1)
      return { blobs: keys.slice(start, start + pageSize).map(key => ({ key })),
        cursor: start + pageSize < keys.length ? String(start + pageSize) : undefined }
    },
  }
  const visit = (id, extra = {}) => recordVisitor(new Request('https://q.smhe.cn/api/visits', {
    method: 'POST', headers: { 'sec-fetch-site': 'same-origin', ...(id ? { cookie: `qp_uv=${id}` } : {}), ...extra },
  }), () => store, { clock: () => now })
  return { objects, calls, store, visit, clock: () => now, setNow: value => { now = Date.parse(value) } }
}

test('same ID repeats count once per day; seven days sums days, not cross-day unique IDs', async () => {
  const f = fixture()
  const first = await f.visit(a)
  assert.equal(first.status, 204)
  assert.equal(first.headers.get('set-cookie'), null)
  await Promise.all(Array.from({ length: 10 }, () => f.visit(a)))
  await f.visit(b)
  assert.deepEqual(await readVisitorCounts(f.store, { clock: f.clock }), {
    today: 2, last7Days: 2, asOf: '2026-10-30T15:59:59.000Z', timeZone: 'Asia/Shanghai',
  })
  f.setNow('2026-10-30T16:00:01Z') // Beijing midnight, same visitor ID.
  await f.visit(a)
  const result = await readVisitorCounts(f.store, { clock: f.clock })
  assert.equal(result.today, 1)
  assert.equal(result.last7Days, 3)
  assert.equal(f.objects.size, 3)
  assert.ok([...f.objects.keys()].every(key => !key.includes(a) && !key.includes(b)))
  assert.ok([...f.objects.values()].every(data => JSON.stringify(data) === '{"v":1}'))
  f.setNow('2026-11-06T16:00:01Z')
  assert.equal((await readVisitorCounts(f.store, { clock: f.clock })).last7Days, 0)
})

test('unavailable storage and blocked/malformed requests are silent and cannot select another namespace', async () => {
  const request = new Request('https://q.smhe.cn/api/visits', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', cookie: `qp_uv=${a}` } })
  for (const fail of [() => { throw Error('factory failure') }, () => ({ setJSON: async () => { throw Error('write failure') } })]) {
    const result = await recordVisitor(request, fail)
    assert.equal(result.status, 204)
    assert.equal(await result.text(), '')
    assert.equal(result.headers.get('cache-control'), 'no-store')
  }
  let opened = 0
  for (const init of [
    { method: 'GET' },
    { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } },
    { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', 'content-length': '3' }, body: 'abc' },
  ]) {
    assert.equal((await recordVisitor(new Request('https://q.smhe.cn/api/visits', init), () => { opened++; throw Error('unexpected') })).status, 204)
  }
  assert.equal(opened, 0)
  const f = fixture()
  for (const cookie of ['', 'qp_uv=../../accounts/private']) {
    const result = await f.visit(undefined, { cookie })
    assert.equal(result.headers.get('set-cookie'), null)
  }
  assert.equal(f.objects.size, 0)
  await f.visit(a)
  assert.ok([...f.objects.keys()].every(key => /^metrics\/visitors\/v1\/2026-10-30\/[a-f0-9]{64}\.json$/.test(key)))
})

test('statistics never touches account/learning storage and never returns partial totals as zero', async () => {
  const f = fixture()
  await f.visit(a)
  f.objects.set('accounts/private/identity.json', { secret: true })
  f.objects.set('users/private/history.json', { word: 'private' })
  const result = await readVisitorCounts(f.store, { clock: f.clock })
  assert.equal(result.today, 1)
  assert.ok(f.calls.every(([, key]) => key.startsWith('metrics/visitors/v1/')))
  await assert.rejects(readVisitorCounts({ list: async () => { throw Error('list failed') } }), /list failed/)
  await assert.rejects(readVisitorCounts({ list: async () => ({ blobs: [{ key: 'accounts/private' }] }) }), /namespace mismatch/)
  let page = 0
  await assert.rejects(readVisitorCounts({ list: async () => ({ blobs: [], cursor: String(++page) }) }, { clock: f.clock }), /scan limit/)
})
