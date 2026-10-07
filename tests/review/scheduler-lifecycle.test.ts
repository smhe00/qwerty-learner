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

test('Typing failure remains evidence-only and cannot seed Learn state', () => {
  const dueNow = 10_000
  const learningFailure: IWordRecord = {
    id: 1,
    word: 'seed',
    timeStamp: 9_000,
    dict: 'cet4',
    chapter: 3,
    timing: [],
    wrongCount: 1,
    mistakes: { 1: ['x'] },
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 700,
      attempts: [
        {
          startLatencyMs: 700,
          durationMs: 100,
          correctPrefixLength: 1,
          result: 'wrong',
          wrongIndex: 1,
          wrongKey: 'x',
        },
      ],
    },
  }

  assert.equal(
    inferReviewOutcomeFromWordRecord(learningFailure, []),
    undefined,
  )

  const state = rebuildBasicStateFromWordRecords(
    'cet4',
    'seed',
    [learningFailure],
    { legacyDueAt: dueNow },
  )

  assert.equal(state, undefined)
})

test('ordinary learning clean telemetry does not create or advance review state', () => {
  const cleanLearning: IWordRecord = {
    id: 1,
    word: 'clean',
    timeStamp: 1_000,
    dict: 'cet4',
    chapter: 2,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 350,
      attempts: [],
    },
  }

  assert.equal(
    inferReviewOutcomeFromWordRecord(cleanLearning, []),
    undefined,
  )
  assert.equal(
    rebuildBasicStateFromWordRecords(
      'cet4',
      'clean',
      [cleanLearning],
      { legacyDueAt: 2_000 },
    ),
    undefined,
  )
})

test('only chapter -1 records advance the long-term scheduler', () => {
  const learningFailure: IWordRecord = {
    id: 1,
    word: 'reviewed',
    timeStamp: 1_000,
    dict: 'cet4',
    chapter: 4,
    timing: [],
    wrongCount: 1,
    mistakes: { 2: ['x'] },
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 900,
      attempts: [],
    },
  }
  const reviewAttempt: IWordRecord = {
    id: 2,
    word: 'reviewed',
    timeStamp: 2_000,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 600,
      attempts: [],
    },
  }

  const state = rebuildBasicStateFromWordRecords(
    'cet4',
    'reviewed',
    [learningFailure, reviewAttempt],
    { legacyDueAt: 3_000 },
  )

  assert.ok(state)
  assert.equal(state.reviewCount, 1)
  assert.equal(state.lastReviewedAt, 2_000)
  assert.equal(state.nextReviewAt, 2_000 + 24 * 60 * 60)
  assert.deepEqual(state.schedulerState, {
    kind: 'basic-v2',
    stage: 0,
    intervalDays: 1,
  })
})

test('basic-v1 compatibility upgrade preserves due date, counters, and lifecycle exactly', () => {
  const legacy = {
    ...createInitialReviewWordState('cet4', 'legacy-v1', 100),
    updatedAt: 150,
    lastReviewedAt: 120,
    nextReviewAt: 999_999,
    reviewCount: 7,
    lapseCount: 2,
    cleanStreak: 3,
    lastOutcome: 'good' as const,
    lifecycle: 'excluded' as const,
    exclusion: {
      reason: 'manual' as const,
      excludedAt: 140,
    },
    schedulerState: {
      kind: 'basic-v1' as const,
      stage: 4,
      intervalDays: 30,
    },
  }

  const upgraded = upgradeBasicSchedulerState(legacy)

  assert.equal(upgraded.stateVersion, CURRENT_REVIEW_STATE_VERSION)
  assert.equal(upgraded.nextReviewAt, legacy.nextReviewAt)
  assert.equal(upgraded.updatedAt, legacy.updatedAt)
  assert.equal(upgraded.lastReviewedAt, legacy.lastReviewedAt)
  assert.equal(upgraded.reviewCount, legacy.reviewCount)
  assert.equal(upgraded.lapseCount, legacy.lapseCount)
  assert.equal(upgraded.cleanStreak, legacy.cleanStreak)
  assert.equal(upgraded.lifecycle, 'excluded')
  assert.deepEqual(upgraded.exclusion, legacy.exclusion)
  assert.deepEqual(upgraded.schedulerState, {
    kind: 'basic-v2',
    stage: 4,
    intervalDays: 30,
  })
})

