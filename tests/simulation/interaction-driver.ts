import {
  createLearnAcquisitionState,
  type LearnAcquisitionState,
} from '../../src/learn/acquisition'
import { resolveLearnAcquisitionCompletion } from '../../src/learn/progression'
import type { Word } from '../../src/typings'
import type { LearnSystemTraceEvent } from './system-oracle'

export type AcquisitionDriverMutation = {
  stallInteraction?: number
}

export type AcquisitionDriverResult = {
  events: LearnSystemTraceEvent[]
  queue: Word[]
  index: number
  acquisitionStates: Record<string, LearnAcquisitionState>
  finished: boolean
  interactions: number
}

function queueSignature(queue: Word[]): string {
  return queue.map((word) => word.name).join('|')
}

function acquisitionStateSignature(
  state: LearnAcquisitionState | undefined,
): string {
  if (!state) return 'missing'
  return [
    state.phase,
    state.assistedCycles,
    state.independentInterveningItems ?? -1,
    state.deferredReason ?? 'none',
    state.resumeAfter ?? -1,
  ].join(':')
}

/**
 * Event-level Virtual User for Acquisition.
 *
 * It drives the production progression controller one completed word at a time.
 * The learner is intentionally deterministic and clean; persona/noise belongs
 * to the higher longitudinal layer.
 */
export function runAcquisitionInteractionDriver(input: {
  words: Word[]
  now: number
  mutation?: AcquisitionDriverMutation
  maxInteractions?: number
}): AcquisitionDriverResult {
  let queue = [...input.words]
  let index = 0
  let acquisitionStates = Object.fromEntries(
    input.words.map((word) => [
      word.name,
      createLearnAcquisitionState(),
    ]),
  )
  const events: LearnSystemTraceEvent[] = []
  const maxInteractions = input.maxInteractions ?? 100
  let finished = queue.length === 0
  let interactions = 0

  while (!finished && interactions < maxInteractions) {
    const currentWord = queue[index]
    if (!currentWord) break

    const currentState =
      acquisitionStates[currentWord.name] ??
      createLearnAcquisitionState()
    const beforeIndex = index
    const beforeQueueSignature = queueSignature(queue)
    const beforeItemStateSignature =
      acquisitionStateSignature(currentState)

    const resolution = resolveLearnAcquisitionCompletion({
      queue,
      currentIndex: index,
      currentWord,
      state: currentState,
      acquisitionStates,
      wrongCount: 0,
      classificationCause: 'clean',
      retrievalValidity: 'independent',
      now: input.now + interactions * 10,
    })

    acquisitionStates = resolution.acquisitionStates

    const shouldStall =
      input.mutation?.stallInteraction === interactions

    if (!shouldStall) {
      queue = resolution.projection.queue
      index = resolution.projection.index
      finished = resolution.projection.isFinished
    }

    events.push({
      kind: 'attempt-completed',
      sessionKind: 'acquisition',
      word: currentWord.name,
      success: true,
      beforeIndex,
      afterIndex: index,
      expectedAfterIndex: resolution.projection.index,
      beforeQueueSignature,
      afterQueueSignature: queueSignature(queue),
      expectedAfterQueueSignature: queueSignature(
        resolution.projection.queue,
      ),
      beforeItemStateSignature,
      afterItemStateSignature: acquisitionStateSignature(
        acquisitionStates[currentWord.name],
      ),
      afterFinished: finished,
      expectedAfterFinished: resolution.projection.isFinished,
    })

    interactions += 1
  }

  return {
    events,
    queue,
    index,
    acquisitionStates,
    finished,
    interactions,
  }
}
