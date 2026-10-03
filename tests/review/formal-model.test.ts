import { canonicalizeLearningWords } from '../../src/learn/session'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createBaselineExerciseCondition } from '../../src/review/condition'
import { selectReviewCandidates } from '../../src/review/due'
import {
  chooseAudioWithdrawalShadow,
  chooseNextExerciseShadow,
  chooseTargetedMaskPlan,
} from '../../src/review/exercise-policy'
import {
  decideReviewProgress,
  decideWordInput,
  projectReviewProgress,
  shouldPlayAutomaticPronunciation,
} from '../../src/review/machine'
import {
  MAX_REINFORCEMENT_GAP,
  MIN_REINFORCEMENT_GAP,
} from '../../src/review/session'
import {
  MAX_INVALID_RETRY_PER_ITEM,
  MAX_REINFORCEMENT_PER_WORD_PER_SESSION,
  createReviewItemMachineState,
  decideReviewItemTransition,
  decideReviewRating,
  isTerminalReviewItemState,
  reviewItemTerminationVariant,
} from '../../src/review/state-machine'
import type {
  RatingDecision,
  ReviewItemEvent,
  ReviewItemMachineState,
} from '../../src/review/state-machine'
import type { OrthographyProfile } from '../../src/review/profile'
import {
  hasUnreviewedLearningFailure,
  reactivateReviewStateFromLearningEvidence,
} from '../../src/review/rebuild'
import { basicV2ReviewIntervalsDays } from '../../src/review/policy'
import {
  scheduleBasicReview,
  upgradeBasicSchedulerState,
} from '../../src/review/scheduler'
import { createInitialReviewWordState } from '../../src/review/types'
import type { IWordRecord } from '../../src/utils/db/record'

test('formal/input-safety: exhaustive bounded input states never accept an out-of-range index', () => {
  let explored = 0

  for (let targetLength = 0; targetLength <= 12; targetLength += 1) {
    for (let inputLength = 0; inputLength <= targetLength + 2; inputLength += 1) {
      for (const hasWrong of [false, true]) {
        for (const isFinished of [false, true]) {
          const decision = decideWordInput({
            inputLength,
            targetLength,
            hasWrong,
            isFinished,
          })
          explored += 1

          if (decision.accept) {
            assert.ok(targetLength > 0)
            assert.ok(decision.index >= 0)
            assert.ok(decision.index < targetLength)
            assert.equal(decision.index, inputLength)
            assert.equal(
              decision.isFinal,
              decision.index === targetLength - 1,
            )
          }
        }
      }
    }
  }

  assert.equal(explored, 468)
})

test('formal/audio-safety: automatic pronunciation can fire only once per attempt', () => {
  let explored = 0

  for (const isTyping of [false, true]) {
    for (const automaticAudioEnabled of [false, true]) {
      for (const alreadyPlayedForAttempt of [false, true]) {
        for (let inputLength = 0; inputLength <= 2; inputLength += 1) {
          const result = shouldPlayAutomaticPronunciation({
            isTyping,
            inputLength,
            automaticAudioEnabled,
            alreadyPlayedForAttempt,
          })
          explored += 1

          assert.equal(
            result,
            isTyping &&
              automaticAudioEnabled &&
              !alreadyPlayedForAttempt &&
              inputLength === 0,
          )
        }
      }
    }
  }

  assert.equal(explored, 24)
})

test('formal/progress-safety: exhaustive bounded review completion states have one valid transition', () => {
  let explored = 0

  for (let queueLength = 1; queueLength <= 5; queueLength += 1) {
    const queue = Array.from({ length: queueLength }, (_, index) => ({
      name: 'w' + index,
    }))

    for (let currentIndex = 0; currentIndex < queueLength; currentIndex += 1) {
      for (let loopWordTimes = 1; loopWordTimes <= 3; loopWordTimes += 1) {
        for (
          let currentExerciseCount = 0;
          currentExerciseCount < loopWordTimes;
          currentExerciseCount += 1
        ) {
          for (let priorWrong = 0; priorWrong <= 2; priorWrong += 1) {
            for (let attemptWrong = 0; attemptWrong <= 2; attemptWrong += 1) {
              for (
                let currentGap = MIN_REINFORCEMENT_GAP;
                currentGap <= MAX_REINFORCEMENT_GAP;
                currentGap += 1
              ) {
                for (
                  let attemptGap = MIN_REINFORCEMENT_GAP;
                  attemptGap <= MAX_REINFORCEMENT_GAP;
                  attemptGap += 1
                ) {
                  const decision = decideReviewProgress({
                    queue,
                    currentIndex,
                    currentWord: queue[currentIndex],
                    currentExerciseCount,
                    loopWordTimes,
                    priorAccumulatedWrongCount: priorWrong,
                    attemptWrongCount: attemptWrong,
                    currentReinforcementGap: currentGap,
                    attemptReinforcementGap: attemptGap,
                  })
                  explored += 1

                  if (decision.kind === 'loop-current') {
                    assert.ok(currentExerciseCount < loopWordTimes - 1)
                    assert.equal(
                      decision.nextExerciseCount,
                      currentExerciseCount + 1,
                    )
                    assert.equal(
                      decision.nextAccumulatedWrongCount,
                      priorWrong + attemptWrong,
                    )
                    assert.ok(
                      decision.nextReinforcementGap >=
                        MIN_REINFORCEMENT_GAP,
                    )
                    assert.ok(
                      decision.nextReinforcementGap <=
                        MAX_REINFORCEMENT_GAP,
                    )
                    continue
                  }

                  assert.equal(
                    currentExerciseCount,
                    loopWordTimes - 1,
                  )

                  if (decision.kind === 'advance') {
                    assert.equal(decision.nextIndex, currentIndex + 1)
                    if (decision.insertWord) {
                      assert.ok(
                        decision.insertWord.index > currentIndex,
                      )
                      assert.ok(
                        decision.insertWord.index <= queueLength,
                      )
                      assert.equal(
                        decision.insertWord.word.name,
                        queue[currentIndex].name,
                      )
                    } else {
                      assert.ok(currentIndex < queueLength - 1)
                    }
                    continue
                  }

                  assert.equal(decision.kind, 'finish')
                  assert.equal(currentIndex, queueLength - 1)
                  assert.equal(priorWrong + attemptWrong, 0)
                }
              }
            }
          }
        }
      }
    }
  }

  assert.ok(explored > 20_000)
})

type ModelState = {
  queue: Array<{ name: string }>
  index: number
  exerciseCount: number
  accumulatedWrong: number
  gap: number
  reinforcementCounts: Record<string, number>
  finished: boolean
}

