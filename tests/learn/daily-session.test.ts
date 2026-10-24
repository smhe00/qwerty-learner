import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addLearnDailyNewWords,
  deriveLearnExecutionProgress,
  getLearnExtraRoundNames,
  isLearnSessionOutsideExtraRound,
  createLearnDailySession,
  deriveLearnDailyProgress,
  recordLearnBlockCompletion,
  learnLocalDateKey,
} from '../../src/learn/daily-session'
import {
  LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
} from '../../src/learn/acquisition'
import { assessSyncState, decideLearnAutoSyncAction } from '../../src/sync/state'
import type { IReviewWordState } from '../../src/review/types'
import type { IWordRecord } from '../../src/utils/db/record'

const START = 1_800_000_000

function reviewState(
  word: string,
  nextReviewAt: number,
): IReviewWordState {
  return {
    dict: 'daily-test',
    word,
    createdAt: START - 1000,
    updatedAt: START - 1000,
    nextReviewAt,
    reviewCount: 3,
    lapseCount: 0,
    cleanStreak: 2,
    lifecycle: 'active',
    stateVersion: 5,
    schedulerState: {
      kind: 'basic-v2',
      stage: 2,
      intervalDays: 2,
    },
  }
}

function wordRecord(
  word: string,
  timeStamp: number,
  overrides: Partial<IWordRecord> = {},
): IWordRecord {
  return {
    word,
    timeStamp,
    dict: 'daily-test',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    ...overrides,
  }
}

function independentCleanReview(
  word: string,
  timeStamp: number,
): IWordRecord {
  return wordRecord(word, timeStamp, {
    reviewEvidence: {
      version: 1,
      memoryGrade: 'good',
      errorCause: 'clean',
      confidence: 1,
      evidenceStrength: 1,
      retrievalValidity: 'independent',
      reasonCodes: ['independent-clean'],
    },
    reviewRatingDecision: {
      eligible: true,
      rating: 'good',
      confidence: 1,
      reasonCodes: ['independent-clean'],
    },
  })
}

function acquisitionExposure(
  word: string,
  timeStamp: number,
): IWordRecord {
  return wordRecord(word, timeStamp, {
    learnItemKind: 'acquisition',
    reviewPolicyDecision: {
      version: 1,
      policyVersion: 'learn-acquisition-exposure-v1',
      reasonCodes: ['visible-copy'],
      conditionVersion: 1,
    },
  })
}

function completedAcquisition(
  word: string,
  timeStamp: number,
): IWordRecord {
  return wordRecord(word, timeStamp, {
    learnItemKind: 'acquisition',
    reviewEvidence: {
      version: 1,
      memoryGrade: 'good',
      errorCause: 'clean',
      confidence: 1,
      evidenceStrength: 1,
      retrievalValidity: 'independent',
      reasonCodes: ['independent-clean'],
    },
    reviewPolicyDecision: {
      version: 1,
      policyVersion: LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
      reasonCodes: [
        'learn-acquisition-independent',
        'spacing-eligible',
      ],
      conditionVersion: 1,
    },
  })
}

test('daily plan freezes due review, carry-over acquisition and configured new target', () => {
  const session = createLearnDailySession({
    dict: 'daily-test',
    now: START,
    dailyNewTarget: 32,
    dictionaryWords: [
      'due',
      'future',
      'carry',
      ...Array.from({ length: 60 }, (_, index) => `new-${index}`),
    ],
    wordRecords: [
      acquisitionExposure('carry', START - 86_400),
    ],
    wordStates: [
      reviewState('due', START - 1),
      reviewState('future', START + 86_400),
    ],
  })

  assert.deepEqual(session.plannedReviewWords, ['due'])
  assert.deepEqual(session.carryOverAcquisitionWords, ['carry'])
  assert.equal(session.plannedNewWords, 32)
  assert.equal(session.dailyNewTarget, 32)
})

