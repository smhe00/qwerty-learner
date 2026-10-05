import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
  LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
  MIN_ASSISTANCE_DEFERRED_DELAY_SECONDS,
  createLearnAcquisitionState,
  normalizeDeferredAcquisitionState,
} from '../../src/learn/acquisition'
import { resolveLearnAcquisitionCompletion } from '../../src/learn/progression'
import { buildLearnDailyPlan } from '../../src/learn/plan'
import { decideDailyAcquisitionQuota } from '../../src/learn/quota'
import {
  decideLearnStartKind,
  planLearnAcquisitionCandidates,
  shouldRotateOversizedLearnSession,
} from '../../src/learn/session'
import { buildLearnStatsSnapshot } from '../../src/learn/stats'
import {
  rebuildBasicStateFromWordRecords,
  shouldDropPrematureAcquisitionState,
} from '../../src/review/rebuild'
import { sanitizeLearnSessionLifecycle } from '../../src/learn/lifecycle'
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

test('due review keeps priority without starving new-word admission', () => {
  const now = 10_000
  const dueState = createInitialReviewWordState(
    'backup-regression',
    'due-word',
    now - 1_000,
  )
  dueState.nextReviewAt = now - 1

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'backup-regression',
    wordRecords: [],
    wordStates: [dueState],
    dictionaryWords: ['due-word', 'new-word'],
  })
  const quota = decideDailyAcquisitionQuota(stats)
  const plan = buildLearnDailyPlan({ stats, quota })

  assert.equal(stats.lifecycle.due, 1)
  assert.equal(stats.lifecycle.unseen, 1)
  assert.equal(quota.pausedByDue, false)
  assert.ok(quota.allowedNow > 0)
  assert.equal(plan.action, 'mixed')
  assert.ok(plan.allowedNewWordsNow > 0)
  assert.equal(
    decideLearnStartKind({ dueCount: 1, unseenCount: 1 }),
    'mixed',
  )
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


test('backup regression: premature Review ratings do not affect Learn statistics before admission', () => {
  const now = 1_000
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
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'review',
      reviewRatingDecision: {
        eligible: true,
        rating: 'good',
        confidence: 1,
        reasonCodes: ['premature-review-contamination'],
      },
    },
  ]

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'backup-regression',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: ['noon', 'connect'],
  })

  assert.equal(stats.today.reviewAttempts, 0)
  assert.equal(stats.today.coldProbeAttempts, 0)
  assert.equal(stats.scheduler.ratedEvents30d, 0)
  assert.equal(stats.today.introducedWords, 1)
  assert.equal(stats.today.acquiredWords, 0)
})


test('backup regression: unfinished acquisition checkpoint prunes admitted and excluded words', () => {
  const pendingState = createLearnAcquisitionState()
  const checkpoint = {
    dict: 'backup-regression',
    index: 0,
    createTime: 100,
    isFinished: false,
    sessionKind: 'acquisition' as const,
    words: [word('done'), word('pending'), word('removed')],
    acquisitionStates: {
      done: createLearnAcquisitionState(),
      pending: pendingState,
      removed: createLearnAcquisitionState(),
    },
  }

  const active = createInitialReviewWordState(
    'backup-regression',
    'done',
    100,
  )
  const excluded = {
    ...createInitialReviewWordState(
      'backup-regression',
      'removed',
      100,
    ),
    lifecycle: 'excluded' as const,
    exclusion: {
      reason: 'manual' as const,
      excludedAt: 120,
    },
  }

  const sanitized = sanitizeLearnSessionLifecycle(
    checkpoint,
    [active, excluded],
  )

  assert.deepEqual(
    sanitized.words.map((item) => item.name),
    ['pending'],
  )
  assert.equal(sanitized.isFinished, false)
  assert.deepEqual(
    Object.keys(sanitized.acquisitionStates ?? {}),
    ['pending'],
  )
})


