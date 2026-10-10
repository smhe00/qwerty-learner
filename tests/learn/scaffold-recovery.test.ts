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

test('dynamic scaffold keeps acquisition boundaries and softens only Supported work', () => {
  const tiers = ['unknown', 'low', 'elevated', 'recovery'] as const

  for (const strainTier of tiers) {
    assert.equal(
      decideLearnScaffold({
        phase: 'exposure',
        strainTier,
        assistedCycles: 2,
      }).level,
      'S0',
    )
    assert.equal(
      decideLearnScaffold({
        phase: 'independent',
        strainTier,
        assistedCycles: 2,
      }).level,
      'S3',
    )
  }

  assert.equal(
    decideLearnScaffold({
      phase: 'supported',
      strainTier: 'low',
      assistedCycles: 0,
    }).level,
    'S2',
  )
  assert.equal(
    decideLearnScaffold({
      phase: 'supported',
      strainTier: 'elevated',
      assistedCycles: 0,
    }).level,
    'S1',
  )
  assert.equal(
    decideLearnScaffold({
      phase: 'supported',
      strainTier: 'recovery',
      assistedCycles: 0,
    }).level,
    'S1',
  )
  assert.equal(
    decideLearnScaffold({
      phase: 'supported',
      strainTier: 'low',
      assistedCycles: 1,
    }).level,
    'S1',
  )
})

test('dynamic scaffold V1.1 targets a known wrong position without guessing', () => {
  assert.deepEqual(getLearnScaffoldPresentation('S1'), {
    purpose: 'training',
    audio: 'automatic',
    phonetic: 'visible',
    letters: { mode: 'all-hidden' },
  })
  assert.deepEqual(
    getLearnScaffoldPresentation('S1', { hintPosition: 2 }),
    {
      purpose: 'training',
      audio: 'automatic',
      phonetic: 'visible',
      letters: {
        mode: 'partial',
        visiblePositions: [2],
      },
    },
  )
  assert.deepEqual(getLearnScaffoldPresentation('S2'), {
    purpose: 'training',
    audio: 'none',
    phonetic: 'hidden',
    letters: { mode: 'all-hidden' },
  })

  const strong = createLearnAcquisitionExercisePlan('supported', {
    scaffoldStrainTier: 'low',
    scaffoldHintPosition: 2,
    assistedCycles: 0,
  })
  assert.equal(strong.condition.purpose, 'training')
  assert.equal(strong.condition.audio, 'automatic')
  assert.equal(strong.condition.phonetic, 'visible')
  assert.deepEqual(strong.condition.letters, {
    mode: 'partial',
    visiblePositions: [2],
  })
  assert.ok(strong.decision.reasonCodes.includes('dynamic-scaffold-s1'))
  assert.ok(
    strong.decision.reasonCodes.includes('position-targeted-support-2'),
  )

  const independent = createLearnAcquisitionExercisePlan('independent', {
    scaffoldStrainTier: 'recovery',
    assistedCycles: 2,
    independentInterveningItems: 2,
  })
  assert.equal(independent.condition.purpose, 'probe')
  assert.equal(independent.condition.audio, 'none')
  assert.equal(independent.condition.phonetic, 'hidden')
  assert.ok(
    independent.decision.reasonCodes.includes('dynamic-scaffold-s3'),
  )
  assert.ok(independent.decision.reasonCodes.includes('spacing-eligible'))
})

test('independent failure carries its last wrong position only into Supported scaffold', () => {
  const independent = {
    ...createLearnAcquisitionState({ scaffoldStrainTier: 'low' }),
    phase: 'independent' as const,
    independentInterveningItems: 4,
  }

  const supported = decideLearnAcquisitionTransition(independent, {
    kind: 'independent-complete',
    independentClean: false,
    scaffoldHintPosition: 2,
  })
  assert.equal(supported.phase, 'supported')
  assert.equal(supported.assistedCycles, 1)
  assert.equal(supported.scaffoldHintPosition, 2)

  const nextIndependent = decideLearnAcquisitionTransition(supported, {
    kind: 'supported-complete',
  })
  assert.equal(nextIndependent.phase, 'independent')
  assert.equal(nextIndependent.scaffoldHintPosition, undefined)
})

