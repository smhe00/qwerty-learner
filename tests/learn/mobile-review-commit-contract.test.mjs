import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL('../../' + path, import.meta.url), 'utf8')

test('Mobile and desktop write the same durable FSRS projection after WordRecord', async () => {
  const [mobile, desktop, helper] = await Promise.all([
    read('src/pages/Typing/components/WordPanel/components/MobileWordPractice.tsx'),
    read('src/pages/Typing/components/WordPanel/components/Word/index.tsx'),
    read('src/review/learn-review-commit.ts'),
  ])
  assert.match(mobile, /const id = await saveWordRecord\(/)
  assert.match(mobile, /record\.id = id\s+scheduleLearnReviewCommit\(/)
  assert.match(desktop, /const wordRecordId = await saveWordRecord\(/)
  assert.match(desktop, /scheduleLearnReviewCommit\(/)
  assert.match(helper, /input\.itemKind !== 'review'/)
  assert.match(helper, /input\.decision\?\.eligible !== true/)
  assert.match(helper, /input\.wordRecordId <= 0/)
  assert.match(helper, /trackLearnPersistence\(\s*applyReviewOutcome\(/)
})

test('Mobile review Good is frozen before reveal and can be corrected before persistence', async () => {
  const code = await read('src/pages/Typing/components/WordPanel/components/MobileWordPractice.tsx')
  assert.match(code, /const frozen: PendingRecallAttempt = \{\s*grade,/)
  assert.match(code, /setRevealedAttempt\(frozen\)/)
  assert.match(code, /if \(grade !== 'good'\)/)
  assert.match(code, /if \(!revealedAttempt \|\| revealedAttempt\.grade !== 'good'/)
  assert.match(code, /setTimeout\(\(\) => \{\s*void saveAttemptRef\.current/)
  assert.match(code, /'self-rated-before-answer-reveal'/)
  assert.match(code, /'self-report-not-spelling'/)
  assert.doesNotMatch(code, /(?:onClick|onKeyDown)=\{revealAnswer\}/)
})


test('FSRS bootstrapping repairs stale cached state only for newer eligible durable review events', async () => {
  const source = await read('src/review/repository.ts')
  assert.match(source, /export function needsFsrsProjectionRecovery\(/)
  assert.match(source, /row\.reviewRatingDecision\?\.eligible === true/)
  assert.match(source, /eligible\.length > state\.reviewCount/)
  assert.match(source, /newest > \(state\.lastReviewedAt \?\? 0\)/)
  assert.match(source, /if \(needsFsrsProjectionRecovery\(existing, wordRecords\)\)/)
  assert.match(source, /rebuildActiveFsrsStateFromWordRecords\(/)
})
