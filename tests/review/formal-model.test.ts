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

test('formal/learning-reactivation: only fresh learning after latest Review pulls a future state due-now', () => {
  const now = 1_000
  const cases = [
    { learningTime: 100, learningId: 1, reviewTime: 200, reviewId: 2, expected: false },
    { learningTime: 300, learningId: 2, reviewTime: 200, reviewId: 1, expected: true },
    { learningTime: 200, learningId: 1, reviewTime: 200, reviewId: 2, expected: false },
    { learningTime: 200, learningId: 2, reviewTime: 200, reviewId: 1, expected: true },
  ]

  for (const item of cases) {
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
      },
    ]
    const state = createInitialReviewWordState('cet4', 'reactivate', 1)
    state.reviewCount = 3
    state.lastReviewedAt = item.reviewTime
    state.nextReviewAt = now + 10_000
    state.schedulerState = {
      kind: 'basic-v1',
      stage: 2,
      intervalDays: 7,
    }

    assert.equal(hasUnreviewedLearningFailure(records), item.expected)

    const refreshed = reactivateReviewStateFromLearningEvidence(
      state,
      records,
      now,
    )

    assert.equal(
      refreshed.nextReviewAt,
      item.expected ? now : state.nextReviewAt,
    )
    assert.equal(refreshed.reviewCount, state.reviewCount)
    assert.deepEqual(refreshed.schedulerState, state.schedulerState)
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
