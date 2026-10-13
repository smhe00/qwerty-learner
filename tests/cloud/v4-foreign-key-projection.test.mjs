import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-ref-rekey-'))
const out = join(tmp, 'rekey.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v4-foreign-key-projection.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { projectV4ForeignKeys: project } = await import(pathToFileURL(out).href)

const a = '00000000-0000-4000-8000-000000000001'
const b = '00000000-0000-4000-8000-000000000002'
const mkWord = (id, attemptId, word) =>
  ({ id, attemptId, dict: 'school', word, timeStamp: 1800000000, chapter: -1,
    timing: [], wrongCount: 0, mistakes: {}, sourceMode: 'learn' })
const mkEvent = (id) => ({ eventId: 'word:' + id, eventType: 'word_attempt',
  origin: 'live', sourceRecordId: id, occurredAt: 1800000000, dict: 'school',
  metricValues: {}, unlockedAchievementIds: [] })
const side = (word, event = mkEvent(word.id)) => ({
  words: [word], chapters: [{
    id: 1, dict: word.dict, chapter: 0, timeStamp: word.timeStamp, time: 3,
    correctCount: 1, wrongCount: 0, wordCount: 1,
    correctWordIndexes: [0], wordNumber: 1, wordRecordIds: [word.id],
  }], events: [event], states: [],
})

test('cross-device equal numeric ID maps to different canonical word IDs', () => {
  const left = side(mkWord(1, a, 'alpha'))
  const right = side(mkWord(1, b, 'beta'))
  const x = project({ local: left, remote: right })
  assert.equal(x.status, 'projected')
  assert.equal(x.publishReady, false)
  assert.deepEqual(x.words.map(w => [w.id, w.word]), [[1, 'alpha'], [2, 'beta']])
  assert.deepEqual(x.chapters.map(c => c.wordRecordIds), [[1], [2]])
  assert.deepEqual(x.events.map(e => [e.eventId, e.sourceRecordId]),
    [['word:' + a, 1], ['word:' + b, 2]])
  assert.deepEqual(left.chapters[0].wordRecordIds, [1])
  assert.equal(left.words[0].id, 1)
})

test('shared UUID but different local numeric IDs deduplicates with repaired refs', () => {
  const left = side(mkWord(1, a, 'alpha'))
  const right = side(mkWord(99, a, 'alpha'), mkEvent(99))
  const x = project({ local: left, remote: right })
  assert.equal(x.status, 'projected')
  assert.equal(x.words.length, 1)
  assert.equal(x.events.length, 1)
  assert.equal(x.events[0].sourceRecordId, 1)
  assert.deepEqual(x.chapters.map(c => c.wordRecordIds), [[1], [1]])
})

test('dangling source IDs fail closed rather than misbind', () => {
  const left = side(mkWord(1, a, 'alpha'))
  left.chapters[0].wordRecordIds = [1234]
  assert.equal(project({ local: left, remote: side(mkWord(1, b, 'beta')) }).reason,
    'dangling-word-reference')
})

test('achievement unlocking provenance is rekeyed, but contradictions block', () => {
  const left = side(mkWord(1, a, 'alpha'))
  left.events[0].unlockedAchievementIds = ['first']
  left.states.push({ achievementId: 'first', unlockedAt: 1800000000,
    firstTriggerEventId: 'word:1', sourceRecordId: 1 })
  const empty = { words: [], chapters: [], events: [], states: [] }
  const x = project({ local: left, remote: empty })
  assert.equal(x.status, 'projected')
  assert.equal(x.states[0].firstTriggerEventId, 'word:' + a)
  assert.equal(x.states[0].sourceRecordId, 1)
  const copy = structuredClone(left)
  copy.states[0].unlockedAt += 1
  assert.equal(project({ local: left, remote: copy }).reason,
    'contradictory-achievement-state')
})

test('same UUID different immutable word evidence fails closed', () => {
  const left = side(mkWord(1, a, 'alpha'))
  const right = side(mkWord(1, a, 'wrong'))
  assert.equal(project({ local: left, remote: right }).reason,
    'contradictory-attempt')
})


test('seen and culture-card observations converge monotonically without minting unlocks', () => {
  const left = side(mkWord(1, a, 'alpha'))
  left.events[0].unlockedAchievementIds = ['first']
  left.states.push({ achievementId: 'first', unlockedAt: 1800000000,
    firstTriggerEventId: 'word:1', sourceRecordId: 1, seenAt: 1800000020 })
  const right = structuredClone(left)
  right.words[0].id = 88
  right.chapters[0].wordRecordIds = [88]
  right.events[0].eventId = 'word:88'
  right.events[0].sourceRecordId = 88
  right.states[0].firstTriggerEventId = 'word:88'
  right.states[0].sourceRecordId = 88
  right.states[0].seenAt = 1800000010
  right.states[0].cultureCardSeenAt = 1800000030
  const first = project({ local: left, remote: right })
  const reverse = project({ local: right, remote: left })
  assert.equal(first.status, 'projected')
  assert.equal(first.events.length, 1)
  assert.deepEqual(first.states, reverse.states)
  assert.equal(first.states[0].seenAt, 1800000020)
  assert.equal(first.states[0].cultureCardSeenAt, 1800000030)
})
