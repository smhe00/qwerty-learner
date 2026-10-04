import type { LearnAcquisitionState } from './acquisition'
import { decideLearnScaffold } from './scaffold'

export const LEARN_RECOVERY_WINDOW_POLICY_VERSION =
  'learn-recovery-window-v1'

export const learnRecoveryWindowPolicy = {
  elevatedItems: 2,
  recoveryItems: 3,
  maxLookaheadItems: 8,
} as const

export type LearnRecoveryWindowPlan = {
  policyVersion: typeof LEARN_RECOVERY_WINDOW_POLICY_VERSION
  active: boolean
  tier: LearnAcquisitionState['scaffoldStrainTier']
  targetSize: number
  selectedNames: string[]
  reasonCodes: string[]
}

function isConfidenceTrainingState(
  state: LearnAcquisitionState | undefined,
): boolean {
  if (!state) return false

  if (state.phase === 'exposure' || state.phase === 'guided') {
    return true
  }

  if (state.phase !== 'supported') return false

  return (
    decideLearnScaffold({
      phase: state.phase,
      strainTier: state.scaffoldStrainTier ?? 'unknown',
      assistedCycles: state.assistedCycles,
      hintPosition: state.scaffoldHintPosition,
    }).level === 'S1'
  )
}

/**
 * Recovery Window V1 is a queue-ordering policy, not a new learning item.
 *
 * It activates only after a failed Independent acquisition while observable
 * Learn interaction strain is elevated/recovery. It then pulls 2-3 existing,
 * high-confidence training items forward:
 *
 * - Exposure/Guided (S0 visible-answer training), or
 * - Supported attempts already qualifying for S1 strong support.
 *
 * Independent items are never selected, so the recovery window itself cannot
 * create durable mastery evidence.
 */
export function planLearnRecoveryWindow<T extends { name: string }>(input: {
  queue: T[]
  currentIndex: number
  currentWord: T
  nextState: LearnAcquisitionState
  acquisitionStates?: Record<string, LearnAcquisitionState>
}): LearnRecoveryWindowPlan {
  const tier = input.nextState.scaffoldStrainTier
  const triggered =
    input.nextState.phase === 'supported' &&
    input.nextState.assistedCycles > 0 &&
    (tier === 'elevated' || tier === 'recovery')

  const targetSize =
    tier === 'recovery'
      ? learnRecoveryWindowPolicy.recoveryItems
      : tier === 'elevated'
        ? learnRecoveryWindowPolicy.elevatedItems
        : 0

  if (!triggered || targetSize === 0) {
    return {
      policyVersion: LEARN_RECOVERY_WINDOW_POLICY_VERSION,
      active: false,
      tier,
      targetSize,
      selectedNames: [],
      reasonCodes: ['recovery-window-not-triggered'],
    }
  }

  const selectedNames: string[] = []
  const selectedSet = new Set<string>()
  const endExclusive = Math.min(
    input.queue.length,
    input.currentIndex + 1 + learnRecoveryWindowPolicy.maxLookaheadItems,
  )

  for (
    let index = input.currentIndex + 1;
    index < endExclusive && selectedNames.length < targetSize;
    index += 1
  ) {
    const candidate = input.queue[index]
    if (
      !candidate ||
      candidate.name === input.currentWord.name ||
      selectedSet.has(candidate.name)
    ) {
      continue
    }

    const state = input.acquisitionStates?.[candidate.name]
    if (!isConfidenceTrainingState(state)) continue

    selectedNames.push(candidate.name)
    selectedSet.add(candidate.name)
  }

  return {
    policyVersion: LEARN_RECOVERY_WINDOW_POLICY_VERSION,
    active: selectedNames.length > 0,
    tier,
    targetSize,
    selectedNames,
    reasonCodes: [
      `recovery-window-${tier}`,
      `recovery-window-target-${targetSize}`,
      `recovery-window-selected-${selectedNames.length}`,
      ...(selectedNames.length === 0
        ? ['recovery-window-no-confidence-candidate']
        : ['recovery-window-confidence-training-only']),
    ],
  }
}

export function applyLearnRecoveryWindow<T extends { name: string }>(
  queue: T[],
  currentIndex: number,
  selectedNames: string[],
): T[] {
  if (selectedNames.length === 0) return [...queue]

  const nextQueue = [...queue]
  let insertAt = currentIndex + 1

  for (const name of selectedNames) {
    const foundIndex = nextQueue.findIndex(
      (item, index) => index >= insertAt && item.name === name,
    )
    if (foundIndex < 0) continue

    const [item] = nextQueue.splice(foundIndex, 1)
    nextQueue.splice(insertAt, 0, item)
    insertAt += 1
  }

  return nextQueue
}