test('unfinished new-word quota does not become next-day debt', () => {
  const dictionaryWords = Array.from(
    { length: 100 },
    (_, index) => `word-${index}`,
  )
  const day1 = createLearnDailySession({
    dict: 'daily-test',
    now: START,
    dailyNewTarget: 32,
    dictionaryWords,
    wordRecords: [],
    wordStates: [],
  })
  assert.equal(day1.plannedNewWords, 32)

  const introducedTwenty = Array.from(
    { length: 20 },
    (_, index) =>
      acquisitionExposure(
        `word-${index}`,
        START + index + 1,
      ),
  )
  const day2 = createLearnDailySession({
    dict: 'daily-test',
    now: START + 86_400,
    dailyNewTarget: 32,
    dictionaryWords,
    wordRecords: introducedTwenty,
    wordStates: [],
  })

  assert.equal(day2.plannedNewWords, 32)
  assert.equal(day2.carryOverAcquisitionWords.length, 20)
})

test('daily progress advances only on final independent completion', () => {
  const session = {
    ...createLearnDailySession({
      dict: 'daily-test',
      now: START,
      dailyNewTarget: 1,
      dictionaryWords: ['review-me', 'new-me'],
      wordRecords: [],
      wordStates: [reviewState('review-me', START - 1)],
    }),
    plannedReviewWords: ['review-me'],
    plannedNewWords: 1,
  }

  const assistedReview = wordRecord('review-me', START + 10, {
    reviewEvidence: {
      version: 1,
      memoryGrade: 'good',
      errorCause: 'clean',
      confidence: 1,
      evidenceStrength: 1,
      retrievalValidity: 'assisted',
      reasonCodes: ['hint-used'],
    },
  })
  const earlyIndependentAcquisition = wordRecord(
    'new-me',
    START + 30,
    {
      learnItemKind: 'acquisition',
      reviewEvidence: {
        version: 1,
        memoryGrade: 'good',
        errorCause: 'clean',
        confidence: 1,
        evidenceStrength: 1,
        retrievalValidity: 'independent',
        reasonCodes: ['independent-clean'],
      },
      reviewPolicyDecision: {
        version: 1,
        policyVersion:
          LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
        reasonCodes: [
          'learn-acquisition-independent',
          'spacing-insufficient',
        ],
        conditionVersion: 1,
      },
    },
  )

  const partial = deriveLearnDailyProgress({
    session,
    wordRecords: [
      assistedReview,
      acquisitionExposure('new-me', START + 20),
      earlyIndependentAcquisition,
    ],
  })

  assert.equal(partial.targetWords, 2)
  assert.equal(partial.completedWords, 0)
  assert.equal(partial.introducedNewWords, 1)
  assert.equal(partial.complete, false)

  const complete = deriveLearnDailyProgress({
    session,
    wordRecords: [
      assistedReview,
      independentCleanReview('review-me', START + 40),
      acquisitionExposure('new-me', START + 20),
      earlyIndependentAcquisition,
      completedAcquisition('new-me', START + 50),
    ],
  })

  assert.equal(complete.completedReviewWords, 1)
  assert.equal(complete.completedNewWords, 1)
  assert.equal(complete.completedWords, 2)
  assert.equal(complete.percent, 100)
  assert.equal(complete.complete, true)
})

test('block completion checkpoint is idempotent', () => {
  const session = createLearnDailySession({
    dict: 'daily-test',
    now: START,
    dailyNewTarget: 32,
    dictionaryWords: ['one'],
    wordRecords: [],
    wordStates: [],
  })

  const first = recordLearnBlockCompletion({
    session,
    blockId: 'block-1',
    activeSeconds: 123,
  })
  const replay = recordLearnBlockCompletion({
    session: first,
    blockId: 'block-1',
    activeSeconds: 123,
  })

  assert.equal(first.blockCount, 1)
  assert.equal(first.accumulatedActiveSeconds, 123)
  assert.equal(replay.blockCount, 1)
  assert.equal(replay.accumulatedActiveSeconds, 123)
})

test('safe auto-sync never overwrites remote-ahead or diverged state', () => {
  assert.equal(
    decideLearnAutoSyncAction({
      status: 'local-dirty',
      localDirty: true,
      remoteChanged: false,
      diverged: false,
      baseRevision: 7,
    }),
    'upload',
  )
  assert.equal(
    decideLearnAutoSyncAction({
      status: 'remote-ahead',
      localDirty: false,
      remoteChanged: true,
      diverged: false,
      baseRevision: 7,
    }),
    'remote-ahead',
  )
  assert.equal(
    decideLearnAutoSyncAction({
      status: 'diverged',
      localDirty: true,
      remoteChanged: true,
      diverged: true,
      baseRevision: 7,
    }),
    'diverged',
  )
})

