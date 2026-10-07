import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLearnAcquisitionExercisePlan,
  createLearnAcquisitionState,
  decideLearnAcquisitionTransition,
  deferLearnAcquisitionForSpacing,
  hasSufficientIndependentSpacing,
  resumeSpacingDeferredAcquisition,
  projectLearnAcquisitionProgress,
} from '../../src/learn/acquisition'
import {
  decideLearnScaffold,
  getLearnScaffoldPresentation,
} from '../../src/learn/scaffold'
import {
  applyLearnRecoveryWindow,
  planLearnRecoveryWindow,
} from '../../src/learn/recovery-window'
import {
  decideLearningLifecycleTransition,
  getLearningLifecycle,
  pruneLearnSessionWord,
} from '../../src/learn/lifecycle'
import {
  LEARN_NEW_WORD_BATCH_SIZE,
  canonicalizeLearningWords,
  countUnseenLearningWords,
  createLearnAcquisitionPlan,
  selectUnseenLearningWords,
} from '../../src/learn/session'
import {
  createBaselineExerciseCondition,
  isLetterVisibleForExerciseCondition,
} from '../../src/review/condition'
import {
  CANONICAL_REVIEW_PROBE_POLICY_VERSION,
  createBaselineReviewPolicyDecision,
  createCanonicalReviewProbePlan,
  createReviewPolicyShadow,
  materializeReviewExercisePlan,
} from '../../src/review/decision'
import { classifyTypingError } from '../../src/review/classifier'
import { selectReviewCandidates } from '../../src/review/due'
import { evaluateReviewEvidence } from '../../src/review/evidence'
import {
  chooseAudioWithdrawalShadow,
  chooseNextExerciseShadow,
  chooseTargetedMaskPlan,
  chooseTargetedMaskShadow,
  resolveExercisePlanForAttempt,
} from '../../src/review/exercise-policy'
import { buildReviewObservation } from '../../src/review/observation'
import {
  applyReviewHintDecision,
  createReviewHintMachineState,
  createReviewHintPlan,
  decideReviewHintInput,
  observeReviewHintWrong,
  reviewHintTerminationVariant,
} from '../../src/review/hint'
import {
  decideReviewProgress,
  decideWordInput,
  shouldPlayAutomaticPronunciation,
} from '../../src/review/machine'
import {
  hasUnreviewedLearningFailure,
  inferReviewOutcomeFromWordRecord,
  reactivateReviewStateFromLearningEvidence,
  rebuildBasicStateFromWordRecords,
  shouldDropLegacyTypingSeededState,
} from '../../src/review/rebuild'
import { buildOrthographyProfile } from '../../src/review/profile'
import {
  MAX_REINFORCEMENT_GAP,
  buildReviewSessionExercisePlans,
  getReviewAttemptRole,
  getWordComponentInstanceKey,
} from '../../src/review/session'
import {
  reviewOutcomeForAttempt,
  scheduleBasicReview,
  upgradeBasicSchedulerState,
} from '../../src/review/scheduler'
import {
  createReviewItemMachineState,
  resolveCompletedReviewItem,
} from '../../src/review/state-machine'
import {
  CURRENT_REVIEW_STATE_VERSION,
  createInitialReviewWordState,
} from '../../src/review/types'
import { buildLearnStatsSnapshot } from '../../src/learn/stats'
import type { IWordRecord } from '../../src/utils/db/record'
import {
  getFirstValidDictionaryExample,
  maskDictionaryExample,
} from '../../src/utils/dictionaryExample'

