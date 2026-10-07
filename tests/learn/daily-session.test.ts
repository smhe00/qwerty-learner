import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLearnDailySession,
  deriveLearnDailyProgress,
  recordLearnBlockCompletion,
} from '../../src/learn/daily-session'
import {
  LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
} from '../../src/learn/acquisition'
import { decideLearnAutoSyncAction } from '../../src/sync/auto'
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
    'clean',
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