function applyModelCompletion(
  state: ModelState,
  input: { wrongCount: number; loopWordTimes: number; attemptGap: number },
): ModelState {
  if (state.finished) return state

  const decision = decideReviewProgress({
    queue: state.queue,
    currentIndex: state.index,
    currentWord: state.queue[state.index],
    currentExerciseCount: state.exerciseCount,
    loopWordTimes: input.loopWordTimes,
    priorAccumulatedWrongCount: state.accumulatedWrong,
    attemptWrongCount: input.wrongCount,
    currentReinforcementGap: state.gap,
    attemptReinforcementGap: input.attemptGap,
    reinforcementRemaining: Math.max(
      0,
      MAX_REINFORCEMENT_PER_WORD_PER_SESSION -
        (state.reinforcementCounts[state.queue[state.index].name] ?? 0),
    ),
  })

  if (decision.kind === 'loop-current') {
    return {
      ...state,
      exerciseCount: decision.nextExerciseCount,
      accumulatedWrong: decision.nextAccumulatedWrongCount,
      gap: decision.nextReinforcementGap,
    }
  }

  if (decision.kind === 'finish') {
    return { ...state, finished: true }
  }

  const queue = [...state.queue]
  const reinforcementCounts = { ...state.reinforcementCounts }
  if (decision.insertWord) {
    queue.splice(
      decision.insertWord.index,
      0,
      decision.insertWord.word,
    )
    reinforcementCounts[decision.insertWord.word.name] =
      (reinforcementCounts[decision.insertWord.word.name] ?? 0) + 1
  }

  return {
    queue,
    index: decision.nextIndex,
    exerciseCount: 0,
    accumulatedWrong: 0,
    gap: MAX_REINFORCEMENT_GAP,
    reinforcementCounts,
    finished: false,
  }
}

test('formal/progress-liveness: every finite queue terminates after clean completions', () => {
  for (let queueLength = 1; queueLength <= 6; queueLength += 1) {
    for (let loopWordTimes = 1; loopWordTimes <= 3; loopWordTimes += 1) {
      let state: ModelState = {
        queue: Array.from({ length: queueLength }, (_, index) => ({
          name: 'w' + index,
        })),
        index: 0,
        exerciseCount: 0,
        accumulatedWrong: 0,
        gap: MAX_REINFORCEMENT_GAP,
        reinforcementCounts: {},
        finished: false,
      }

      const bound = queueLength * loopWordTimes + 1
      for (let step = 0; step < bound && !state.finished; step += 1) {
        state = applyModelCompletion(state, {
          wrongCount: 0,
          loopWordTimes,
          attemptGap: MAX_REINFORCEMENT_GAP,
        })
      }

      assert.equal(
        state.finished,
        true,
        'clean finite queue must terminate',
      )
    }
  }
})

test('formal/progress-liveness: one failure plus finite reinforcement still terminates', () => {
  for (let queueLength = 1; queueLength <= 5; queueLength += 1) {
    for (let loopWordTimes = 1; loopWordTimes <= 3; loopWordTimes += 1) {
      let state: ModelState = {
        queue: Array.from({ length: queueLength }, (_, index) => ({
          name: 'w' + index,
        })),
        index: 0,
        exerciseCount: 0,
        accumulatedWrong: 0,
        gap: MAX_REINFORCEMENT_GAP,
        reinforcementCounts: {},
        finished: false,
      }

      state = applyModelCompletion(state, {
        wrongCount: 1,
        loopWordTimes,
        attemptGap: MIN_REINFORCEMENT_GAP,
      })

      const bound = (queueLength + 2) * loopWordTimes + 3
      for (let step = 0; step < bound && !state.finished; step += 1) {
        state = applyModelCompletion(state, {
          wrongCount: 0,
          loopWordTimes,
          attemptGap: MAX_REINFORCEMENT_GAP,
        })
      }

      assert.equal(
        state.finished,
        true,
        'finite reinforcement must not create an endless review',
      )
    }
  }
})

test('formal/condition-safety: targeted mask positions are always in range and partition the word', () => {
  for (let wordLength = 1; wordLength <= 12; wordLength += 1) {
    for (let weakIndex = 0; weakIndex < wordLength; weakIndex += 1) {
      const orthography: OrthographyProfile = {
        word: 'x'.repeat(wordLength),
        recordCount: 3,
        failedRecordCount: 3,
        totalWrongEvents: 3,
        positions: [
          {
            index: weakIndex,
            errorRecordCount: 3,
            errorEventCount: 3,
            failedRecordRatio: 1,
          },
        ],
        confusions: [],
        dominantWrongIndex: weakIndex,
        dominantWrongRecordCount: 3,
        dominantWrongRecordRatio: 1,
      }
      const baseline = createBaselineExerciseCondition({
        pronunciationEnabled: true,
        meaningVisible: true,
        phoneticVisible: false,
        letterVisibility: Array(wordLength).fill(false),
      })
      const plan = chooseTargetedMaskPlan({
        baselineCondition: baseline,
        orthography,
        wordLength,
      })

      assert.ok(plan)
      const masked = plan.condition.letters.maskedPositions ?? []
      const visible = plan.condition.letters.visiblePositions ?? []
      assert.deepEqual(masked, [weakIndex])
      assert.equal(new Set([...masked, ...visible]).size, wordLength)
      assert.equal(masked.some((index) => visible.includes(index)), false)
      assert.ok([...masked, ...visible].every(
        (index) => index >= 0 && index < wordLength,
      ))
    }
  }
})

function cleanAudioRecord(
  id: number,
  word: string,
  condition: ReturnType<typeof createBaselineExerciseCondition>,
): IWordRecord {
  return {
    id,
    word,
    timeStamp: id,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    exerciseCondition: condition,
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 500,
      attempts: [],
    },
    learningContext: {
      version: 1,
      pronunciationEnabledAtStart: true,
      pronunciationPlayed: true,
      pronunciationPlayCount: 1,
      pronunciationAutomaticPlayCount: 1,
      pronunciationRequestedPlayCount: 0,
    },
  }
}

test('formal/condition-safety: audio probe changes only the intended cue dimension', () => {
  for (const meaningVisible of [false, true]) {
    for (const phoneticVisible of [false, true]) {
      for (const allVisible of [false, true]) {
        const baseline = createBaselineExerciseCondition({
          pronunciationEnabled: true,
          meaningVisible,
          phoneticVisible,
          letterVisibility: Array(4).fill(allVisible),
        })
        const records = [1, 2, 3].map((id) =>
          cleanAudioRecord(id, 'test', baseline),
        )
        const shadow = chooseAudioWithdrawalShadow({
          baselineCondition: baseline,
          word: 'test',
          records,
        })

        assert.ok(shadow)
        assert.equal(shadow.condition.audio, 'none')
        assert.equal(shadow.condition.meaning, baseline.meaning)
        assert.equal(shadow.condition.phonetic, baseline.phonetic)
        assert.deepEqual(shadow.condition.letters, baseline.letters)
        assert.equal(shadow.condition.purpose, 'probe')
        assert.equal(shadow.condition.probeDimension, 'audio')
      }
    }
  }
})