test('Learn lifecycle excludes, preserves history state, ignores Typing, and restores due-now', () => {
  const base = createInitialReviewWordState('cet4', 'cancel', 100)
  const reviewed = {
    ...base,
    nextReviewAt: 500,
    reviewCount: 4,
    lapseCount: 2,
    cleanStreak: 1,
    lastOutcome: 'hard' as const,
    schedulerState: {
      kind: 'basic-v1' as const,
      stage: 2,
      intervalDays: 7,
    },
  }

  assert.equal(getLearningLifecycle(reviewed), 'active')

  const excluded = decideLearningLifecycleTransition(reviewed, {
    kind: 'exclude',
    now: 200,
  })
  assert.equal(getLearningLifecycle(excluded), 'excluded')
  assert.equal(excluded.reviewCount, 4)
  assert.equal(excluded.lapseCount, 2)
  assert.equal(excluded.schedulerState.stage, 2)
  assert.deepEqual(excluded.exclusion, {
    reason: 'manual',
    excludedAt: 200,
  })

  const afterTyping = decideLearningLifecycleTransition(excluded, {
    kind: 'typing-observation',
  })
  assert.equal(afterTyping, excluded)
  assert.equal(getLearningLifecycle(afterTyping), 'excluded')

  const restored = decideLearningLifecycleTransition(excluded, {
    kind: 'restore',
    now: 300,
  })
  assert.equal(getLearningLifecycle(restored), 'active')
  assert.equal(restored.nextReviewAt, 300)
  assert.equal(restored.reviewCount, 4)
  assert.equal(restored.lapseCount, 2)
  assert.equal(restored.schedulerState.stage, 2)
  assert.equal(restored.exclusion, undefined)
})

test('Learn selection excludes manually excluded states in due and force modes', () => {
  const active = createInitialReviewWordState('cet4', 'active', 100)
  const excluded = decideLearningLifecycleTransition(
    createInitialReviewWordState('cet4', 'excluded', 100),
    { kind: 'exclude', now: 110 },
  )
  const candidates = [
    { word: 'active' },
    { word: 'excluded' },
  ]

  assert.deepEqual(
    selectReviewCandidates(candidates, [active, excluded], 100, 'due'),
    [{ word: 'active' }],
  )
  assert.deepEqual(
    selectReviewCandidates(candidates, [active, excluded], 100, 'force'),
    [{ word: 'active' }],
  )
})

test('pruning an excluded word removes all session duplicates and preserves logical cursor', () => {
  const word = (name: string) => ({
    name,
    trans: [],
    usphone: '',
    ukphone: '',
  })
  const record = {
    id: 7,
    dict: 'cet4',
    index: 2,
    createTime: 1,
    isFinished: false,
    words: [word('a'), word('x'), word('x'), word('b')],
    exercisePlans: {
      x: createCanonicalReviewProbePlan(),
      b: createCanonicalReviewProbePlan(),
    },
    reinforcementCounts: {
      x: 1,
    },
    acquisitionStates: {
      x: createLearnAcquisitionState(),
    },
  }

  const pruned = pruneLearnSessionWord(record, 'x')
  assert.deepEqual(
    pruned.words.map((item) => item.name),
    ['a', 'b'],
  )
  assert.equal(pruned.index, 1)
  assert.equal(pruned.isFinished, false)
  assert.equal(pruned.exercisePlans?.x, undefined)
  assert.equal(pruned.reinforcementCounts?.x, undefined)
  assert.equal(pruned.acquisitionStates?.x, undefined)
})


test('Learn acquisition starts with visible confidence-building exposure', () => {
  const plan = createLearnAcquisitionPlan()

  assert.equal(plan.condition.purpose, 'training')
  assert.equal(plan.condition.audio, 'automatic')
  assert.equal(plan.condition.meaning, 'visible')
  assert.equal(plan.condition.phonetic, 'visible')
  assert.deepEqual(plan.condition.letters, { mode: 'all-visible' })
  assert.equal(plan.condition.probeDimension, 'none')
  assert.equal(
    plan.decision.policyVersion,
    'learn-acquisition-exposure-v1',
  )
  assert.ok(plan.decision.reasonCodes.includes('visible-copy'))
})

test('Learn acquisition separates exposure, support and delayed independent recall', () => {
  let state = createLearnAcquisitionState()
  assert.equal(state.phase, 'exposure')

  state = decideLearnAcquisitionTransition(state, {
    kind: 'exposure-complete',
  })
  assert.equal(state.phase, 'guided')

  state = decideLearnAcquisitionTransition(state, {
    kind: 'guided-committed',
  })
  assert.equal(state.phase, 'supported')
  assert.equal(
    createLearnAcquisitionExercisePlan(state.phase).condition.letters.mode,
    'all-hidden',
  )

  state = decideLearnAcquisitionTransition(state, {
    kind: 'supported-complete',
  })
  assert.equal(state.phase, 'independent')
  assert.equal(
    createLearnAcquisitionExercisePlan(state.phase).condition.purpose,
    'probe',
  )

  state = decideLearnAcquisitionTransition(state, {
    kind: 'independent-complete',
    independentClean: true,
  })
  assert.equal(state.phase, 'complete')
})