test('basic-v2 extends mature Good reviews through 60, 120, and 180 day stages', () => {
  const day = 24 * 60 * 60
  let now = 1_000
  let state = createInitialReviewWordState('cet4', 'mature', now)

  const expectedIntervals = [1, 3, 7, 14, 30, 60, 120, 180, 180]
  for (const expectedDays of expectedIntervals) {
    state = scheduleBasicReview({
      state,
      outcome: 'good',
      now,
    })
    assert.equal(state.schedulerState.kind, 'basic-v2')
    if (state.schedulerState.kind !== 'basic-v2') return
    assert.equal(state.schedulerState.intervalDays, expectedDays)
    assert.equal(state.nextReviewAt, now + expectedDays * day)
    now = state.nextReviewAt
  }
})

test('a due legacy basic-v1 card upgrades only when rated and can advance into the v2 tail', () => {
  const day = 24 * 60 * 60
  const now = 10_000
  const legacy = {
    ...createInitialReviewWordState('cet4', 'legacy-tail', 1),
    lastReviewedAt: now - 30 * day,
    nextReviewAt: now,
    reviewCount: 5,
    cleanStreak: 5,
    schedulerState: {
      kind: 'basic-v1' as const,
      stage: 4,
      intervalDays: 30,
    },
  }

  const next = scheduleBasicReview({
    state: legacy,
    outcome: 'good',
    now,
  })

  assert.equal(next.schedulerState.kind, 'basic-v2')
  if (next.schedulerState.kind !== 'basic-v2') return
  assert.equal(next.schedulerState.stage, 5)
  assert.equal(next.schedulerState.intervalDays, 60)
  assert.equal(next.nextReviewAt, now + 60 * day)
  assert.equal(next.reviewCount, 6)
})

test('FSRS activation bumps review stateVersion to 5 so basic-v2 rows are rebuilt', () => {
  assert.equal(CURRENT_REVIEW_STATE_VERSION, 5)
  assert.notEqual(4, CURRENT_REVIEW_STATE_VERSION)
})


test('review queue keeps WordComponent mounted across words and remounts only on explicit reload', () => {
  assert.equal(
    getWordComponentInstanceKey({
      isReviewMode: false,
      reviewIndex: 0,
      reloadKey: 7,
    }),
    7,
  )
  assert.equal(
    getWordComponentInstanceKey({
      isReviewMode: true,
      reviewIndex: 0,
      reloadKey: 7,
    }),
    7,
  )
  assert.equal(
    getWordComponentInstanceKey({
      isReviewMode: true,
      reviewIndex: 5,
      reloadKey: 7,
    }),
    7,
  )
  assert.notEqual(
    getWordComponentInstanceKey({
      isReviewMode: true,
      reviewIndex: 5,
      reloadKey: 7,
    }),
    getWordComponentInstanceKey({
      isReviewMode: true,
      reviewIndex: 5,
      reloadKey: 8,
    }),
  )
})


test('input gate rejects every key after the target length', () => {
  assert.deepEqual(
    decideWordInput({
      inputLength: 6,
      targetLength: 6,
      hasWrong: false,
      isFinished: false,
    }),
    { accept: false, reason: 'target-complete' },
  )
  assert.deepEqual(
    decideWordInput({
      inputLength: 5,
      targetLength: 6,
      hasWrong: false,
      isFinished: false,
    }),
    { accept: true, index: 5, isFinal: true },
  )
})