test('formal/policy-arbitration: spelling remediation prevents simultaneous audio withdrawal', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: Array(6).fill(false),
  })

  const records: IWordRecord[] = [1, 2, 3].map((id) => ({
    ...cleanAudioRecord(id, 'planet', baseline),
    wrongCount: 1,
    mistakes: { 2: ['x'] },
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 500,
      attempts: [
        {
          startLatencyMs: 500,
          durationMs: 50,
          correctPrefixLength: 2,
          result: 'wrong',
          wrongIndex: 2,
          wrongKey: 'x',
        },
      ],
    },
  }))

  const shadow = chooseNextExerciseShadow({
    baselineCondition: baseline,
    word: 'planet',
    records,
  })

  assert.ok(shadow)
  assert.equal(shadow.condition.letters.mode, 'targeted-mask')
  assert.equal(shadow.condition.audio, 'automatic')
  assert.equal(shadow.condition.probeDimension, 'none')
})


test('formal/projection-safety: projected queue and cursor exactly implement every bounded decision', () => {
  let explored = 0

  for (let queueLength = 1; queueLength <= 5; queueLength += 1) {
    const queue = Array.from({ length: queueLength }, (_, index) => ({
      name: 'w' + index,
    }))

    for (let currentIndex = 0; currentIndex < queueLength; currentIndex += 1) {
      for (let loopWordTimes = 1; loopWordTimes <= 3; loopWordTimes += 1) {
        for (
          let currentExerciseCount = 0;
          currentExerciseCount < loopWordTimes;
          currentExerciseCount += 1
        ) {
          for (let wrongCount = 0; wrongCount <= 2; wrongCount += 1) {
            const decision = decideReviewProgress({
              queue,
              currentIndex,
              currentWord: queue[currentIndex],
              currentExerciseCount,
              loopWordTimes,
              priorAccumulatedWrongCount: 0,
              attemptWrongCount: wrongCount,
              currentReinforcementGap: MAX_REINFORCEMENT_GAP,
              attemptReinforcementGap: MIN_REINFORCEMENT_GAP,
            })
            const projection = projectReviewProgress({
              queue,
              currentIndex,
              decision,
            })
            explored += 1

            if (decision.kind === 'loop-current') {
              assert.equal(projection.index, currentIndex)
              assert.equal(projection.queue, queue)
              assert.equal(projection.isFinished, false)
            } else if (decision.kind === 'advance') {
              assert.equal(projection.index, currentIndex + 1)
              assert.equal(projection.isFinished, false)
              assert.equal(
                projection.queue.length,
                queue.length + (decision.insertWord ? 1 : 0),
              )
              assert.equal(
                projection.queue[projection.index].name,
                decision.insertWord?.index === projection.index
                  ? decision.insertWord.word.name
                  : queue[currentIndex + 1]?.name,
              )
            } else {
              assert.equal(currentIndex, queue.length - 1)
              assert.equal(projection.index, currentIndex)
              assert.equal(projection.queue, queue)
              assert.equal(projection.isFinished, true)
            }
          }
        }
      }
    }
  }

  assert.ok(explored > 100)
})


test('formal/admission-safety: due is a subset and force is the complete error set', () => {
  const now = 100
  const candidates = [
    { word: 'w0' },
    { word: 'w1' },
    { word: 'w2' },
  ]

  for (let mask = 0; mask < 8; mask += 1) {
    const states = candidates.map((candidate, index) => {
      const state = createInitialReviewWordState('cet4', candidate.word, 1)
      state.nextReviewAt =
        (mask & (1 << index)) !== 0 ? now : now + 1
      return state
    })

    const due = selectReviewCandidates(candidates, states, now, 'due')
    const forced = selectReviewCandidates(
      candidates,
      states,
      now,
      'force',
    )

    assert.deepEqual(
      due.map((candidate) => candidate.word),
      candidates
        .filter((_, index) => (mask & (1 << index)) !== 0)
        .map((candidate) => candidate.word),
    )
    assert.deepEqual(forced, candidates)
    assert.ok(due.every((candidate) => forced.includes(candidate)))
  }
})

test('formal/learning-reactivation: Typing is neutral and only explicit Learn training can pull a future state due-now', () => {
  const now = 1_000
  const timingCases = [
    { learningTime: 100, learningId: 1, reviewTime: 200, reviewId: 2, fresh: false },
    { learningTime: 300, learningId: 2, reviewTime: 200, reviewId: 1, fresh: true },
    { learningTime: 200, learningId: 1, reviewTime: 200, reviewId: 2, fresh: false },
    { learningTime: 200, learningId: 2, reviewTime: 200, reviewId: 1, fresh: true },
  ]

  for (const sourceMode of ['typing', 'learn'] as const) {
    for (const item of timingCases) {
      const records: IWordRecord[] = [
        {
          id: item.learningId,
          word: 'reactivate',
          timeStamp: item.learningTime,
          dict: 'cet4',
          chapter: 1,
          timing: [],
          wrongCount: 1,
          mistakes: { 0: ['x'] },
          sourceMode,
        },
        {
          id: item.reviewId,
          word: 'reactivate',
          timeStamp: item.reviewTime,
          dict: 'cet4',
          chapter: -1,
          timing: [],
          wrongCount: 0,
          mistakes: {},
          sourceMode: 'learn',
          learnItemKind: 'review',
        },
      ]
      const state = createInitialReviewWordState(
        'cet4',
        'reactivate',
        1,
      )
      state.reviewCount = 3
      state.lastReviewedAt = item.reviewTime
      state.nextReviewAt = now + 10_000
      state.schedulerState = {
        kind: 'basic-v1',
        stage: 2,
        intervalDays: 7,
      }

      const expected = sourceMode === 'learn' && item.fresh

      assert.equal(
        hasUnreviewedLearningFailure(records),
        expected,
      )

      const refreshed = reactivateReviewStateFromLearningEvidence(
        state,
        records,
        now,
      )

      assert.equal(
        refreshed.nextReviewAt,
        expected ? now : state.nextReviewAt,
      )
      assert.equal(refreshed.reviewCount, state.reviewCount)
      assert.deepEqual(
        refreshed.schedulerState,
        state.schedulerState,
      )
    }
  }
})