test('assisted independent recall returns to support and then defers instead of fabricating mastery', () => {
  let state = createLearnAcquisitionState()
  state = decideLearnAcquisitionTransition(state, {
    kind: 'exposure-complete',
  })
  state = decideLearnAcquisitionTransition(state, {
    kind: 'guided-committed',
  })
  state = decideLearnAcquisitionTransition(state, {
    kind: 'supported-complete',
  })

  state = decideLearnAcquisitionTransition(state, {
    kind: 'independent-complete',
    independentClean: false,
  })
  assert.equal(state.phase, 'supported')
  assert.equal(state.assistedCycles, 1)

  state = decideLearnAcquisitionTransition(state, {
    kind: 'supported-complete',
  })
  state = decideLearnAcquisitionTransition(state, {
    kind: 'independent-complete',
    independentClean: false,
  })
  assert.equal(state.phase, 'deferred')
  assert.equal(state.assistedCycles, 2)
})

test('Learn acquisition follow-ups are spaced by intervening queue items', () => {
  const queue = [
    { name: 'a' },
    { name: 'b' },
    { name: 'c' },
    { name: 'd' },
    { name: 'e' },
  ]
  const supported = {
    ...createLearnAcquisitionState(),
    phase: 'supported' as const,
  }
  const first = projectLearnAcquisitionProgress({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    nextState: supported,
  })
  assert.equal(first.index, 1)
  assert.equal(first.insertWord?.index, 3)
  assert.deepEqual(
    first.queue.map((item) => item.name),
    ['a', 'b', 'c', 'a', 'd', 'e'],
  )

  const independent = {
    ...supported,
    phase: 'independent' as const,
  }
  const second = projectLearnAcquisitionProgress({
    queue: first.queue,
    currentIndex: 3,
    currentWord: first.queue[3],
    nextState: independent,
  })
  assert.equal(second.insertWord?.index, first.queue.length)
  assert.equal(second.interveningItemsBeforeFollowUp, 2)

  const spacedIndependent = {
    ...independent,
    independentInterveningItems:
      second.interveningItemsBeforeFollowUp,
  }
  assert.equal(hasSufficientIndependentSpacing(spacedIndependent), true)
  assert.ok(
    createLearnAcquisitionExercisePlan('independent', {
      independentInterveningItems:
        second.interveningItemsBeforeFollowUp,
    }).decision.reasonCodes.includes('spacing-eligible'),
  )
})

test('Independent acquisition cannot admit from a one-word short-term loop', () => {
  const word = { name: 'solo' }
  const independent = {
    ...createLearnAcquisitionState(),
    phase: 'independent' as const,
  }
  const projection = projectLearnAcquisitionProgress({
    queue: [word],
    currentIndex: 0,
    currentWord: word,
    nextState: independent,
  })

  assert.equal(projection.interveningItemsBeforeFollowUp, 0)
  const shortSpaced = {
    ...independent,
    independentInterveningItems:
      projection.interveningItemsBeforeFollowUp,
  }
  assert.equal(hasSufficientIndependentSpacing(shortSpaced), false)

  const plan = createLearnAcquisitionExercisePlan('independent', {
    independentInterveningItems:
      projection.interveningItemsBeforeFollowUp,
  })
  assert.ok(plan.decision.reasonCodes.includes('spacing-insufficient'))
  assert.equal(
    plan.decision.reasonCodes.includes('spacing-eligible'),
    false,
  )

  const deferred = deferLearnAcquisitionForSpacing(shortSpaced, 100)
  assert.equal(deferred.phase, 'deferred')
  assert.equal(deferred.deferredReason, 'spacing')
  assert.equal(deferred.assistedCycles, 0)
  assert.equal(resumeSpacingDeferredAcquisition(deferred, 399), undefined)

  const resumed = resumeSpacingDeferredAcquisition(deferred, 400)
  assert.ok(resumed)
  assert.equal(resumed.phase, 'independent')
  assert.equal(resumed.assistedCycles, 0)
  assert.equal(hasSufficientIndependentSpacing(resumed), true)
})