test('automatic pronunciation is emitted at most once per attempt', () => {
  assert.equal(
    shouldPlayAutomaticPronunciation({
      isTyping: true,
      inputLength: 0,
      automaticAudioEnabled: true,
      alreadyPlayedForAttempt: false,
    }),
    true,
  )
  assert.equal(
    shouldPlayAutomaticPronunciation({
      isTyping: true,
      inputLength: 0,
      automaticAudioEnabled: true,
      alreadyPlayedForAttempt: true,
    }),
    false,
  )
})

test('assisted spelling and motor errors remain assisted evidence', () => {
  const assisted = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [true, true, true],
  })

  for (const cause of ['spelling', 'motor'] as const) {
    const evidence = evaluateReviewEvidence(
      { exerciseCondition: assisted },
      {
        cause,
        confidence: 0.8,
        scores: { recall: 0.1, spelling: 0.7, motor: 0.2 },
      },
    )
    assert.equal(evidence.retrievalValidity, 'assisted')
    assert.ok(evidence.reasonCodes.includes('orthographic-cue-full'))
    assert.ok(evidence.reasonCodes.includes('automatic-audio-cue'))
  }
})

test('out-of-range typo positions are excluded from orthography evidence', () => {
  const record: IWordRecord = {
    word: 'cancel',
    timeStamp: 1,
    dict: 'cet4',
    chapter: 1,
    timing: [],
    wrongCount: 1,
    mistakes: { 6: ['s'] },
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 500,
      attempts: [
        {
          startLatencyMs: 500,
          durationMs: 50,
          correctPrefixLength: 6,
          result: 'wrong',
          wrongIndex: 6,
          wrongKey: 's',
        },
      ],
    },
  }

  const profile = buildOrthographyProfile('cancel', [record])
  assert.equal(profile.totalWrongEvents, 0)
  assert.equal(profile.dominantWrongIndex, undefined)

  const classification = classifyTypingError({
    word: 'cancel',
    wrongCount: record.wrongCount,
    telemetry: record.typingTelemetry,
  })
  assert.equal(classification.cause, 'clean')
})


test('Typing failure after Review does not reactivate Learn scheduler state', () => {
  const reviewed = createInitialReviewWordState('cet4', 'again', 100)
  reviewed.lastReviewedAt = 200
  reviewed.nextReviewAt = 200 + 24 * 60 * 60
  reviewed.reviewCount = 1
  reviewed.cleanStreak = 1
  reviewed.lastOutcome = 'good'
  reviewed.schedulerState = {
    kind: 'basic-v1',
    stage: 0,
    intervalDays: 1,
  }

  const records: IWordRecord[] = [
    {
      id: 1,
      word: 'again',
      timeStamp: 200,
      dict: 'cet4',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
    },
    {
      id: 2,
      word: 'again',
      timeStamp: 300,
      dict: 'cet4',
      chapter: 5,
      timing: [],
      wrongCount: 2,
      mistakes: { 1: ['x'] },
    },
  ]

  assert.equal(hasUnreviewedLearningFailure(records), false)

  const reactivated = reactivateReviewStateFromLearningEvidence(
    reviewed,
    records,
    400,
  )

  assert.equal(reactivated, reviewed)
  assert.equal(reactivated.nextReviewAt, reviewed.nextReviewAt)
  assert.equal(reactivated.reviewCount, 1)
  assert.equal(reactivated.cleanStreak, 1)
  assert.equal(reactivated.lastReviewedAt, 200)
  assert.deepEqual(reactivated.schedulerState, reviewed.schedulerState)
})

