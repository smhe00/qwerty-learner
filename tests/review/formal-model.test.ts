import assert from 'node:assert/strict'
import test from 'node:test'
import { createBaselineExerciseCondition } from '../../src/review/condition'
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
import type { OrthographyProfile } from '../../src/review/profile'
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
  if (decision.insertWord) {
    queue.splice(
      decision.insertWord.index,
      0,
      decision.insertWord.word,
    )
  }

  return {
    queue,
    index: decision.nextIndex,
    exerciseCount: 0,
    accumulatedWrong: 0,
    gap: MAX_REINFORCEMENT_GAP,
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