/**
 * Midday local timestamps avoid DST ambiguity. Explicit civil-date
 * assertions catch an implementation that always uses day=01 even when
 * both consecutive dates still produce distinct-looking session IDs.
 */
test('daily session date keys match civil calendar across ordinary days and year boundary', () => {
  const scenarios: Array<[number, number, number, string]> = [
    [2026, 10, 10, '2026-10-10'],
    [2026, 10, 11, '2026-10-11'],
    [2026, 10, 31, '2026-10-31'],
    [2026, 11, 1, '2026-11-01'],
    [2026, 12, 31, '2026-12-31'],
    [2027, 1, 1, '2027-01-01'],
  ]
  for (const [year, month, day, expected] of scenarios) {
    const now = Math.floor(new Date(year, month - 1, day, 12, 0, 0).getTime() / 1000)
    assert.equal(learnLocalDateKey(now), expected,
      'date key must reflect local civil day ' + expected)
    const daily = createLearnDailySession({
      dict: 'daily-test',
      now,
      dailyNewTarget: 2,
      dictionaryWords: ['word-a', 'word-b', 'word-c'],
      wordRecords: [],
      wordStates: [],
    })
    assert.equal(daily.dateKey, expected)
    assert.ok(daily.sessionId.includes(':' + expected + ':'),
      'daily session identity must carry true civil date')
  }
})

test('simultaneous local evidence and remote revision change is a sync divergence, never an upload', () => {
  const baseline = {
    baseRevision: 7,
    localFingerprint: 'base-snapshot',
    userActionFingerprint: 'base-actions',
    syncedAt: '2026-10-09T12:00:00.000Z',
  }
  const local = {
    fingerprint: 'locally-edited',
    userActionFingerprint: 'learn-progress-advanced',
    sizeBytes: 4096,
    recordCount: 10,
    hasMeaningfulState: true,
  }
  const remote = {
    hasData: true,
    revision: 8,
    updatedAt: '2026-10-10T12:00:00.000Z',
    sizeBytes: 4200,
    dataSha256: 'server-hash',
    deviceId: 'second-device',
    clientFormatVersion: '4',
  }
  const decision = assessSyncState(local, remote, baseline)
  assert.equal(decision.localDirty, true)
  assert.equal(decision.remoteChanged, true)
  assert.equal(decision.diverged, true)
  assert.equal(decision.status, 'diverged')
  assert.equal(decideLearnAutoSyncAction(decision), 'diverged',
    'auto-sync must never overwrite newer cloud data when local actions also changed')

  const clean = assessSyncState({
    ...local, fingerprint: baseline.localFingerprint,
    userActionFingerprint: baseline.userActionFingerprint,
  }, remote, baseline)
  assert.equal(clean.localDirty, false)
  assert.equal(clean.status, 'remote-ahead')
  assert.equal(decideLearnAutoSyncAction(clean), 'remote-ahead')
})


test('optional new words do not enlarge the completion target or satisfy planned identities', () => {
  const session = createLearnDailySession({ dict: 'daily-test', now: START, dailyNewTarget: 1, dictionaryWords: ['planned', 'optional'], wordRecords: [], wordStates: [] })
  const records = [acquisitionExposure('optional', START + 1), completedAcquisition('optional', START + 2)]
  const pending = deriveLearnDailyProgress({ session, wordRecords: records })
  assert.equal(pending.targetWords, 1)
  assert.equal(pending.completedWords, 0)
  records.push(acquisitionExposure('planned', START + 3), completedAcquisition('planned', START + 4))
  assert.equal(deriveLearnDailyProgress({ session, wordRecords: records }).complete, true)
})

