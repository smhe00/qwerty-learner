/* eslint-env node */
import { createAdministratorOverview } from '../../cloud-functions/_shared/administrator-overview.js'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

const now = Date.parse('2026-10-29T12:00:00Z')
const actor = { userId: 'a'.repeat(32), username: 'admin' }
function fixture() {
  const objects = new Map(),
    reads = [],
    lists = []
  const administrator = { isAdministrator: (i) => i.userId === actor.userId && ['admin', 'smhe'].includes(i.normalizedUsername) }
  const store = {
    async get(key) {
      reads.push(key)
      return structuredClone(objects.get(key) ?? null)
    },
    async list({ prefix, cursor = '', limit }) {
      lists.push({ prefix, limit })
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort(),
        start = Number(cursor)
      return {
        blobs: keys.slice(start, start + limit).map((key) => ({ key })),
        cursor: start + limit < keys.length ? String(start + limit) : '',
      }
    },
  }
  function account(username, id = 'b'.repeat(32)) {
    const hash = createHash('sha256').update(username).digest('hex')
    objects.set(`accounts/${hash}/identity.json`, {
      username,
      normalizedUsername: username,
      usernameHash: hash,
      userId: id,
      status: 'active',
      createdAt: new Date(now).toISOString(),
      initialAuth: { passwordHash: 'NEVER RETURN' },
    })
    return id
  }
  return { objects, reads, lists, store, account, overview: createAdministratorOverview({ store, administrator, clock: () => now }) }
}
test('statistics denies ordinary or forged admin identities before any storage access', async () => {
  const f = fixture()
  for (const user of [
    { ...actor, userId: 'b'.repeat(32), role: 'administrator' },
    { ...actor, username: 'student' },
  ])
    await assert.rejects(f.overview.read(user), { statusCode: 403 })
  assert.deepEqual(f.reads, [])
  assert.deepEqual(f.lists, [])
})
test('bounded read-only statistics exclude administrator, deduplicate attempts and expose no authentication or learning content', async () => {
  const f = fixture()
  f.account('smhe', actor.userId)
  const id = f.account('student')
  const day = '2026-10-29'
  f.objects.set(`maintenance/idle/v1/${id}/days/${day}.json`, { day })
  const event = { attemptId: 'id-1', timeStamp: now / 1000 - 10, word: 'private word' }
  f.objects.set(`users/${id}/event-batches/v2/device/1.json`, { events: [event] })
  f.objects.set(`users/${id}/event-batches/v2/device/2.json`, {
    events: [event, { ...event, attemptId: 'id-2', timeStamp: now / 1000 - 8 * 86400 }],
  })
  f.objects.set(`accounts/${'1'.repeat(64)}/auth/secret.json`, { passwordHash: 'NEVER READ' })
  const before = structuredClone([...f.objects])
  const result = await f.overview.read(actor)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].attempts, 2)
  assert.equal(result.rows[0].recentAttempts, 1)
  assert.deepEqual(result.rows[0].activeDays, [day])
  assert.equal(result.rows[0].historyComplete, true)
  assert.equal(result.nextCursor, null)
  assert.equal(result.eventualConsistency, true)
  assert.ok(!JSON.stringify(result).includes('private word'))
  assert.ok(!JSON.stringify(result).includes('NEVER'))
  assert.ok(f.reads.every((k) => !k.includes('/auth/') && !k.includes('/revisions/')))
  assert.deepEqual([...f.objects], before)
})
test('missing or conflicting history is unknown and truncated history is explicitly partial', async () => {
  for (const mode of ['missing', 'conflict', 'partial']) {
    const f = fixture(),
      id = f.account('student')
    const event = { attemptId: 'id-1', timeStamp: now / 1000 - 10, word: 'first' }
    for (let i = 0; i < (mode === 'partial' ? 13 : 1); i++)
      f.objects.set(
        `users/${id}/event-batches/v2/device/${i}.json`,
        mode === 'missing'
          ? null
          : { events: mode === 'conflict' ? [event, { ...event, word: 'contradictory' }] : [{ ...event, attemptId: 'id-' + i }] },
      )
    const row = (await f.overview.read(actor)).rows[0]
    assert.equal(row.historyComplete, false)
    assert.equal(row.metadataAvailable, mode === 'partial')
    assert.equal(row.attempts, mode === 'partial' ? 12 : null)
  }
})
test('non-identity account keys are skipped within a bounded scan and cursor always permits continuation', async () => {
  const f = fixture()
  for (let i = 0; i < 40; i++) f.objects.set('accounts/000/' + String(i).padStart(2, '0'), { secret: true })
  f.account('student')
  const first = await f.overview.read(actor)
  assert.equal(first.rows.length, 0)
  assert.ok(first.nextCursor)
  assert.equal(f.lists.length, 6)
  const second = await f.overview.read(actor, first.nextCursor)
  assert.equal(second.rows[0].username, 'student')
  assert.equal(second.nextCursor, null)
  assert.ok(f.reads.every((k) => !k.startsWith('accounts/000/')))
})
test('malformed list and mismatched identity fail closed rather than showing false complete zero', async () => {
  const f = fixture()
  f.account('student')
  const key = [...f.objects.keys()][0]
  f.objects.get(key).usernameHash = 'bad'
  await assert.rejects(f.overview.read(actor), { statusCode: 503 })
  f.store.list = async () => ({ blobs: [{ key: 'outside-prefix' }] })
  await assert.rejects(f.overview.read(actor), { statusCode: 503 })
})
