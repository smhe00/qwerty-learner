/* eslint-env node */
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-auto-merge-'))
const out = join(tmp, 'merge.mjs')
await build({
  entryPoints: [resolve(root, 'src/sync/automatic-v4-records.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json'),
})
after(() => rmSync(tmp, { recursive: true, force: true }))
const { mergeDecodedV4Tables: merge, mergeValueKey: key } = await import(pathToFileURL(out).href)
const empty = () => ({
  wordRecords: [],
  chapterRecords: [],
  reviewRecords: [],
  reviewWordStates: [],
  achievementEvents: [],
  achievementStates: [],
})
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const word = (id, name, modern = false) => ({
  id,
  ...(modern ? { attemptId: uuid(id) } : {}),
  dict: 'book',
  word: name,
  timeStamp: 1_800_000_000 + id,
  chapter: 0,
  timing: [100],
  wrongCount: 0,
  mistakes: {},
})
const session = (id, index, extra = {}) => ({
  id,
  sessionId: uuid(50),
  dict: 'book',
  createTime: 1_800_000_000,
  index,
  isFinished: false,
  words: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
  ...extra,
})

test('forked local numeric IDs union without fabricated attempt IDs and repeat without growth', () => {
  const a = empty(),
    b = empty()
  a.wordRecords = [word(1, 'shared'), word(2, 'left')]
  b.wordRecords = [word(1, 'shared'), word(2, 'right')]
  const before = structuredClone([a, b])
  const merged = merge(a, b)
  assert.equal(merged.wordRecords.length, 3)
  assert.equal(
    merged.wordRecords.some((r) => 'attemptId' in r),
    false,
  )
  assert.deepEqual(merge(b, a), merged)
  assert.deepEqual(merge(merged, a), merged)
  assert.deepEqual(merge(b, merged), merged)
  assert.deepEqual(merge(merged, merged), merged)
  assert.deepEqual([a, b], before)
})

test('identical legacy payloads retain maximum existing multiplicity', () => {
  const a = empty(),
    b = empty()
  a.wordRecords = [word(1, 'same'), { ...word(1, 'same'), id: 2 }]
  b.wordRecords = [{ ...word(1, 'same'), id: 55 }]
  const m = merge(a, b)
  assert.equal(m.wordRecords.length, 2)
  assert.deepEqual(merge(m, b), m)
})

test('stable IDs never collapse distinct real reviews, even within the same second', () => {
  const a = empty(),
    b = empty()
  a.wordRecords = [
    { ...word(1, 'alpha', true), chapter: -1, sourceMode: 'learn', learnItemKind: 'acquisition' },
    {
      ...word(2, 'alpha', true),
      chapter: -1,
      sourceMode: 'learn',
      learnItemKind: 'review',
      timeStamp: 1_800_086_400,
      reviewRatingDecision: { eligible: true, rating: 'good', confidence: 1, reasonCodes: [] },
    },
  ]
  b.wordRecords = [a.wordRecords[0], { ...a.wordRecords[1], id: 2, attemptId: uuid(3) }]
  const m = merge(a, b)
  assert.equal(m.wordRecords.length, 3)
  assert.equal(m.reviewWordStates[0].reviewCount, 2)
  assert.equal(m.reviewWordStates[0].schedulerState.kind, 'fsrs6')
  assert.deepEqual(merge(m, b), m)
  assert.deepEqual(merge(b, a), m)
})

test('contradictory immutable UUID and dangling references still refuse candidate', () => {
  const a = empty(),
    b = empty()
  a.wordRecords = [word(1, 'one', true)]
  b.wordRecords = [{ ...word(1, 'one', true), wrongCount: 2 }]
  assert.throws(() => merge(a, b), /contradictory-attempt/)
  b.wordRecords = []
  b.chapterRecords = [{ id: 1, dict: 'book', wordRecordIds: [999] }]
  assert.throws(() => merge(a, b), /dangling-word-reference/)
})

test('chapter, achievement and embedded shadow references follow rebased word identity', () => {
  const a = empty(),
    b = empty()
  a.wordRecords = [word(1, 'left')]
  b.wordRecords = [{ ...word(1, 'right'), fsrsShadow: { sourceRecordId: 1, value: 7 } }]
  a.chapterRecords = [{ id: 1, dict: 'book', wordRecordIds: [1], chapter: 1 }]
  b.chapterRecords = [{ id: 1, dict: 'book', wordRecordIds: [1], chapter: 2 }]
  for (const [side, name] of [
    [a, 'left'],
    [b, 'right'],
  ]) {
    side.achievementEvents = [
      {
        eventId: 'word:1',
        eventType: 'word_attempt',
        origin: 'live',
        sourceRecordId: 1,
        occurredAt: 10,
        dict: 'book',
        word: name,
        metricValues: {},
        unlockedAchievementIds: [],
      },
    ]
    side.achievementStates = [{ achievementId: name, firstTriggerEventId: 'word:1', sourceRecordId: 1, unlockedAt: 10 }]
  }
  const m = merge(a, b)
  const find = (id) => m.wordRecords.find((r) => r.id === id).word
  for (const row of m.achievementEvents) assert.equal(find(row.sourceRecordId), row.word)
  for (const row of m.achievementStates) {
    assert.equal(find(row.sourceRecordId), row.achievementId)
    assert.equal(m.achievementEvents.find((e) => e.eventId === row.firstTriggerEventId).word, row.achievementId)
  }
  assert.equal(find(m.chapterRecords.find((c) => c.chapter === 2).wordRecordIds[0]), 'right')
  const shadow = m.wordRecords.find((r) => r.word === 'right')
  assert.equal(shadow.fsrsShadow.sourceRecordId, shadow.id)
  assert.deepEqual(merge(m, b), m)
  assert.deepEqual(merge(b, a), m)
})

test('session arbitration selects a whole stored variant and keeps object aliases', () => {
  const a = empty(),
    b = empty()
  const shared = { name: 'shared', trans: ['meaning'] }
  a.reviewRecords = [session(1, 1, { words: [shared, shared, shared], marker: 'left' })]
  b.reviewRecords = [session(7, 2, { words: [shared, shared, shared], marker: 'right' })]
  const m = merge(a, b)
  assert.equal(m.reviewRecords.length, 1)
  assert.equal(m.reviewRecords[0].marker, 'right')
  assert.equal(m.reviewRecords[0].words[0], m.reviewRecords[0].words[1])
  assert.deepEqual(merge(b, a), m)
  assert.deepEqual(merge(m, a), m)
})

test('legacy shared-reference sessions deduplicate without destroying aliases', () => {
  const a = empty(),
    b = empty()
  const shared = { name: 'shared' }
  a.reviewRecords = [{ ...session(1, 0), sessionId: undefined, words: [shared, shared] }]
  b.reviewRecords = [structuredClone(a.reviewRecords[0])]
  b.reviewRecords[0].id = 20
  const m = merge(a, b)
  assert.equal(m.reviewRecords.length, 1)
  assert.equal(m.reviewRecords[0].words[0], m.reviewRecords[0].words[1])
})

test('manual exclusion and richer old scheduler evidence survive sparse history', () => {
  const a = empty(),
    b = empty()
  const s = {
    id: 1,
    dict: 'book',
    word: 'alpha',
    reviewCount: 20,
    lastReviewedAt: 1000,
    updatedAt: 1000,
    nextReviewAt: 8000,
    lifecycle: 'active',
    schedulerState: { kind: 'basic-v2' },
  }
  a.reviewWordStates = [s]
  b.reviewWordStates = [{ ...s, id: 9, nextReviewAt: 4000, updatedAt: 900 }]
  let m = merge(a, b)
  assert.equal(m.reviewWordStates[0].reviewCount, 20)
  assert.equal(m.reviewWordStates[0].nextReviewAt, 4000)
  b.reviewWordStates[0] = { ...b.reviewWordStates[0], lifecycle: 'excluded', exclusion: { excludedAt: 900 } }
  m = merge(a, b)
  assert.equal(m.reviewWordStates[0].lifecycle, 'excluded')
  assert.deepEqual(merge(m, a), m)
})

test('achievements retain earliest earned grant, seen flags and queued awards without granting new ones', () => {
  const a = empty(),
    b = empty()
  a.achievementStates = [{ achievementId: 'earned', unlockedAt: 20, seenAt: 30 }]
  b.achievementStates = [{ achievementId: 'earned', unlockedAt: 10, cultureCardSeenAt: 40 }]
  const queue = (awards) => ({
    eventId: 'queue',
    eventType: 'unlock_queue',
    origin: 'live',
    dict: 'book',
    occurredAt: 50,
    metricValues: {},
    unlockedAchievementIds: [],
    pendingAwards: awards,
  })
  a.achievementEvents = [queue([{ achievementId: 'next-A', triggeredAt: 5 }])]
  b.achievementEvents = [queue([{ achievementId: 'next-B', triggeredAt: 8 }])]
  const m = merge(a, b)
  assert.equal(m.achievementStates.length, 1)
  assert.deepEqual(m.achievementStates[0], { achievementId: 'earned', unlockedAt: 10, seenAt: 30, cultureCardSeenAt: 40 })
  assert.deepEqual(
    m.achievementEvents[0].pendingAwards.map((r) => r.achievementId),
    ['next-A', 'next-B'],
  )
  assert.deepEqual(merge(m, b), m)
})

test('three-device legacy append forks converge across merge order for 25 fixture partitions', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const sides = [empty(), empty(), empty()]
    for (let i = 0; i < 15; i++) {
      sides.forEach((side, device) => {
        if ((i * seed + device) % 4 !== 0) side.wordRecords.push({ ...word(i + 1, 'w' + i), id: side.wordRecords.length + 1 })
      })
    }
    const x = merge(merge(sides[0], sides[1]), sides[2])
    assert.deepEqual(merge(sides[0], merge(sides[1], sides[2])), x)
    assert.deepEqual(merge(sides[2], merge(sides[1], sides[0])), x)
  }
})

test('lossless key distinguishes undefined, negative zero, sparse holes, Dates and alias topology', () => {
  assert.notEqual(key({ value: undefined }), key({}))
  assert.notEqual(key(-0), key(0))
  const sparse = Array(2)
  sparse[1] = 1
  assert.notEqual(key(sparse), key([undefined, 1]))
  assert.notEqual(key(new Date(0)), key('1970-01-01T00:00:00.000Z'))
  const buffer = new ArrayBuffer(8)
  assert.notEqual(key([buffer, new Uint8Array(buffer)]), key([buffer, new Uint8Array(new ArrayBuffer(8))]))
  assert.notEqual(key(new Uint8Array(buffer, 0, 4)), key(new Uint8Array(buffer, 4, 4)))
  const x = { a: 1 }
  assert.notEqual(key([x, x]), key([{ a: 1 }, { a: 1 }]))
})