test('learning failure before latest Review does not reactivate a future state', () => {
  const state = createInitialReviewWordState('cet4', 'covered', 100)
  state.lastReviewedAt = 300
  state.nextReviewAt = 10_000
  state.reviewCount = 1

  const records: IWordRecord[] = [
    {
      id: 1,
      word: 'covered',
      timeStamp: 200,
      dict: 'cet4',
      chapter: 5,
      timing: [],
      wrongCount: 1,
      mistakes: { 1: ['x'] },
    },
    {
      id: 2,
      word: 'covered',
      timeStamp: 300,
      dict: 'cet4',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
    },
  ]

  assert.equal(hasUnreviewedLearningFailure(records), false)
  assert.equal(
    reactivateReviewStateFromLearningEvidence(state, records, 400),
    state,
  )
})

test('force Review selects all ACTIVE candidates while due mode selects only due ACTIVE candidates', () => {
  const now = 1_000
  const candidates = [
    { word: 'due' },
    { word: 'future' },
    { word: 'missing' },
  ]
  const dueState = createInitialReviewWordState('cet4', 'due', 1)
  dueState.nextReviewAt = 900
  const futureState = createInitialReviewWordState('cet4', 'future', 1)
  futureState.nextReviewAt = 2_000

  assert.deepEqual(
    selectReviewCandidates(
      candidates,
      [dueState, futureState],
      now,
      'due',
    ).map((candidate) => candidate.word),
    ['due'],
  )
  assert.deepEqual(
    selectReviewCandidates(
      candidates,
      [dueState, futureState],
      now,
      'force',
    ).map((candidate) => candidate.word),
    ['due', 'future'],
  )
})


test('Review attempt role is cold once, reinforcement thereafter, and acquisition is non-rateable', () => {
  assert.equal(
    getReviewAttemptRole({
      sessionKind: 'review',
      reinforcementUsed: 0,
    }),
    'cold',
  )
  assert.equal(
    getReviewAttemptRole({
      sessionKind: 'review',
      reinforcementUsed: 1,
    }),
    'reinforcement',
  )
  assert.equal(
    getReviewAttemptRole({
      sessionKind: 'acquisition',
      reinforcementUsed: 0,
    }),
    undefined,
  )
})

test('completed Review item retries retryable null exactly once then defers', () => {
  let state = createReviewItemMachineState()
  const attention = {
    eligible: false as const,
    rating: null,
    reason: 'attention-uncertain' as const,
    reasonCodes: ['attention-uncertain'],
  }

  const first = resolveCompletedReviewItem({
    state,
    attemptRole: 'cold',
    decision: attention,
    requestReinforcement: false,
  })
  assert.equal(first.kind, 'retry-canonical')
  state = first.state
  assert.equal(state.phase, 'invalid-retry')
  assert.equal(state.invalidRetryRemaining, 0)

  const second = resolveCompletedReviewItem({
    state,
    attemptRole: 'cold',
    decision: attention,
    requestReinforcement: false,
  })
  assert.equal(second.kind, 'advance')
  assert.equal(second.state.phase, 'deferred')
})

test('completed rated failure consumes training and requests one bounded reinforcement', () => {
  const resolution = resolveCompletedReviewItem({
    state: createReviewItemMachineState(),
    attemptRole: 'cold',
    decision: {
      eligible: true,
      rating: 'again',
      confidence: 1,
      reasonCodes: ['fixture'],
    },
    requestReinforcement: true,
  })

  assert.equal(resolution.kind, 'advance')
  if (resolution.kind !== 'advance') return
  assert.equal(resolution.insertReinforcement, true)
  assert.equal(resolution.state.phase, 'reinforcement')
  assert.equal(resolution.state.ratingEmitted, true)
  assert.equal(resolution.state.reinforcementRemaining, 0)

  const terminal = resolveCompletedReviewItem({
    state: resolution.state,
    attemptRole: 'reinforcement',
    decision: {
      eligible: false,
      rating: null,
      reason: 'non-cold-attempt',
      reasonCodes: ['non-cold-attempt'],
    },
    requestReinforcement: false,
  })
  assert.equal(terminal.kind, 'advance')
  assert.equal(terminal.state.phase, 'done')
  if (terminal.kind === 'advance') {
    assert.equal(terminal.insertReinforcement, false)
  }
})

