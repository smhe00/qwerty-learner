/**
 * Device-independent Learn interaction choice (V1).
 *
 * The owner of word allocation, spacing and Review Rating remains the Learn
 * session. This selector only chooses how to present the already-allocated
 * task. Objective spelling never becomes a second FSRS scheduler.
 *
 * Conservative policy: scheduled Cold Probe is ALWAYS a cold probe.
 * Choice/listening training can never substitute for it.
 */
export const LEARN_TASK_SELECTOR_VERSION = 'learn-task-selector-v1' as const

export type LearnExerciseKind =
  | 'exposure'
  | 'context'
  | 'audio'
  | 'meaning-choice'
  | 'recall'
  | 'spelling'

export type LearnGoal = 'vocabulary' | 'vocabulary-and-spelling'
export type LearnExercisePreference = 'auto' | 'tap-recall' | 'cold-spelling'

export type LearnTaskHistoryEvent = {
  timeStamp: number
  learnItemKind?: string
  reviewRatingDecision?: { eligible: boolean; rating: string | null }
  reviewEvidence?: {
    errorCause?: string
    reasonCodes?: string[]
  }
}

export type LearnTaskSelection = {
  exercise: LearnExerciseKind
  reason: 'exposure' | 'guided' | 'supported' | 'cold-recall' |
    'cold-spelling-preference' | 'spelling-verification-due'
  policyVersion: typeof LEARN_TASK_SELECTOR_VERSION
}

export function selectLearnTask(input: {
  itemKind: 'review' | 'acquisition' | 'practice'
  acquisitionPhase?: string
  hasContext: boolean
  choicesAvailable: boolean
  audioAvailable: boolean
  goal: LearnGoal
  preference: LearnExercisePreference
  hasTextInput: boolean
  history?: readonly LearnTaskHistoryEvent[]
}): LearnTaskSelection {
  const choose = (
    exercise: LearnExerciseKind,
    reason: LearnTaskSelection['reason'],
  ): LearnTaskSelection => ({
    exercise,
    reason,
    policyVersion: LEARN_TASK_SELECTOR_VERSION,
  })

  if (input.itemKind === 'practice') {
    // Deferred filler / reinforcement is scheduler-neutral. Never promote a
    // spelling checkpoint here merely because orthography remains unverified.
    return choose('recall', 'supported')
  }
  if (input.itemKind === 'acquisition') {
    if (input.acquisitionPhase === 'exposure') return choose('exposure', 'exposure')
    if (input.acquisitionPhase === 'guided') {
      return choose(
        !input.choicesAvailable ? 'recall' :
          input.hasContext ? 'context' : 'meaning-choice',
        'guided',
      )
    }
    if (input.acquisitionPhase === 'supported') {
      return choose(!input.choicesAvailable ? 'recall' :
        input.audioAvailable ? 'audio' : 'meaning-choice', 'supported')
    }
  }
  // A Review or Independent Acquisition MUST reach a real cold probe.
  if (input.hasTextInput && input.preference === 'cold-spelling') {
    return choose('spelling', 'cold-spelling-preference')
  }
  if (input.preference !== 'auto' || !input.hasTextInput ||
      input.goal === 'vocabulary') {
    return choose('recall', 'cold-recall')
  }

  // Self-report is genuine memory evidence, but NOT orthography proof.
  // Only count eligible positive cold self-reports since the last objectively
  // verified clean spelling; never count choice accuracy or legacy post-reveal
  // self ratings. Recheck spelling after an explicit orthography error.
  const sorted = [...(input.history ?? [])]
    .sort((left, right) => left.timeStamp - right.timeStamp)
  let cleanSelfReports = 0
  let spellingNeedsVerification = false
  for (const item of sorted) {
    if (item.learnItemKind !== 'review') continue
    const reasons = item.reviewEvidence?.reasonCodes ?? []
    if (reasons.includes('objective-spelling-clean')) {
      cleanSelfReports = 0
      spellingNeedsVerification = false
    } else if (reasons.includes('objective-spelling-mismatch')) {
      spellingNeedsVerification = true
    } else if (
      item.reviewRatingDecision?.eligible === true &&
      item.reviewRatingDecision.rating === 'good' &&
      reasons.includes('self-rated-before-answer-reveal') &&
      reasons.includes('self-report-not-spelling')
    ) {
      cleanSelfReports += 1
    }
  }

  return spellingNeedsVerification || cleanSelfReports >= 3
    ? choose('spelling', 'spelling-verification-due')
    : choose('recall', 'cold-recall')
}