test('simulation-discovered regression: assistance-deferred acquisition resumes Supported after bounded cross-session delay', () => {
  const now = 10_000
  const target = word('difficult')
  const state = {
    ...createLearnAcquisitionState({
      scaffoldStrainTier: 'recovery',
    }),
    phase: 'independent' as const,
    assistedCycles: 1,
    independentInterveningItems: 4,
  }

  const resolution = resolveLearnAcquisitionCompletion({
    queue: [target],
    currentIndex: 0,
    currentWord: target,
    state,
    acquisitionStates: {
      difficult: state,
    },
    wrongCount: 2,
    classificationCause: 'recall',
    retrievalValidity: 'independent',
    lastWrongIndex: 2,
    now,
  })

  assert.equal(resolution.nextState.phase, 'deferred')
  assert.equal(
    resolution.nextState.deferredReason,
    'assistance',
  )
  assert.equal(
    resolution.nextState.resumeAfter,
    now + MIN_ASSISTANCE_DEFERRED_DELAY_SECONDS,
  )
  assert.equal(
    resolution.nextState.scaffoldHintPosition,
    2,
  )

  const pending = new Map([
    ['difficult', resolution.nextState],
  ])

  const waiting = planLearnAcquisitionCandidates({
    words: [target],
    states: [],
    pendingStates: pending,
    introducedWords: ['difficult'],
    freshLimit: 0,
    now:
      now +
      MIN_ASSISTANCE_DEFERRED_DELAY_SECONDS -
      1,
  })
  assert.deepEqual(waiting.resumed, [])

  const ready = planLearnAcquisitionCandidates({
    words: [target],
    states: [],
    pendingStates: pending,
    introducedWords: ['difficult'],
    freshLimit: 0,
    now:
      now +
      MIN_ASSISTANCE_DEFERRED_DELAY_SECONDS +
      1,
  })
  assert.equal(ready.resumed.length, 1)
  assert.equal(ready.resumed[0]?.state.phase, 'supported')
  assert.equal(
    ready.resumed[0]?.state.scaffoldHintPosition,
    2,
  )
  assert.deepEqual(ready.freshWords, [])
})

test('simulation-discovered regression: legacy assistance-deferred state without resumeAfter is repaired', () => {
  const deferredAt = 20_000
  const legacy = {
    ...createLearnAcquisitionState(),
    phase: 'deferred' as const,
    assistedCycles: 2,
    deferredReason: 'assistance' as const,
    scaffoldHintPosition: 3,
  }

  const repaired = normalizeDeferredAcquisitionState(
    legacy,
    deferredAt,
  )

  assert.equal(repaired.phase, 'deferred')
  assert.equal(repaired.deferredReason, 'assistance')
  assert.equal(
    repaired.resumeAfter,
    deferredAt + MIN_ASSISTANCE_DEFERRED_DELAY_SECONDS,
  )
  assert.equal(repaired.scaffoldHintPosition, 3)
})


test('oversized legacy acquisition sessions rotate while repeated attempts inside a 20-word cohort do not', () => {
  const makeWord = (index: number) => ({
    name: `legacy-${index}`,
    trans: [],
    usphone: '',
    ukphone: '',
  })

  assert.equal(
    shouldRotateOversizedLearnSession({
      isFinished: false,
      sessionKind: 'acquisition',
      words: Array.from({ length: 21 }, (_, index) =>
        makeWord(index),
      ),
    }),
    true,
  )

  const cohort = Array.from({ length: 20 }, (_, index) =>
    makeWord(index),
  )
  assert.equal(
    shouldRotateOversizedLearnSession({
      isFinished: false,
      sessionKind: 'acquisition',
      words: [...cohort, ...cohort, ...cohort],
    }),
    false,
  )
})

test('active interrupted acquisition state resumes instead of becoming permanently blocked pending work', () => {
  const word = {
    name: 'resume-exposure',
    trans: [],
    usphone: '',
    ukphone: '',
  }
  const state = createLearnAcquisitionState()
  const plan = planLearnAcquisitionCandidates({
    words: [word],
    states: [],
    pendingStates: new Map([[word.name, state]]),
    introducedWords: [word.name],
    freshLimit: 0,
    now: 100,
  })

  assert.equal(plan.resumed.length, 1)
  assert.equal(plan.resumed[0]?.word.name, word.name)
  assert.equal(plan.resumed[0]?.state.phase, 'exposure')
  assert.equal(plan.freshWords.length, 0)
})