test('formal/basic-v2-migration: v1 upgrade preserves non-scheduler state for bounded legacy stages', () => {
  const legacyIntervals = [1, 3, 7, 14, 30]

  for (let stage = 0; stage < legacyIntervals.length; stage += 1) {
    const state = createInitialReviewWordState(
      'cet4',
      'legacy-' + stage,
      10,
    )
    state.updatedAt = 20
    state.lastReviewedAt = 15
    state.nextReviewAt = 100_000 + stage
    state.reviewCount = stage + 1
    state.lapseCount = stage
    state.cleanStreak = stage + 2
    state.lifecycle = stage % 2 === 0 ? 'active' : 'excluded'
    if (state.lifecycle === 'excluded') {
      state.exclusion = {
        reason: 'manual',
        excludedAt: 19,
      }
    }
    state.schedulerState = {
      kind: 'basic-v1',
      stage,
      intervalDays: legacyIntervals[stage],
    }

    const upgraded = upgradeBasicSchedulerState(state)

    assert.equal(upgraded.updatedAt, state.updatedAt)
    assert.equal(upgraded.lastReviewedAt, state.lastReviewedAt)
    assert.equal(upgraded.nextReviewAt, state.nextReviewAt)
    assert.equal(upgraded.reviewCount, state.reviewCount)
    assert.equal(upgraded.lapseCount, state.lapseCount)
    assert.equal(upgraded.cleanStreak, state.cleanStreak)
    assert.equal(upgraded.lifecycle, state.lifecycle)
    assert.deepEqual(upgraded.exclusion, state.exclusion)
    assert.equal(upgraded.schedulerState.kind, 'basic-v2')
    assert.equal(upgraded.schedulerState.stage, stage)
    assert.equal(
      upgraded.schedulerState.intervalDays,
      legacyIntervals[stage],
    )
  }
})

test('formal/basic-v2-scheduler: all ratings stay inside the finite interval ladder', () => {
  const outcomes = ['again', 'hard', 'good', 'easy'] as const

  for (
    let stage = 0;
    stage < basicV2ReviewIntervalsDays.length;
    stage += 1
  ) {
    for (const outcome of outcomes) {
      for (const due of [false, true]) {
        const now = 1_000_000
        const state = createInitialReviewWordState(
          'cet4',
          `stage-${stage}-${outcome}-${due}`,
          1,
        )
        state.reviewCount = 5
        state.lastReviewedAt = now - 86_400
        state.nextReviewAt = due ? now : now + 86_400
        state.schedulerState = {
          kind: 'basic-v2',
          stage,
          intervalDays: basicV2ReviewIntervalsDays[stage],
        }

        const next = scheduleBasicReview({
          state,
          outcome,
          now,
        })

        assert.equal(next.schedulerState.kind, 'basic-v2')
        if (next.schedulerState.kind !== 'basic-v2') continue
        assert.ok(next.schedulerState.stage >= 0)
        assert.ok(
          next.schedulerState.stage < basicV2ReviewIntervalsDays.length,
        )
        assert.ok(
          basicV2ReviewIntervalsDays.some(
            (days) => days === next.schedulerState.intervalDays,
          ),
        )
      }
    }
  }
})

test('formal/progress-liveness: persistent failures terminate with bounded reinforcement', () => {
  for (let queueLength = 1; queueLength <= 6; queueLength += 1) {
    for (let loopWordTimes = 1; loopWordTimes <= 3; loopWordTimes += 1) {
      let state: ModelState = {
        queue: Array.from({ length: queueLength }, (_, index) => ({
          name: 'persist-' + index,
        })),
        index: 0,
        exerciseCount: 0,
        accumulatedWrong: 0,
        gap: MAX_REINFORCEMENT_GAP,
        reinforcementCounts: {},
        finished: false,
      }

      const maxQueueLength =
        queueLength * (1 + MAX_REINFORCEMENT_PER_WORD_PER_SESSION)
      const bound = maxQueueLength * loopWordTimes + 2

      for (let step = 0; step < bound && !state.finished; step += 1) {
        state = applyModelCompletion(state, {
          wrongCount: 2,
          loopWordTimes,
          attemptGap: MIN_REINFORCEMENT_GAP,
        })
        assert.ok(
          state.queue.length <= maxQueueLength,
          'reinforcement queue exceeded the proven finite bound',
        )
      }

      assert.equal(
        state.finished,
        true,
        'persistent failure must still terminate the current Review session',
      )

      for (const count of Object.values(state.reinforcementCounts)) {
        assert.ok(count <= MAX_REINFORCEMENT_PER_WORD_PER_SESSION)
      }
    }
  }
})

function canonicalCondition() {
  return {
    version: 1 as const,
    purpose: 'probe' as const,
    source: 'adaptive-policy' as const,
    audio: 'none' as const,
    meaning: 'visible' as const,
    phonetic: 'hidden' as const,
    letters: { mode: 'all-hidden' as const },
    probeDimension: 'none' as const,
  }
}

function ratingFixture(input: {
  purpose?: 'training' | 'probe'
  probeDimension?: 'none' | 'audio' | 'orthography' | 'meaning'
  letters?: 'all-visible' | 'all-hidden' | 'partial' | 'targeted-mask'
  audio?: 'none' | 'automatic'
  meaning?: 'hidden' | 'visible'
  role?: 'cold' | 'training' | 'reinforcement'
  cause?: 'clean' | 'recall' | 'spelling' | 'motor' | 'uncertain'
  attentionUncertain?: boolean
  memoryGrade?: 'again' | 'hard' | 'good' | 'easy'
  retrievalValidity?: 'independent' | 'assisted' | 'uncertain' | 'unknown'
  reasonCodes?: string[]
} = {}) {
  const condition = {
    ...canonicalCondition(),
    purpose: input.purpose ?? 'probe',
    probeDimension: input.probeDimension ?? 'none',
    audio: input.audio ?? 'none',
    meaning: input.meaning ?? 'visible',
    letters: { mode: input.letters ?? 'all-hidden' },
  }
  const classification = {
    cause: input.cause ?? 'clean',
    confidence: 0.9,
    attentionUncertain: input.attentionUncertain || undefined,
    scores: { recall: 0.1, spelling: 0.1, motor: 0.1 },
  }
  const evidence = {
    version: 1 as const,
    memoryGrade: input.memoryGrade ?? 'good',
    errorCause: classification.cause,
    confidence: 0.9,
    evidenceStrength: 0.9,
    retrievalValidity: input.retrievalValidity ?? 'independent',
    reasonCodes: input.reasonCodes ?? [],
  }

  return decideReviewRating({
    attemptRole: input.role ?? 'cold',
    condition,
    classification,
    evidence,
  })
}