test('five-more extends only the completed daily cohort, preserving the recurring target and progress', () => {
  const words = ['planned', 'optional', ...Array.from({ length: 12 }, (_, i) => `extra-${i}`)]
  const original = createLearnDailySession({ dict: 'daily-test', now: START, dailyNewTarget: 1, dictionaryWords: words, wordRecords: [], wordStates: [] })
  const session = { ...original, status: 'completed' as const, completedAt: START + 4, blockCount: 2, completedBlockIds: ['a', 'b'] }
  const records = [acquisitionExposure('planned', START + 1), completedAcquisition('planned', START + 2), acquisitionExposure('optional', START + 3)]
  const extra = addLearnDailyNewWords({ session, now: START + 10, dictionaryWords: words, wordRecords: records, wordStates: [] })
  assert.equal(extra.plannedNewWords, 5)
  assert.equal(extra.dailyNewTarget, 1)
  assert.equal(extra.status, 'active')
  assert.equal(extra.sessionId, original.sessionId)
  assert.deepEqual(extra.plannedNewWordNames, ['planned', ...words.slice(2, 6)])
  assert.deepEqual(extra.carryOverAcquisitionWords, ['optional'])
  assert.deepEqual(getLearnExtraRoundNames(extra), ['optional', ...words.slice(2, 6)])
  assert.deepEqual(extra.completedBlockIds, ['a', 'b'])
  assert.equal(deriveLearnDailyProgress({ session: extra, wordRecords: records }).remainingWords, 5)
  assert.equal(addLearnDailyNewWords({ session: extra, now: START + 10, dictionaryWords: words, wordRecords: records, wordStates: [] }), extra)
})

test('five-more handles exhausted dictionaries and never reopens a previous day', () => {
  const session = { ...createLearnDailySession({ dict: 'daily-test', now: START, dailyNewTarget: 1, dictionaryWords: ['a', 'b', 'c'], wordRecords: [], wordStates: [] }), status: 'completed' as const }
  const input = { session, now: START + 1, dictionaryWords: ['a', 'b', 'c'], wordRecords: [acquisitionExposure('a', START), completedAcquisition('a', START)], wordStates: [] }
  assert.equal(addLearnDailyNewWords(input).plannedNewWords, 3)
  assert.equal(addLearnDailyNewWords({ ...input, dictionaryWords: ['a'] }), session)
  assert.equal(addLearnDailyNewWords({ ...input, now: START + 86400 }), session)
})


test('exhausted executable work can extend today without declaring unresolved words mastered', () => {
  const words = ['pending', 'b', 'c', 'd', 'e', 'f']
  const original = createLearnDailySession({ dict: 'daily-test', now: START, dailyNewTarget: 1, dictionaryWords: words, wordRecords: [], wordStates: [] })
  const records = [acquisitionExposure('pending', START + 1)]
  assert.equal(addLearnDailyNewWords({ session: original, now: START + 2, dictionaryWords: words, wordRecords: records, wordStates: [] }), original)
  const extra = addLearnDailyNewWords({ session: { ...original, executionExhausted: true }, now: START + 2, dictionaryWords: words, wordRecords: records, wordStates: [] })
  assert.equal(extra.status, 'active')
  assert.equal(extra.executionExhausted, undefined)
  assert.deepEqual(extra.plannedNewWordNames, words.slice(0, 5))
  assert.deepEqual(getLearnExtraRoundNames(extra), words.slice(0, 5))
  assert.equal(extra.plannedNewWords, 5)
  assert.equal(extra.dailyNewTarget, 1)
  const progress = deriveLearnDailyProgress({ session: extra, wordRecords: records })
  assert.equal(progress.completedWords, 0)
  assert.equal(progress.remainingWords, 5)
})


