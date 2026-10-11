import {
  MIN_INDEPENDENT_INTERVENING_ITEMS,
  createLearnAcquisitionState,
  projectLearnAcquisitionProgress,
} from './acquisition'
import type { LearnAcquisitionState } from './acquisition'
import type {
  LearnAcquisitionCompletionInput,
  LearnAcquisitionCompletionResolution,
} from './progression'
import type { Word } from '@/typings'

/** Replace a clock-only pause with real, scheduler-neutral intervening practice. */
export function continueAcquisitionWithPractice(
  input: LearnAcquisitionCompletionInput,
  result: LearnAcquisitionCompletionResolution,
): LearnAcquisitionCompletionResolution {
  if ((input.spacingWords === undefined && input.optionalNewWords === undefined) || result.nextState.phase !== 'deferred')
    return result
  const reason = result.nextState.deferredReason
  if (reason !== 'spacing' && reason !== 'assistance') return result

  const rest = input.queue
    .slice(input.currentIndex + 1)
    .filter((word) => word.name !== input.currentWord.name)
  const needed = Math.max(0, MIN_INDEPENDENT_INTERVENING_ITEMS - rest.length)
  const pendingNames = new Set(rest.map((word) => word.name))
  const optionalNames = new Set((input.optionalNewWords ?? []).map(word => word.name))
  const candidates = [...(input.spacingWords ?? []), ...(input.optionalNewWords ?? [])]
  const selected = new Map<string, Word>()
  for (const word of candidates) {
    const state = input.acquisitionStates[word.name]
    if (
      word.name === input.currentWord.name ||
      pendingNames.has(word.name) ||
      (optionalNames.has(word.name) && state !== undefined) ||
      (state && state.phase !== 'complete' && !state.spacingOnly)
    )
      continue
    selected.set(word.name, word)
    if (selected.size >= needed) break
  }
  // Very small dictionaries may genuinely lack enough other words. Never
  // fabricate a spacing credit or promote a just-copied answer to mastery.
  if (selected.size < needed) return result
  const practiceWords =
    needed > 0 ? [...selected.values()].slice(0, needed) : []
  const states = { ...result.acquisitionStates }
  for (const word of practiceWords) {
    states[word.name] = { ...createLearnAcquisitionState(), ...(optionalNames.has(word.name) ? {} : { spacingOnly: true }) }
  }
  const nextState: LearnAcquisitionState = {
    ...result.nextState,
    phase:
      reason === 'assistance'
        ? ('supported' as const)
        : ('independent' as const),
    deferredReason: undefined,
    resumeAfter: undefined,
    independentInterveningItems: undefined,
  }
  states[input.currentWord.name] = nextState
  const queue = [
    ...input.queue.slice(0, input.currentIndex + 1),
    ...practiceWords,
    ...rest,
  ]
  const projection = projectLearnAcquisitionProgress({
    queue,
    currentIndex: input.currentIndex,
    currentWord: input.currentWord,
    nextState,
    acquisitionStates: states,
  })
  nextState.independentInterveningItems =
    nextState.phase === 'independent'
      ? projection.interveningItemsBeforeFollowUp
      : undefined
  return {
    nextState,
    acquisitionStates: states,
    projection,
    shouldPersistAdmission: false,
  }
}
