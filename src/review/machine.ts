import { scheduleReinforcement } from './session'
import type { NamedReviewItem } from './session'

export const REVIEW_MACHINE_VERSION = 2 as const

export type WordInputDecision =
  | { accept: false; reason: 'wrong-lock' | 'finished' | 'empty-target' | 'target-complete' }
  | { accept: true; index: number; isFinal: boolean }

export function decideWordInput(input: {
  inputLength: number
  targetLength: number
  hasWrong: boolean
  isFinished: boolean
}): WordInputDecision {
  if (input.hasWrong) return { accept: false, reason: 'wrong-lock' }
  if (input.isFinished) return { accept: false, reason: 'finished' }
  if (input.targetLength <= 0) return { accept: false, reason: 'empty-target' }
  if (input.inputLength >= input.targetLength) {
    return { accept: false, reason: 'target-complete' }
  }

  return {
    accept: true,
    index: input.inputLength,
    isFinal: input.inputLength === input.targetLength - 1,
  }
}

export function shouldPlayAutomaticPronunciation(input: {
  isTyping: boolean
  inputLength: number
  automaticAudioEnabled: boolean
  alreadyPlayedForAttempt: boolean
}): boolean {
  return (
    input.isTyping &&
    input.inputLength === 0 &&
    input.automaticAudioEnabled &&
    !input.alreadyPlayedForAttempt
  )
}

export type ReviewProgressDecision<T extends NamedReviewItem> =
  | {
      kind: 'loop-current'
      nextExerciseCount: number
      nextAccumulatedWrongCount: number
      nextReinforcementGap: number
    }
  | {
      kind: 'advance'
      nextIndex: number
      insertWord?: {
        index: number
        word: T
      }
    }
  | {
      kind: 'finish'
    }

export function decideReviewProgress<T extends NamedReviewItem>(input: {
  queue: T[]
  currentIndex: number
  currentWord: T
  currentExerciseCount: number
  loopWordTimes: number
  priorAccumulatedWrongCount: number
  attemptWrongCount: number
  currentReinforcementGap: number
  attemptReinforcementGap: number
  reinforcementRemaining?: number
}): ReviewProgressDecision<T> {
  if (input.queue.length === 0) {
    throw new Error('review queue must not be empty')
  }
  if (input.currentIndex < 0 || input.currentIndex >= input.queue.length) {
    throw new Error('review currentIndex out of range')
  }
  if (input.queue[input.currentIndex]?.name !== input.currentWord.name) {
    throw new Error('review currentWord must match queue[currentIndex]')
  }
  if (input.loopWordTimes < 1) {
    throw new Error('loopWordTimes must be at least 1')
  }
  if (
    input.currentExerciseCount < 0 ||
    input.currentExerciseCount >= input.loopWordTimes
  ) {
    throw new Error('currentExerciseCount out of range')
  }

  const accumulatedWrongCount =
    input.priorAccumulatedWrongCount + input.attemptWrongCount
  const reinforcementGap = Math.min(
    input.currentReinforcementGap,
    input.attemptReinforcementGap,
  )

  if (input.currentExerciseCount < input.loopWordTimes - 1) {
    return {
      kind: 'loop-current',
      nextExerciseCount: input.currentExerciseCount + 1,
      nextAccumulatedWrongCount: accumulatedWrongCount,
      nextReinforcementGap: reinforcementGap,
    }
  }

  const reinforcementRemaining = Math.max(
    0,
    input.reinforcementRemaining ?? 1,
  )

  let insertWord: { index: number; word: T } | undefined
  if (accumulatedWrongCount > 0 && reinforcementRemaining > 0) {
    const reinforcement = scheduleReinforcement(
      input.queue,
      input.currentIndex,
      input.currentWord,
      reinforcementGap,
    )
    if (reinforcement.insertedAt !== null) {
      insertWord = {
        index: reinforcement.insertedAt,
        word: input.currentWord,
      }
    }
  }

  const hasNextWord = input.currentIndex < input.queue.length - 1
  if (hasNextWord || insertWord) {
    return {
      kind: 'advance',
      nextIndex: input.currentIndex + 1,
      insertWord,
    }
  }

  return { kind: 'finish' }
}

export type ReviewProgressProjection<T extends NamedReviewItem> = {
  queue: T[]
  index: number
  isFinished: boolean
}

export function projectReviewProgress<T extends NamedReviewItem>(input: {
  queue: T[]
  currentIndex: number
  decision: ReviewProgressDecision<T>
}): ReviewProgressProjection<T> {
  const { queue, currentIndex, decision } = input

  if (currentIndex < 0 || currentIndex >= queue.length) {
    throw new Error('review projection currentIndex out of range')
  }

  if (decision.kind === 'loop-current') {
    return {
      queue,
      index: currentIndex,
      isFinished: false,
    }
  }

  if (decision.kind === 'finish') {
    if (currentIndex !== queue.length - 1) {
      throw new Error('review finish projection requires final queue item')
    }
    return {
      queue,
      index: currentIndex,
      isFinished: true,
    }
  }

  const nextQueue = [...queue]
  if (decision.insertWord) {
    if (
      decision.insertWord.index <= currentIndex ||
      decision.insertWord.index > nextQueue.length
    ) {
      throw new Error('review reinforcement insertion out of range')
    }
    nextQueue.splice(decision.insertWord.index, 0, decision.insertWord.word)
  }

  if (decision.nextIndex !== currentIndex + 1) {
    throw new Error('review advance projection must move exactly one item')
  }
  if (decision.nextIndex < 0 || decision.nextIndex >= nextQueue.length) {
    throw new Error('review advance projection nextIndex out of range')
  }

  return {
    queue: nextQueue,
    index: decision.nextIndex,
    isFinished: false,
  }
}