test('Learn stats count only spacing-valid Independent acquisition as mastery', () => {
  const now = Math.floor(new Date(2026, 9, 4, 12, 0, 0).getTime() / 1000)
  const record = (
    word: string,
    reasonCodes: string[],
  ): IWordRecord => ({
    word,
    timeStamp: now - 10,
    dict: 'spacing-stats',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'acquisition',
    reviewPolicyDecision: {
      version: 1,
      policyVersion: 'learn-acquisition-independent-v1',
      reasonCodes,
      conditionVersion: 1,
    },
    reviewEvidence: {
      version: 1,
      memoryGrade: 'good',
      errorCause: 'clean',
      confidence: 1,
      retrievalValidity: 'independent',
      evidenceStrength: 1,
      reasonCodes: ['test-independent'],
    },
  })

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'spacing-stats',
    wordRecords: [
      record('eligible', ['spacing-eligible']),
      record('too-soon', ['spacing-insufficient']),
    ],
    wordStates: [],
    dictionaryWords: ['eligible', 'too-soon'],
  })

  assert.equal(stats.today.acquiredWords, 1)
  assert.equal(stats.dailyActivity30d.at(-1)?.acquired, 1)
})

test('legacy active state seeded only from Typing is removable ghost state', () => {
  const state = createInitialReviewWordState(
    'cet4',
    'typing-only',
    100,
  )
  state.updatedAt = 200
  state.nextReviewAt = 200

  const typingRecord: IWordRecord = {
    word: 'typing-only',
    timeStamp: 100,
    dict: 'cet4',
    chapter: 1,
    timing: [],
    wrongCount: 2,
    mistakes: { 0: ['x'] },
    sourceMode: 'typing',
  }

  assert.equal(
    shouldDropLegacyTypingSeededState(state, [typingRecord]),
    true,
  )

  const acquisitionRecord: IWordRecord = {
    ...typingRecord,
    chapter: -1,
    sourceMode: 'learn',
    learnItemKind: 'acquisition',
  }

  assert.equal(
    shouldDropLegacyTypingSeededState(state, [
      typingRecord,
      acquisitionRecord,
    ]),
    false,
  )
})

test('duplicate dictionary names collapse into one Learn spelling memory with merged translations', () => {
  const words = [
    {
      name: 'bank',
      trans: ['n. 河岸'],
      usphone: 'bæŋk',
      ukphone: 'bæŋk',
    },
    {
      name: 'break',
      trans: ['v. 打破'],
      usphone: 'breɪk',
      ukphone: 'breɪk',
    },
    {
      name: 'bank',
      trans: ['n. 银行'],
      usphone: 'bæŋk',
      ukphone: 'bæŋk',
    },
  ]

  const canonical = canonicalizeLearningWords(words)

  assert.deepEqual(
    canonical.map((word) => word.name),
    ['bank', 'break'],
  )
  assert.deepEqual(canonical[0].trans, ['n. 河岸', 'n. 银行'])
})

test('Learn canonicalization merges rich fields without mutating the source dictionary', () => {
  const words = [
    {
      name: 'bank',
      trans: ['n. 河岸'],
      usphone: '',
      ukphone: '',
      example: [
        {
          en: 'They sat on the bank.',
          cn: '他们坐在河岸上。',
          start: 16,
          end: 20,
        },
      ],
      tags: ['textbook-a'],
    },
    {
      name: 'bank',
      trans: ['n. 银行'],
      usphone: '',
      ukphone: '',
      example: [
        {
          en: 'She works at a bank.',
          cn: '她在银行工作。',
          start: 15,
          end: 19,
        },
      ],
      tags: ['textbook-b'],
    },
  ]
  const original = structuredClone(words)

  const canonical = canonicalizeLearningWords(words)

  assert.equal(canonical.length, 1)
  assert.equal(canonical[0].example?.length, 2)
  assert.deepEqual(canonical[0].tags, ['textbook-a', 'textbook-b'])
  assert.deepEqual(words, original)
})