test('S1 scaffold starts Strong Hint and ESC surrenders directly to full answer', () => {
  const state = createReviewHintMachineState({
    initialLevel: 1,
    hintPosition: 2,
  })
  assert.equal(state.stage, 'hint-1')
  assert.equal(state.maxLevelReached, 1)
  assert.equal(state.failureCount, 2)
  assert.equal(state.hintPosition, 2)

  const decision = decideReviewHintInput({
    state,
    inputIndex: 0,
    key: 'Escape',
  })
  assert.equal(decision.kind, 'advance-hint')
  if (decision.kind !== 'advance-hint') return
  assert.equal(decision.from, 'hint-1')
  assert.equal(decision.to, 'hint-3')
  assert.equal(decision.level, 3)
  assert.equal(decision.hintPosition, 2)
  assert.equal(decision.failureCount, 2)
})

test('Recovery Window pulls only high-confidence training items ahead of a difficult retry', () => {
  const queue = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name }))
  const current = {
    ...createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
    phase: 'supported' as const,
    assistedCycles: 1,
  }
  const acquisitionStates = {
    a: current,
    b: {
      ...createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
      phase: 'independent' as const,
    },
    c: createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
    d: {
      ...createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
      phase: 'supported' as const,
    },
    e: {
      ...createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
      phase: 'complete' as const,
    },
    f: createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
  }

  const plan = planLearnRecoveryWindow({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    nextState: current,
    acquisitionStates,
  })

  assert.equal(plan.active, true)
  assert.equal(plan.targetSize, 3)
  assert.deepEqual(plan.selectedNames, ['c', 'd', 'f'])
  assert.equal(plan.selectedNames.includes('b'), false)
  assert.equal(plan.selectedNames.includes('e'), false)

  assert.deepEqual(
    applyLearnRecoveryWindow(queue, 0, plan.selectedNames).map(
      (item) => item.name,
    ),
    ['a', 'c', 'd', 'f', 'b', 'e'],
  )

  const projection = projectLearnAcquisitionProgress({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    nextState: current,
    acquisitionStates,
  })
  assert.deepEqual(
    projection.queue.map((item) => item.name),
    ['a', 'c', 'd', 'f', 'a', 'b', 'e'],
  )
  assert.equal(projection.interveningItemsBeforeFollowUp, 3)
  assert.deepEqual(projection.recoveryWindow?.selectedNames, ['c', 'd', 'f'])
})

test('Recovery Window is bounded by strain tier and never activates on low strain', () => {
  const queue = ['a', 'b', 'c', 'd'].map((name) => ({ name }))
  const exposureStates = Object.fromEntries(
    queue.map((item) => [
      item.name,
      createLearnAcquisitionState({ scaffoldStrainTier: 'elevated' }),
    ]),
  )

  const elevated = planLearnRecoveryWindow({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    nextState: {
      ...createLearnAcquisitionState({ scaffoldStrainTier: 'elevated' }),
      phase: 'supported',
      assistedCycles: 1,
    },
    acquisitionStates: exposureStates,
  })
  assert.equal(elevated.active, true)
  assert.equal(elevated.targetSize, 2)
  assert.deepEqual(elevated.selectedNames, ['b', 'c'])

  const low = planLearnRecoveryWindow({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    nextState: {
      ...createLearnAcquisitionState({ scaffoldStrainTier: 'low' }),
      phase: 'supported',
      assistedCycles: 1,
    },
    acquisitionStates: exposureStates,
  })
  assert.equal(low.active, false)
  assert.deepEqual(low.selectedNames, [])
})

test('Recovery Window never pulls a candidate beyond its bounded lookahead horizon', () => {
  const queue = Array.from({ length: 12 }, (_, i) => ({ name: 'horizon-' + i }))
  const current = {
    ...createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
    phase: 'supported' as const,
    assistedCycles: 1,
  }
  const states = Object.fromEntries(queue.map(item => [
    item.name,
    { ...createLearnAcquisitionState(), phase: 'independent' as const },
  ]))
  // The only trainable candidate is at index 9. With the documented eight
  // lookahead slots, indices 1..8 are visible, index 9 is out of reach.
  states[queue[9].name] = { ...createLearnAcquisitionState(), phase: 'exposure' }
  const plan = planLearnRecoveryWindow({
    queue, currentIndex: 0, currentWord: queue[0],
    nextState: current, acquisitionStates: states,
  })
  assert.equal(plan.active, false)
  assert.deepEqual(plan.selectedNames, [],
    'recovery must not move far-away work forward past the lookahead boundary')
})