test('formal/rating-totality: bounded condition space always returns one deterministic decision', () => {
  let explored = 0

  for (const purpose of ['training', 'probe'] as const) {
    for (const probeDimension of ['none', 'audio', 'orthography', 'meaning'] as const) {
      for (const letters of ['all-visible', 'all-hidden', 'partial', 'targeted-mask'] as const) {
        for (const audio of ['none', 'automatic'] as const) {
          for (const meaning of ['hidden', 'visible'] as const) {
            for (const role of ['cold', 'training', 'reinforcement'] as const) {
              for (const cause of ['clean', 'recall', 'spelling', 'motor', 'uncertain'] as const) {
                for (const attentionUncertain of [false, true]) {
                  const input = {
                    purpose,
                    probeDimension,
                    letters,
                    audio,
                    meaning,
                    role,
                    cause,
                    attentionUncertain,
                    memoryGrade: cause === 'clean' ? 'easy' as const : 'hard' as const,
                  }
                  const first = ratingFixture(input)
                  const second = ratingFixture(input)
                  assert.deepEqual(first, second)
                  assert.equal(first.rating === null, !first.eligible)
                  explored += 1

                  if (purpose === 'training') {
                    assert.equal(first.rating, null)
                  }
                  if (role !== 'cold') {
                    assert.equal(first.rating, null)
                  }
                  if (probeDimension !== 'none') {
                    assert.equal(first.rating, null)
                  }
                  if (letters !== 'all-hidden') {
                    assert.equal(first.rating, null)
                  }
                  if (audio !== 'none') {
                    assert.equal(first.rating, null)
                  }
                  if (meaning !== 'visible') {
                    assert.equal(first.rating, null)
                  }
                  if (attentionUncertain) {
                    assert.equal(first.rating, null)
                  }
                  if (first.eligible && cause === 'motor') {
                    assert.equal(first.rating, 'good')
                  }
                  if (first.rating === 'easy') {
                    assert.equal(cause, 'clean')
                    assert.equal(purpose, 'probe')
                    assert.equal(probeDimension, 'none')
                    assert.equal(letters, 'all-hidden')
                    assert.equal(audio, 'none')
                    assert.equal(meaning, 'visible')
                    assert.equal(role, 'cold')
                    assert.equal(attentionUncertain, false)
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  assert.equal(explored, 3840)
})

test('formal/rating-safety: reveal, assistance and diagnostic evidence never rate', () => {
  assert.equal(
    ratingFixture({ reasonCodes: ['answer-revealed-before-first-key'] }).rating,
    null,
  )
  assert.equal(
    ratingFixture({ retrievalValidity: 'uncertain' }).rating,
    null,
  )
  assert.equal(
    ratingFixture({ probeDimension: 'audio' }).rating,
    null,
  )
  assert.equal(
    ratingFixture({ role: 'reinforcement' }).rating,
    null,
  )
})

function eligibleDecision(rating: 'again' | 'hard' | 'good' | 'easy'): RatingDecision {
  return {
    eligible: true,
    rating,
    confidence: 0.9,
    reasonCodes: ['formal-fixture'],
  }
}

function nullDecision(
  reason:
    | 'training-event'
    | 'non-cold-attempt'
    | 'diagnostic-probe'
    | 'attention-uncertain'
    | 'answer-revealed'
    | 'orthographic-cue-not-hidden'
    | 'audio-assisted'
    | 'meaning-not-visible',
): RatingDecision {
  return {
    eligible: false,
    rating: null,
    reason,
    reasonCodes: [reason],
  }
}

function legalEvents(state: ReviewItemMachineState): ReviewItemEvent[] {
  if (state.phase === 'cold-probe' || state.phase === 'invalid-retry') {
    return [
      { kind: 'probe-result', decision: eligibleDecision('again'), needsTraining: true },
      { kind: 'probe-result', decision: eligibleDecision('hard'), needsTraining: true },
      { kind: 'probe-result', decision: eligibleDecision('good'), needsTraining: false },
      { kind: 'probe-result', decision: eligibleDecision('easy'), needsTraining: false },
      { kind: 'probe-result', decision: nullDecision('attention-uncertain'), needsTraining: false },
      { kind: 'probe-result', decision: nullDecision('answer-revealed'), needsTraining: false },
      { kind: 'probe-result', decision: nullDecision('diagnostic-probe'), needsTraining: false },
      { kind: 'probe-result', decision: nullDecision('training-event'), needsTraining: false },
    ]
  }

  if (state.phase === 'training') {
    return [
      { kind: 'training-complete', requestReinforcement: false },
      { kind: 'training-complete', requestReinforcement: true },
    ]
  }

  if (state.phase === 'reinforcement') {
    return [{ kind: 'reinforcement-complete' }]
  }

  return []
}

test('formal/item-liveness: every legal item transition strictly decreases the termination variant', () => {
  const visit = (state: ReviewItemMachineState, depth: number) => {
    assert.ok(depth <= 5, 'finite Review item exceeded the transition bound')

    if (isTerminalReviewItemState(state)) return

    const before = reviewItemTerminationVariant(state)
    const events = legalEvents(state)
    assert.ok(events.length > 0)

    for (const event of events) {
      const next = decideReviewItemTransition(state, event)
      const after = reviewItemTerminationVariant(next)
      assert.ok(
        after < before,
        `termination variant failed to decrease: ${before} -> ${after}`,
      )
      visit(next, depth + 1)
    }
  }

  const initial = createReviewItemMachineState()
  assert.equal(initial.invalidRetryRemaining, MAX_INVALID_RETRY_PER_ITEM)
  assert.equal(
    initial.reinforcementRemaining,
    MAX_REINFORCEMENT_PER_WORD_PER_SESSION,
  )
  visit(initial, 0)
})

test('formal/item-liveness: repeated null ratings defer instead of livelocking', () => {
  let state = createReviewItemMachineState()

  state = decideReviewItemTransition(state, {
    kind: 'probe-result',
    decision: nullDecision('attention-uncertain'),
    needsTraining: false,
  })
  assert.equal(state.phase, 'invalid-retry')
  assert.equal(state.invalidRetryRemaining, 0)

  state = decideReviewItemTransition(state, {
    kind: 'probe-result',
    decision: nullDecision('attention-uncertain'),
    needsTraining: false,
  })
  assert.equal(state.phase, 'deferred')
  assert.equal(isTerminalReviewItemState(state), true)
})

test('formal/item-safety: one rated failure can create at most one reinforcement then terminates', () => {
  let state = createReviewItemMachineState()

  state = decideReviewItemTransition(state, {
    kind: 'probe-result',
    decision: eligibleDecision('again'),
    needsTraining: true,
  })
  assert.equal(state.phase, 'training')
  assert.equal(state.ratingEmitted, true)

  state = decideReviewItemTransition(state, {
    kind: 'training-complete',
    requestReinforcement: true,
  })
  assert.equal(state.phase, 'reinforcement')
  assert.equal(state.reinforcementRemaining, 0)

  state = decideReviewItemTransition(state, {
    kind: 'reinforcement-complete',
  })
  assert.equal(state.phase, 'done')
  assert.equal(state.ratingEmitted, true)
})


test('formal/canonical-probe: session cold probe is invariant to ordinary UI presentation', async () => {
  const { createCanonicalReviewProbePlan } = await import('../../src/review/decision')
  const { resolveExercisePlanForAttempt } = await import('../../src/review/exercise-policy')
  const { createBaselineExerciseCondition } = await import('../../src/review/condition')

  let explored = 0
  for (const pronunciationEnabled of [false, true]) {
    for (const meaningVisible of [false, true]) {
      for (const phoneticVisible of [false, true]) {
        for (const letterVisible of [false, true]) {
          const baseline = createBaselineExerciseCondition({
            pronunciationEnabled,
            meaningVisible,
            phoneticVisible,
            letterVisibility: Array(6).fill(letterVisible),
          })
          const active = resolveExercisePlanForAttempt(
            baseline,
            createCanonicalReviewProbePlan(),
          )
          explored += 1

          assert.equal(active.condition.purpose, 'probe')
          assert.equal(active.condition.probeDimension, 'none')
          assert.equal(active.condition.source, 'adaptive-policy')
          assert.equal(active.condition.audio, 'none')
          assert.equal(active.condition.meaning, 'visible')
          assert.equal(active.condition.phonetic, 'hidden')
          assert.equal(active.condition.letters.mode, 'all-hidden')
        }
      }
    }
  }

  assert.equal(explored, 16)
})

test('formal/rating-safety: assisted retrieval can never reach the scheduler', () => {
  const assisted = ratingFixture({
    retrievalValidity: 'assisted',
    reasonCodes: ['requested-audio-cue'],
  })
  assert.equal(assisted.eligible, false)
  assert.equal(assisted.rating, null)
  if (!assisted.eligible) {
    assert.equal(assisted.reason, 'assisted-retrieval')
  }
})


test('formal/hint-liveness: the hint ladder is acyclic and bounded by four escalations', async () => {
  const {
    applyReviewHintDecision,
    createReviewHintMachineState,
    decideReviewHintInput,
    reviewHintTerminationVariant,
  } = await import('../../src/review/hint')

  const visit = (
    state: ReturnType<typeof createReviewHintMachineState>,
    depth: number,
  ) => {
    assert.ok(depth <= 4, 'hint ladder exceeded four escalations')

    for (const inputIndex of [0, 1, 4]) {
      for (const key of ['Escape', ' ', 'a']) {
        const decision = decideReviewHintInput({
          state,
          inputIndex,
          key,
        })

        const shouldAdvance =
          key === 'Escape' &&
          state.stage !== 'hint-3'

        assert.equal(decision.kind === 'advance-hint', shouldAdvance)

        if (decision.kind === 'advance-hint') {
          const next = applyReviewHintDecision(state, decision)
          assert.ok(
            reviewHintTerminationVariant(next) <
              reviewHintTerminationVariant(state),
          )
          visit(next, depth + 1)
        }
      }
    }
  }

  visit(createReviewHintMachineState(), 0)
})

test('formal/hint-presentation: cue levels are monotone and Hint 3 is full mandatory copy', async () => {
  const { createReviewHintPlan } = await import('../../src/review/hint')

  for (let wordLength = 1; wordLength <= 20; wordLength += 1) {
    const plans = [0, 1, 2, 3].map((level) =>
      createReviewHintPlan(level as 0 | 1 | 2 | 3, wordLength),
    )

    const visibleCount = (level: number) => {
      const letters = plans[level].condition.letters
      if (letters.mode === 'all-visible') return wordLength
      if (letters.mode === 'all-hidden') return 0
      return letters.visiblePositions?.length ?? 0
    }

    assert.ok(visibleCount(0) >= 1)
    assert.equal(visibleCount(1), visibleCount(0))
    assert.ok(visibleCount(2) >= visibleCount(1))
    assert.equal(visibleCount(3), wordLength)

    assert.equal(plans[0].condition.audio, 'none')
    assert.equal(plans[0].condition.phonetic, 'hidden')

    for (const level of [1, 2, 3]) {
      assert.equal(plans[level].condition.audio, 'automatic')
      assert.equal(plans[level].condition.phonetic, 'visible')
      assert.equal(plans[level].condition.purpose, 'training')
    }

    assert.equal(plans[3].condition.letters.mode, 'all-visible')
  }
})

test('formal/hint-rating: explicit cold surrender dominates assisted final completion as Again', async () => {
  const { createReviewHintPlan } = await import('../../src/review/hint')
  const { decideReviewRating } = await import('../../src/review/state-machine')

  const decision = decideReviewRating({
    attemptRole: 'cold',
    condition: createReviewHintPlan(3, 6).condition,
    classification: {
      cause: 'clean',
      confidence: 0.95,
      scores: { recall: 0, spelling: 0, motor: 0 },
    },
    evidence: {
      version: 1,
      memoryGrade: 'again',
      errorCause: 'recall',
      confidence: 1,
      evidenceStrength: 1,
      retrievalValidity: 'independent',
      reasonCodes: [
        'cold-probe-surrendered',
        'review-hint-3',
        'review-hint-advances-4',
      ],
    },
  })

  assert.equal(decision.eligible, true)
  assert.equal(decision.rating, 'again')
})


test('formal/learn-lifecycle: Typing is lifecycle-neutral and exclude/restore are deterministic', async () => {
  const {
    decideLearningLifecycleTransition,
    getLearningLifecycle,
  } = await import('../../src/learn/lifecycle')
  const { createInitialReviewWordState } = await import('../../src/review/types')

  for (let reviewCount = 0; reviewCount <= 3; reviewCount += 1) {
    for (let lapseCount = 0; lapseCount <= 3; lapseCount += 1) {
      const active = {
        ...createInitialReviewWordState('cet4', 'word', 100),
        reviewCount,
        lapseCount,
        nextReviewAt: 999,
      }

      const typing = decideLearningLifecycleTransition(active, {
        kind: 'typing-observation',
      })
      assert.equal(typing, active)
      assert.equal(getLearningLifecycle(typing), 'active')

      const excluded = decideLearningLifecycleTransition(active, {
        kind: 'exclude',
        now: 200,
      })
      assert.equal(getLearningLifecycle(excluded), 'excluded')
      assert.equal(excluded.reviewCount, reviewCount)
      assert.equal(excluded.lapseCount, lapseCount)
      assert.equal(excluded.nextReviewAt, 999)

      const typingWhileExcluded = decideLearningLifecycleTransition(excluded, {
        kind: 'typing-observation',
      })
      assert.equal(typingWhileExcluded, excluded)
      assert.equal(getLearningLifecycle(typingWhileExcluded), 'excluded')

      const restored = decideLearningLifecycleTransition(excluded, {
        kind: 'restore',
        now: 300,
      })
      assert.equal(getLearningLifecycle(restored), 'active')
      assert.equal(restored.nextReviewAt, 300)
      assert.equal(restored.reviewCount, reviewCount)
      assert.equal(restored.lapseCount, lapseCount)
    }
  }
})

test('formal/learn-queue: excluded words can never be selected, including force mode', async () => {
  const { decideLearningLifecycleTransition } = await import('../../src/learn/lifecycle')
  const { selectReviewCandidates } = await import('../../src/review/due')
  const { createInitialReviewWordState } = await import('../../src/review/types')

  for (let activeCount = 0; activeCount <= 4; activeCount += 1) {
    const candidates = Array.from({ length: 6 }, (_, index) => ({
      word: 'w' + index,
    }))
    const states = candidates.map((candidate, index) => {
      const base = {
        ...createInitialReviewWordState('cet4', candidate.word, 100),
        nextReviewAt: index % 2 === 0 ? 100 : 500,
      }
      return index < activeCount
        ? base
        : decideLearningLifecycleTransition(base, {
            kind: 'exclude',
            now: 150,
          })
    })

    for (const mode of ['due', 'force'] as const) {
      const selected = selectReviewCandidates(
        candidates,
        states,
        200,
        mode,
      )
      for (const item of selected) {
        const state = states.find((entry) => entry.word === item.word)
        assert.equal(state?.lifecycle === 'excluded', false)
      }
    }
  }
})

test('formal/learn-session-prune: removal is idempotent and never leaves the excluded word in queue', async () => {
  const { pruneLearnSessionWord } = await import('../../src/learn/lifecycle')

  const makeWord = (name: string) => ({
    name,
    trans: [],
    usphone: '',
    ukphone: '',
  })

  for (let length = 1; length <= 6; length += 1) {
    for (let index = 0; index < length; index += 1) {
      const words = Array.from({ length }, (_, position) =>
        makeWord(position % 2 === 0 ? 'x' : 'y'),
      )
      const record = {
        dict: 'cet4',
        index,
        createTime: 1,
        isFinished: false,
        words,
      }

      const once = pruneLearnSessionWord(record, 'x')
      const twice = pruneLearnSessionWord(once, 'x')
      assert.deepEqual(twice, once)
      assert.equal(
        once.words.some((word) => word.name === 'x'),
        false,
      )
      if (once.words.length === 0) {
        assert.equal(once.isFinished, true)
      } else {
        assert.ok(once.index >= 0)
        assert.ok(once.index < once.words.length)
      }
    }
  }
})


test('formal/learn-start-priority: due review always wins over new acquisition', async () => {
  const {
    decideLearnStartKind,
    selectUnseenLearningWords,
  } = await import('../../src/learn/session')
  const {
    createInitialReviewWordState,
  } = await import('../../src/review/types')

  for (let dueCount = 0; dueCount <= 5; dueCount += 1) {
    for (let unseenCount = 0; unseenCount <= 25; unseenCount += 1) {
      const decision = decideLearnStartKind({ dueCount, unseenCount })
      if (dueCount > 0) {
        assert.equal(decision, 'review')
      } else if (unseenCount > 0) {
        assert.equal(decision, 'acquisition')
      } else {
        assert.equal(decision, 'empty')
      }
    }
  }

  const words = Array.from({ length: 40 }, (_, index) => ({
    name: 'w' + index,
    trans: [],
    usphone: '',
    ukphone: '',
  }))
  const states = Array.from({ length: 7 }, (_, index) =>
    createInitialReviewWordState('cet4', 'w' + index, 1),
  )

  const selected = selectUnseenLearningWords(words, states, 20)
  assert.equal(selected.length, 20)
  assert.equal(selected[0].name, 'w7')
  assert.equal(new Set(selected.map((word) => word.name)).size, selected.length)
  assert.equal(
    selected.some((word) => states.some((state) => state.word === word.name)),
    false,
  )
})

test('formal/acquisition-safety: acquisition starts cold but remains scheduler-neutral', async () => {
  const {
    createLearnAcquisitionPlan,
  } = await import('../../src/learn/session')
  const {
    getReviewAttemptRole,
  } = await import('../../src/review/session')
  const plan = createLearnAcquisitionPlan()

  assert.equal(plan.condition.purpose, 'probe')
  assert.equal(plan.condition.probeDimension, 'none')
  assert.equal(plan.condition.letters.mode, 'all-hidden')
  assert.equal(plan.condition.meaning, 'visible')
  assert.equal(plan.condition.phonetic, 'hidden')
  assert.equal(plan.condition.audio, 'none')
  assert.equal(
    getReviewAttemptRole({
      sessionKind: 'acquisition',
      reinforcementUsed: 0,
    }),
    undefined,
  )
})


test('formal/hint-auto: every automatic escalation is bounded and acyclic', async () => {
  const {
    applyReviewHintDecision,
    createReviewHintMachineState,
    observeReviewHintWrong,
    reviewHintTerminationVariant,
  } = await import('../../src/review/hint')

  for (let wordLength = 1; wordLength <= 20; wordLength += 1) {
    for (let wrongIndex = 0; wrongIndex < wordLength; wrongIndex += 1) {
      let state = createReviewHintMachineState()

      const first = observeReviewHintWrong({
        state,
        wrongIndex,
        wordLength,
      })
      state = first.state
      assert.equal(first.decision, null)
      assert.equal(state.stage, 'cold-probe')

      const beforeCold = reviewHintTerminationVariant(state)
      const second = observeReviewHintWrong({
        state,
        wrongIndex,
        wordLength,
      })
      state = second.state
      assert.equal(second.decision?.kind, 'advance-hint')
      if (second.decision?.kind !== 'advance-hint') continue
      assert.equal(second.decision.level, 0)
      assert.equal(second.decision.trigger, 'repeated-wrong-position')
      state = applyReviewHintDecision(state, second.decision)
      assert.equal(state.stage, 'hint-0')
      assert.equal(state.stageWrongCount, 0)
      assert.ok(reviewHintTerminationVariant(state) < beforeCold)

      const expected = [
        { from: 'hint-0', to: 'hint-1', level: 1 },
        { from: 'hint-1', to: 'hint-2', level: 2 },
        { from: 'hint-2', to: 'hint-3', level: 3 },
      ] as const

      for (const edge of expected) {
        assert.equal(state.stage, edge.from)
        const before = reviewHintTerminationVariant(state)

        const wrongA = observeReviewHintWrong({
          state,
          wrongIndex,
          wordLength,
        })
        state = wrongA.state
        assert.equal(wrongA.decision, null)
        assert.equal(state.stageWrongCount, 1)

        const wrongB = observeReviewHintWrong({
          state,
          wrongIndex: (wrongIndex + 1) % wordLength,
          wordLength,
        })
        state = wrongB.state
        assert.equal(wrongB.decision?.kind, 'advance-hint')
        if (wrongB.decision?.kind !== 'advance-hint') break
        assert.equal(wrongB.decision.to, edge.to)
        assert.equal(wrongB.decision.level, edge.level)
        assert.equal(wrongB.decision.trigger, 'repeated-hint-errors')
        state = applyReviewHintDecision(state, wrongB.decision)
        assert.equal(state.stageWrongCount, 0)
        assert.ok(reviewHintTerminationVariant(state) < before)
      }

      assert.equal(state.stage, 'hint-3')
      const terminalVariant = reviewHintTerminationVariant(state)
      for (let repeat = 0; repeat < 4; repeat += 1) {
        const terminal = observeReviewHintWrong({
          state,
          wrongIndex,
          wordLength,
        })
        state = terminal.state
        assert.equal(terminal.decision, null)
        assert.equal(state.stage, 'hint-3')
        assert.equal(reviewHintTerminationVariant(state), terminalVariant)
      }
    }
  }
})

test('formal/completion-bridge: retry and reinforcement paths remain bounded', async () => {
  const {
    createReviewItemMachineState,
    resolveCompletedReviewItem,
    reviewItemTerminationVariant,
  } = await import('../../src/review/state-machine')

  const retryable = {
    eligible: false as const,
    rating: null,
    reason: 'attention-uncertain' as const,
    reasonCodes: ['attention-uncertain'],
  }

  let state = createReviewItemMachineState()
  const beforeRetry = reviewItemTerminationVariant(state)
  const retry = resolveCompletedReviewItem({
    state,
    attemptRole: 'cold',
    decision: retryable,
    requestReinforcement: false,
  })
  state = retry.state
  assert.equal(retry.kind, 'retry-canonical')
  assert.ok(reviewItemTerminationVariant(state) < beforeRetry)

  const beforeDefer = reviewItemTerminationVariant(state)
  const deferred = resolveCompletedReviewItem({
    state,
    attemptRole: 'cold',
    decision: retryable,
    requestReinforcement: false,
  })
  assert.equal(deferred.state.phase, 'deferred')
  assert.ok(reviewItemTerminationVariant(deferred.state) < beforeDefer)

  state = createReviewItemMachineState()
  const beforeRated = reviewItemTerminationVariant(state)
  const rated = resolveCompletedReviewItem({
    state,
    attemptRole: 'cold',
    decision: {
      eligible: true,
      rating: 'again',
      confidence: 1,
      reasonCodes: ['again'],
    },
    requestReinforcement: true,
  })
  assert.equal(rated.state.phase, 'reinforcement')
  assert.ok(reviewItemTerminationVariant(rated.state) < beforeRated)

  const beforeReinforcement = reviewItemTerminationVariant(rated.state)
  const done = resolveCompletedReviewItem({
    state: rated.state,
    attemptRole: 'reinforcement',
    decision: {
      eligible: false,
      rating: null,
      reason: 'non-cold-attempt',
      reasonCodes: ['non-cold-attempt'],
    },
    requestReinforcement: false,
  })
  assert.equal(done.state.phase, 'done')
  assert.ok(
    reviewItemTerminationVariant(done.state) < beforeReinforcement,
  )
})

test('formal/hint0-position: cue strength is monotone for every target position', async () => {
  const { createReviewHintPlan } = await import('../../src/review/hint')

  const visibleSet = (
    level: 0 | 1 | 2 | 3,
    wordLength: number,
    hintPosition: number,
  ) => {
    const letters = createReviewHintPlan(
      level,
      wordLength,
      hintPosition,
    ).condition.letters

    if (letters.mode === 'all-visible') {
      return new Set(
        Array.from({ length: wordLength }, (_, index) => index),
      )
    }
    if (letters.mode === 'all-hidden') return new Set<number>()
    return new Set(letters.visiblePositions ?? [])
  }

  for (let wordLength = 1; wordLength <= 20; wordLength += 1) {
    for (let hintPosition = 0; hintPosition < wordLength; hintPosition += 1) {
      const h0 = visibleSet(0, wordLength, hintPosition)
      const h1 = visibleSet(1, wordLength, hintPosition)
      const h2 = visibleSet(2, wordLength, hintPosition)
      const h3 = visibleSet(3, wordLength, hintPosition)

      assert.deepEqual([...h0], [hintPosition])
      assert.deepEqual([...h1], [hintPosition])
      assert.ok([...h0].every((index) => h1.has(index)))
      assert.ok([...h1].every((index) => h2.has(index)))
      assert.ok([...h2].every((index) => h3.has(index)))
      assert.equal(h3.size, wordLength)
    }
  }
})


test('formal/learn-name-canonicalization: bounded duplicate dictionaries produce one stable item per exact name', () => {
  const names = ['a', 'b', 'c']
  let explored = 0

  for (let length = 0; length <= 5; length += 1) {
    const total = names.length ** length
    for (let code = 0; code < total; code += 1) {
      let value = code
      const words = Array.from({ length }, (_, index) => {
        const name = names[value % names.length]
        value = Math.floor(value / names.length)
        return {
          name,
          trans: ['meaning-' + index],
          usphone: '',
          ukphone: '',
        }
      })

      const canonical = canonicalizeLearningWords(words)
      const canonicalNames = canonical.map((word) => word.name)
      const expectedNames = [...new Set(words.map((word) => word.name))]

      assert.deepEqual(canonicalNames, expectedNames)
      assert.equal(new Set(canonicalNames).size, canonicalNames.length)
      assert.deepEqual(
        canonicalizeLearningWords(canonical),
        canonical,
      )
      explored += 1
    }
  }

  assert.ok(explored > 300)
})


test('formal/dictionary-example-range: only bounded non-empty slices are eligible', async () => {
  const { getFirstValidDictionaryExample, maskDictionaryExample } =
    await import('../../src/utils/dictionaryExample')

  const en = 'abcdef'
  let explored = 0

  for (let start = -1; start <= en.length + 1; start += 1) {
    for (let end = -1; end <= en.length + 1; end += 1) {
      const word = {
        name: 'target',
        trans: [],
        usphone: '',
        ukphone: '',
        example: [
          {
            en,
            cn: 'fixture',
            start,
            end,
          },
        ],
      }

      const example = getFirstValidDictionaryExample(word)
      const valid =
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end > start &&
        end <= en.length

      assert.equal(example !== undefined, valid)

      if (example) {
        const parts = maskDictionaryExample(example)
        assert.equal(
          parts.before + parts.surface + parts.after,
          en,
        )
        assert.equal(parts.surface, en.slice(start, end))
        assert.ok(parts.masked.length >= 3)
      }
      explored += 1
    }
  }

  assert.ok(explored > 50)
})