test('five-more prioritizes five unfinished words and finishes independently of the remaining original plan', () => {
  const words = Array.from({ length: 45 }, (_, i) => `word-${i}`)
  const original = { ...createLearnDailySession({ dict: 'daily-test', now: START, dailyNewTarget: 32, dictionaryWords: words, wordRecords: [], wordStates: [] }), executionExhausted: true }
  const records = words.slice(0, 32).map(word => acquisitionExposure(word, START + 1))
  const extra = addLearnDailyNewWords({ session: original, now: START + 2, dictionaryWords: words, wordRecords: records, wordStates: [] })
  assert.equal(extra.plannedNewWords, 32)
  assert.deepEqual(getLearnExtraRoundNames(extra), words.slice(0, 5))
  for (const name of words.slice(0, 5)) records.push(acquisitionExposure(name, START + 3), completedAcquisition(name, START + 4))
  assert.equal(deriveLearnExecutionProgress({ session: extra, wordRecords: records }).complete, true)
  const daily = deriveLearnDailyProgress({ session: extra, wordRecords: records })
  assert.equal(daily.newTargetWords, 32)
  assert.equal(daily.introducedNewWords, 32)
  assert.equal(daily.complete, false)
  const legacy = { ...extra, extraNewWordCount: 5, plannedNewWordNames: words.slice(0, 37), extraRoundWordNames: undefined }
  assert.deepEqual(getLearnExtraRoundNames(legacy), words.slice(32, 37))
  assert.equal(isLearnSessionOutsideExtraRound({ words: [{ name: words[0] }, { name: words[32] }] }, legacy), true)
  assert.equal(isLearnSessionOutsideExtraRound({ words: words.slice(32, 37).map(name => ({ name })) }, legacy), false)
})


test('five-more resumes unfinished reviews and carry-over before adding fresh words', () => {
  const original = { ...createLearnDailySession({ dict: 'daily-test', now: START, dailyNewTarget: 1, dictionaryWords: ['new', 'fresh1', 'fresh2', 'fresh3'], wordRecords: [], wordStates: [] }), plannedReviewWords: ['review'], carryOverAcquisitionWords: ['carry'], executionExhausted: true }
  const extra = addLearnDailyNewWords({ session: original, now: START + 2, dictionaryWords: ['review', 'carry', 'new', 'fresh1', 'fresh2', 'fresh3'], wordRecords: [], wordStates: [] })
  assert.deepEqual(getLearnExtraRoundNames(extra), ['review', 'carry', 'new', 'fresh1', 'fresh2'])
  assert.equal(extra.plannedNewWords, 3)
  const progress = deriveLearnExecutionProgress({ session: extra, wordRecords: [] })
  assert.equal(progress.targetWords, 5)
  assert.equal(progress.reviewTargetWords, 1)
  assert.equal(progress.carryOverTargetWords, 1)
  assert.equal(progress.newTargetWords, 3)
})


test('formal failed review completes today task without claiming independent mastery or changing records', () => {
  const session = { ...createLearnDailySession({ dict: 'daily-test', now: START, dailyNewTarget: 0,
    dictionaryWords: ['forgot', 'clean', 'pending', 'practice'], wordRecords: [], wordStates: [] }),
    plannedReviewWords: ['forgot', 'clean', 'pending', 'practice'], plannedNewWords: 0 }
  const failed = independentCleanReview('forgot', START + 10)
  failed.reviewEvidence = { ...failed.reviewEvidence!, memoryGrade: 'again', errorCause: 'recall' }
  failed.reviewRatingDecision = { eligible: true, rating: 'again', confidence: 1, reasonCodes: ['cold-probe-surrendered'] }
  const reinforcement = independentCleanReview('forgot', START + 20)
  reinforcement.reviewRatingDecision = { eligible: false, rating: null, reason: 'non-cold-attempt', reasonCodes: ['non-cold-attempt'] }
  const practice = { ...independentCleanReview('practice', START + 10), learnItemKind: 'practice' as const }
  const records = [failed, reinforcement, independentCleanReview('clean', START + 10), practice, independentCleanReview('pending', START - 1)]
  const before = JSON.stringify(records)
  const result = deriveLearnDailyProgress({ session, wordRecords: records })
  assert.equal(result.completedReviewWords, 2)
  assert.equal(result.independentReviewWords, 1)
  assert.equal(result.reviewWordsToConsolidate, 1)
  assert.equal(result.remainingWords, 2)
  assert.deepEqual(result.independentCompletedWords, ['clean'])
  assert.equal(JSON.stringify(records), before)
  const extra = deriveLearnExecutionProgress({ session: { ...session, extraRoundWordNames: ['forgot'], extraRoundStartedAt: START + 30 }, wordRecords: records })
  assert.equal(extra.completedReviewWords, 0)
  assert.equal(extra.complete, false)
})