test('dictionary examples may cue an inflected surface while the spelling target remains name', () => {
  const word = {
    name: 'admit',
    trans: ['v. 承认'],
    usphone: '',
    ukphone: '',
    example: [
      {
        en: 'He finally admitted that he had made a mistake.',
        cn: '他最终承认自己犯了一个错误。',
        start: 11,
        end: 19,
      },
    ],
  }

  const example = getFirstValidDictionaryExample(word)
  assert.ok(example)
  if (!example) return

  const masked = maskDictionaryExample(example)
  assert.equal(masked.surface, 'admitted')
  assert.equal(word.name, 'admit')
  assert.equal(
    masked.before + masked.masked + masked.after,
    'He finally ________ that he had made a mistake.',
  )
})

test('invalid dictionary example ranges degrade to no-example without rejecting the word', () => {
  const word = {
    name: 'legacy-safe',
    trans: ['兼容'],
    usphone: '',
    ukphone: '',
    example: [
      {
        en: 'Example sentence.',
        cn: '例句。',
        start: 99,
        end: 120,
      },
    ],
  }

  assert.equal(getFirstValidDictionaryExample(word), undefined)
})

test('UNSEEN count is derived from the actual dictionary, ignoring stale states and duplicate names', () => {
  const words = [
    { name: 'w0', trans: [], usphone: '', ukphone: '' },
    { name: 'w1', trans: [], usphone: '', ukphone: '' },
    { name: 'w1', trans: [], usphone: '', ukphone: '' },
    { name: 'w2', trans: [], usphone: '', ukphone: '' },
  ]
  const active = createInitialReviewWordState('cet4', 'w0', 1)
  const staleState = createInitialReviewWordState('cet4', 'removed-word', 1)
  const excludedStale = decideLearningLifecycleTransition(
    createInitialReviewWordState('cet4', 'old-excluded-word', 1),
    { kind: 'exclude', now: 2 },
  )

  assert.equal(
    countUnseenLearningWords(words, [active, staleState, excludedStale]),
    2,
  )
  assert.deepEqual(
    selectUnseenLearningWords(
      words,
      [active, staleState, excludedStale],
      99,
    ).map((word) => word.name),
    ['w1', 'w2'],
  )
})

test('new-word acquisition selects only unseen words in dictionary order with a bounded batch', () => {
  const words = Array.from({ length: 30 }, (_, index) => ({
    name: 'w' + index,
    trans: [],
    usphone: '',
    ukphone: '',
  }))
  const active = createInitialReviewWordState('cet4', 'w0', 1)
  const excluded = decideLearningLifecycleTransition(
    createInitialReviewWordState('cet4', 'w2', 1),
    { kind: 'exclude', now: 2 },
  )

  const selected = selectUnseenLearningWords(
    words,
    [active, excluded],
  )

  assert.equal(selected.length, LEARN_NEW_WORD_BATCH_SIZE)
  assert.equal(selected[0].name, 'w1')
  assert.equal(selected.some((word) => word.name === 'w0'), false)
  assert.equal(selected.some((word) => word.name === 'w2'), false)
  assert.deepEqual(
    selected.slice(0, 4).map((word) => word.name),
    ['w1', 'w3', 'w4', 'w5'],
  )
})

test('acquisition WordRecord cannot be replayed as a spaced-review rating', () => {
  const acquisitionRecord: IWordRecord = {
    word: 'cancel',
    timeStamp: 100,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'acquisition',
    exerciseCondition: createLearnAcquisitionPlan().condition,
  }

  assert.equal(
    inferReviewOutcomeFromWordRecord(acquisitionRecord, []),
    undefined,
  )
})