test('review progression can insert explicit reinforcement even after zero wrong keys', () => {
  const queue = [{ name: 'forgotten' }, { name: 'next' }]
  const decision = decideReviewProgress({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    currentExerciseCount: 0,
    loopWordTimes: 1,
    priorAccumulatedWrongCount: 0,
    attemptWrongCount: 0,
    currentReinforcementGap: MAX_REINFORCEMENT_GAP,
    attemptReinforcementGap: MAX_REINFORCEMENT_GAP,
    reinforcementRemaining: 1,
    requestReinforcement: true,
  })

  assert.equal(decision.kind, 'advance')
  if (decision.kind !== 'advance') return
  assert.equal(decision.insertWord?.word.name, 'forgotten')
})

test('review progression refuses a second reinforcement when the per-session budget is exhausted', () => {
  const word = { name: 'persistent' }
  const decision = decideReviewProgress({
    queue: [word],
    currentIndex: 0,
    currentWord: word,
    currentExerciseCount: 0,
    loopWordTimes: 1,
    priorAccumulatedWrongCount: 0,
    attemptWrongCount: 3,
    currentReinforcementGap: 3,
    attemptReinforcementGap: 3,
    reinforcementRemaining: 0,
  })

  assert.deepEqual(decision, { kind: 'finish' })
})

test('review progression consumes the only reinforcement opportunity when budget remains', () => {
  const word = { name: 'persistent' }
  const decision = decideReviewProgress({
    queue: [word],
    currentIndex: 0,
    currentWord: word,
    currentExerciseCount: 0,
    loopWordTimes: 1,
    priorAccumulatedWrongCount: 0,
    attemptWrongCount: 3,
    currentReinforcementGap: 3,
    attemptReinforcementGap: 3,
    reinforcementRemaining: 1,
  })

  assert.equal(decision.kind, 'advance')
  if (decision.kind === 'advance') {
    assert.equal(decision.nextIndex, 1)
    assert.equal(decision.insertWord?.word.name, 'persistent')
  }
})


test('canonical Review probe overrides ordinary user presentation settings', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: false,
    phoneticVisible: true,
    letterVisibility: [true, true, true],
  })
  const canonical = createCanonicalReviewProbePlan()
  const active = resolveExercisePlanForAttempt(baseline, canonical)

  assert.equal(active.decision.policyVersion, CANONICAL_REVIEW_PROBE_POLICY_VERSION)
  assert.deepEqual(active.condition, canonical.condition)
  assert.equal(active.condition.purpose, 'probe')
  assert.equal(active.condition.probeDimension, 'none')
  assert.equal(active.condition.audio, 'none')
  assert.equal(active.condition.meaning, 'visible')
  assert.equal(active.condition.phonetic, 'hidden')
  assert.equal(active.condition.letters.mode, 'all-hidden')
})

test('manually requested pronunciation marks an otherwise canonical retrieval as assisted', () => {
  const condition = createCanonicalReviewProbePlan().condition
  const evidence = evaluateReviewEvidence(
    {
      exerciseCondition: condition,
      learningContext: {
        version: 1,
        answerVisibilityAtStart: 'hidden',
        meaningVisibleAtStart: true,
        phoneticVisibleAtStart: false,
        pronunciationEnabledAtStart: false,
        pronunciationPlayed: true,
        pronunciationPlayedBeforeFirstKey: true,
        pronunciationPlayCount: 1,
        pronunciationAutomaticPlayCount: 0,
        pronunciationRequestedPlayCount: 1,
      },
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 500,
        attempts: [],
      },
    },
    {
      cause: 'clean',
      confidence: 0.9,
      scores: { recall: 0, spelling: 0, motor: 0 },
    },
  )

  assert.equal(evidence.retrievalValidity, 'assisted')
  assert.ok(evidence.reasonCodes.includes('requested-audio-cue'))
})
