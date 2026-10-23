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
  assert.match(mobile, /const id = await trackLearnPersistence\(\s*saveWordRecord\(/)
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
  const source = await read('src/review/projection-recovery.ts')
  const caller = await read('src/review/repository.ts')
  assert.match(source, /export function needsFsrsProjectionRecovery\(/)
  assert.match(source, /row\.reviewRatingDecision\?\.eligible === true/)
  assert.match(source, /eligible\.length > state\.reviewCount/)
  assert.match(source, /newest > \(state\.lastReviewedAt \?\? 0\)/)
  assert.match(caller, /if \(needsFsrsProjectionRecovery\(existing, wordRecords\)\)/)
  assert.match(caller, /rebuildActiveFsrsStateFromWordRecords\(/)
})


test('Independent phone acquisition resolves the real phase policy rather than using Review fallback', async () => {
  const code = await read('src/pages/Typing/components/WordPanel/components/MobileWordPractice.tsx')
  assert.match(code, /createLearnAcquisitionExercisePlanForState\(acquisitionState\)/)
  assert.match(code, /itemKind === 'acquisition'/)
  assert.match(code, /data-mobile-policy=\{activePlan\?\.decision\.policyVersion/)
})


test('Desktop Tap Recall reuses mobile component and WordPanel onFinish instead of duplicating the scheduler', async () => {
  const panel = await read('src/pages/Typing/components/WordPanel/index.tsx')
  assert.match(panel, /mobile \|\| \(isReviewMode && desktopTapRecall\)/)
  assert.match(panel, /data-desktop-tap-study/)
  assert.match(panel, /<MobileWordPractice/)
  assert.match(panel, /onFinish=\{onFinish\}/)
})

test('Mobile cold spelling is a separately tagged objective result, not a self-report', async () => {
  const mobile = await read('src/pages/Typing/components/WordPanel/components/MobileWordPractice.tsx')
  assert.match(mobile, /objective-spelling-clean/)
  assert.match(mobile, /objective-spelling-mismatch/)
  assert.match(mobile, /const submitSpelling = \(\) =>/)
  assert.match(mobile, /<form\s+className="mobile-practice-spelling-form"/)
  assert.match(mobile, /task === 'spelling' \|\| mode === 'recall'|mode === 'recall' \|\| mode === 'spelling'/)
})