test('Learn P2 aggregates lifecycle, due state, ratings and daily evidence without Typing leakage', () => {
  const nowDate = new Date(2026, 9, 3, 12, 0, 0)
  const now = Math.floor(nowDate.getTime() / 1000)
  const tenDaysAgo = new Date(nowDate)
  tenDaysAgo.setDate(nowDate.getDate() - 10)

  const wordRecords: IWordRecord[] = [
    {
      word: 'alpha',
      timeStamp: now - 60,
      dict: 'p2',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
    },
    {
      word: 'beta',
      timeStamp: now - 50,
      dict: 'p2',
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
        reasonCodes: ['canonical-clean-retrieval'],
      },
    },
    {
      word: 'gamma',
      timeStamp: now - 40,
      dict: 'p2',
      chapter: -1,
      timing: [],
      wrongCount: 1,
      mistakes: { 0: [' '] },
      sourceMode: 'learn',
      learnItemKind: 'review',
      learningContext: {
        version: 1,
        reviewHint: {
          maxLevel: 1,
          coldProbeSurrendered: true,
          advanceCount: 2,
        },
      },
      reviewRatingDecision: {
        eligible: true,
        rating: 'again',
        confidence: 1,
        reasonCodes: ['cold-probe-surrendered'],
      },
    },
    {
      word: 'beta',
      timeStamp: now - 30,
      dict: 'p2',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'review',
      reviewRatingDecision: {
        eligible: false,
        rating: null,
        reason: 'non-cold-attempt',
        reasonCodes: ['non-cold-attempt'],
      },
    },
    {
      word: 'legacy',
      timeStamp: Math.floor(tenDaysAgo.getTime() / 1000),
      dict: 'p2',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      reviewRatingDecision: {
        eligible: true,
        rating: 'easy',
        confidence: 1,
        reasonCodes: ['canonical-clean-retrieval'],
      },
    },
    {
      word: 'typing-noise',
      timeStamp: now - 20,
      dict: 'p2',
      chapter: 0,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'typing',
      reviewRatingDecision: {
        eligible: true,
        rating: 'easy',
        confidence: 1,
        reasonCodes: ['should-not-count'],
      },
    },
  ]

  const wordStates = [
    {
      ...createInitialReviewWordState('p2', 'alpha', now),
      nextReviewAt: now + 86400,
      schedulerState: { kind: 'basic-v2' as const, stage: 1, intervalDays: 1 },
    },
    {
      ...createInitialReviewWordState('p2', 'beta', now),
      nextReviewAt: now - 1,
      schedulerState: { kind: 'basic-v2' as const, stage: 2, intervalDays: 3 },
    },
    {
      ...createInitialReviewWordState('p2', 'gamma', now),
      lifecycle: 'excluded' as const,
      nextReviewAt: now - 1,
      schedulerState: { kind: 'basic-v2' as const, stage: 1, intervalDays: 1 },
    },
    {
      ...createInitialReviewWordState('p2', 'delta', now),
      nextReviewAt: now + 604800,
      schedulerState: { kind: 'basic-v2' as const, stage: 3, intervalDays: 7 },
    },
  ]

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p2',
    wordRecords,
    wordStates,
    dictionaryWords: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
  })

  assert.equal(stats.today.reviewedWords, 2)
  assert.equal(stats.today.acquiredWords, 1)
  assert.equal(stats.today.hintUseRate, 33.3)
  assert.equal(stats.today.reviewAttempts, 2)
  assert.equal(stats.today.coldProbeAttempts, 2)
  assert.equal(stats.today.coldProbePassRate, 50)

  assert.deepEqual(stats.lifecycle, {
    active: 3,
    due: 1,
    difficultDue: 0,
    excluded: 1,
    unseen: 1,
  })
  assert.equal(stats.scheduler.averageIntervalDays, 3.7)
  assert.equal(stats.scheduler.ratedEvents30d, 3)
  assert.equal(stats.scheduler.successRate30d, 66.7)
  assert.deepEqual(stats.scheduler.ratings30d, {
    again: 1,
    hard: 0,
    good: 1,
    easy: 1,
  })

  const today = stats.dailyActivity30d.at(-1)
  assert.ok(today)
  assert.equal(today.reviewed, 2)
  assert.equal(today.acquired, 1)
  assert.equal(today.successRate, 50)
})

test('Learn P2 keeps UNSEEN unknown when the dictionary payload is unavailable', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p2',
    wordRecords: [],
    wordStates: [],
  })

  assert.equal(stats.lifecycle.unseen, null)
  assert.equal(stats.today.hintUseRate, null)
  assert.equal(stats.scheduler.successRate30d, null)
})
