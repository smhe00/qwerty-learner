import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
  LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
  createLearnAcquisitionState,
} from '../../src/learn/acquisition'
import { decideDailyAcquisitionQuota } from '../../src/learn/quota'
import { planLearnAcquisitionCandidates } from '../../src/learn/session'
import { buildLearnStatsSnapshot } from '../../src/learn/stats'
import {
  rebuildBasicStateFromWordRecords,
  shouldDropPrematureAcquisitionState,
} from '../../src/review/rebuild'
import { createInitialReviewWordState } from '../../src/review/types'
import type { IWordRecord } from '../../src/utils/db/record'
import type { Word } from '../../src/typings'

function record(input: {
  word: string
  timeStamp: number
  policyVersion: string
  reasonCodes?: string[]
  wrongCount?: number
  retrievalValidity?: 'independent'
}): IWordRecord {
  return {
    word: input.word,
    timeStamp: input.timeStamp,
    dict: 'backup-regression',
    chapter: -1,
    timing: [],
    wrongCount: input.wrongCount ?? 0,
    mistakes: input.wrongCount ? { 0: ['x'] } : {},
    sourceMode: 'learn',
    learnItemKind: 'acquisition',
    reviewPolicyDecision: {
      version: 1,
      policyVersion: input.policyVersion,
      reasonCodes: input.reasonCodes ?? [],
      conditionVersion: 1,
    },
    ...(input.retrievalValidity
      ? {
          reviewEvidence: {
            version: 1,
            memoryGrade: 'good',
            errorCause: 'clean',
            confidence: 1,
            retrievalValidity: input.retrievalValidity,
            evidenceStrength: 1,
            reasonCodes: ['backup-regression'],
          },
        }
      : {}),
  }
}

function validAdmission(word: string, timeStamp: number): IWordRecord {
  return record({
    word,
    timeStamp,
    policyVersion: LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
    reasonCodes: ['spacing-eligible'],
    retrievalValidity: 'independent',
  })
}

function spacingInsufficient(
  word: string,
  timeStamp: number,
): IWordRecord {
  return record({
    word,
    timeStamp,
    policyVersion: LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
    reasonCodes: ['spacing-insufficient'],
    retrievalValidity: 'independent',
  })
}

function word(name: string): Word {
  return {
    name,
    trans: [],
    usphone: '',
    ukphone: '',
  }
}

test('backup regression: first introduction consumes quota even before admission', () => {
  const now = Math.floor(
    new Date(2026, 9, 4, 20, 10, 0).getTime() / 1000,
  )
  const admitted = Array.from({ length: 19 }, (_, index) =>
    validAdmission(`w${index}`, now - 2_000 + index),
  )
  const noonExposure = record({
    word: 'noon',
    timeStamp: now - 20,
    policyVersion: LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
  })
  const noonTooSoon = spacingInsufficient('noon', now - 10)

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'backup-regression',
    wordRecords: [...admitted, noonExposure, noonTooSoon],
    wordStates: [],
    dictionaryWords: [
      ...Array.from({ length: 19 }, (_, index) => `w${index}`),
      'noon',
      'connect',
    ],
  })
  const quota = decideDailyAcquisitionQuota(stats)

  assert.equal(stats.today.introducedWords, 20)
  assert.equal(stats.today.acquiredWords, 19)
  assert.equal(stats.lifecycle.unseen, 1)
  assert.equal(quota.targetDailyNewWords, 20)
  assert.equal(quota.remainingDailyNewWords, 0)
  assert.equal(quota.allowedNow, 0)
  assert.equal(quota.signals.todayIntroducedWords, 20)
})

test('backup regression: pending spacing word resumes with zero fresh quota and does not inject connect', () => {
  const now = 1_000
  const deferred = {
    ...createLearnAcquisitionState(),
    phase: 'deferred' as const,
    deferredReason: 'spacing' as const,
    resumeAfter: now + 300,
  }
  const words = ['noon', 'connect', 'comment'].map(word)
  const pending = new Map([['noon', deferred]])
  const introduced = ['noon']

  const waiting = planLearnAcquisitionCandidates({
    words,
    states: [],
    pendingStates: pending,
    introducedWords: introduced,
    freshLimit: 0,
    now,
  })
  assert.deepEqual(waiting.resumed, [])
  assert.deepEqual(waiting.freshWords, [])
  assert.deepEqual(waiting.blockedPendingWords, ['noon'])

  const ready = planLearnAcquisitionCandidates({
    words,
    states: [],
    pendingStates: pending,
    introducedWords: introduced,
    freshLimit: 0,
    now: now + 301,
  })
  assert.deepEqual(
    ready.resumed.map((item) => item.word.name),
    ['noon'],
  )
  assert.equal(ready.resumed[0]?.state.phase, 'independent')
  assert.equal(ready.resumed[0]?.state.independentInterveningItems, 2)
  assert.deepEqual(ready.freshWords, [])
})

test('backup regression: pending and previously introduced words can never be selected as fresh', () => {
  const words = ['outside', 'noon', 'connect', 'comment'].map(word)
  const pending = new Map([
    [
      'outside',
      {
        ...createLearnAcquisitionState(),
        phase: 'deferred' as const,
        deferredReason: 'spacing' as const,
        resumeAfter: 500,
      },
    ],
  ])

  const plan = planLearnAcquisitionCandidates({
    words,
    states: [],
    pendingStates: pending,
    introducedWords: ['outside', 'noon'],
    freshLimit: 2,
    now: 100,
  })

  assert.deepEqual(plan.resumed, [])
  assert.deepEqual(
    plan.freshWords.map((item) => item.name),
    ['connect', 'comment'],
  )
})

test('backup regression: spacing-insufficient phased acquisition cannot rebuild ACTIVE even with contaminated Review rows', () => {
  const records: IWordRecord[] = [
    record({
      word: 'noon',
      timeStamp: 100,
      policyVersion: LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
    }),
    spacingInsufficient('noon', 120),
    {
      word: 'noon',
      timeStamp: 130,
      dict: 'backup-regression',
      chapter: -1,
      timing: [],
      wrongCount: 1,
      mistakes: { 0: ['x'] },
      sourceMode: 'learn',
      learnItemKind: 'review',
    },
  ]

  const corrupted = createInitialReviewWordState(
    'backup-regression',
    'noon',
    100,
  )

  assert.equal(
    shouldDropPrematureAcquisitionState(corrupted, records),
    true,
  )
  assert.equal(
    rebuildBasicStateFromWordRecords(
      'backup-regression',
      'noon',
      records,
      { legacyDueAt: 140 },
    ),
    undefined,
  )
})

test('backup regression: contaminated Review before later valid admission is not replayed', () => {
  const records: IWordRecord[] = [
    record({
      word: 'noon',
      timeStamp: 100,
      policyVersion: LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
    }),
    spacingInsufficient('noon', 120),
    {
      word: 'noon',
      timeStamp: 130,
      dict: 'backup-regression',
      chapter: -1,
      timing: [],
      wrongCount: 2,
      mistakes: { 0: ['x'] },
      sourceMode: 'learn',
      learnItemKind: 'review',
    },
    validAdmission('noon', 500),
  ]

  const rebuilt = rebuildBasicStateFromWordRecords(
    'backup-regression',
    'noon',
    records,
  )

  assert.ok(rebuilt)
  assert.equal(rebuilt.reviewCount, 0)
  assert.equal(rebuilt.lapseCount, 0)
  assert.equal(rebuilt.lastOutcome, undefined)
  assert.equal(rebuilt.createdAt, 500)
  assert.equal(rebuilt.nextReviewAt, 500 + 86_400)
})
