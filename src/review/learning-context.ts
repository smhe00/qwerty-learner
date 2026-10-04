import type {
  AnswerVisibility,
  IWordRecord,
  LearningContextV1,
  PronunciationCue,
  ReviewHintContextV1,
} from '@/utils/db/record'

export function summarizeAnswerVisibility(letterVisibility: boolean[]): AnswerVisibility | undefined {
  if (letterVisibility.length === 0) return undefined

  const visibleCount = letterVisibility.filter(Boolean).length
  if (visibleCount === 0) return 'hidden'
  if (visibleCount === letterVisibility.length) return 'full'
  return 'partial'
}

export function calculateAnswerVisibleRatio(letterVisibility: boolean[]): number | undefined {
  if (letterVisibility.length === 0) return undefined
  return letterVisibility.filter(Boolean).length / letterVisibility.length
}

/**
 * Captures semantic learning conditions without coupling the persisted schema
 * to specific UI controls such as hover, mouse, buttons, or hotkeys.
 */
export class LearningContextCollector {
  private context: LearningContextV1 = { version: 1 }
  private hasInputStarted = false
  private lastAnswerRevealAtMs: number | undefined

  reset(initial?: {
    answerVisibilityAtStart?: AnswerVisibility
    answerVisibleRatioAtStart?: number
    exampleVisibleAtStart?: boolean
    meaningVisibleAtStart?: boolean
    phoneticVisibleAtStart?: boolean
    pronunciationEnabledAtStart?: boolean
  }) {
    this.context = {
      version: 1,
      answerVisibilityAtStart: initial?.answerVisibilityAtStart,
      answerVisibleRatioAtStart: initial?.answerVisibleRatioAtStart,
      answerRevealed: false,
      revealedBeforeFirstKey: false,
      revealCount: 0,
      exampleVisibleAtStart: initial?.exampleVisibleAtStart,
      meaningVisibleAtStart: initial?.meaningVisibleAtStart,
      meaningRevealed: false,
      meaningRevealedBeforeFirstKey: false,
      meaningRevealCount: 0,
      phoneticVisibleAtStart: initial?.phoneticVisibleAtStart,
      pronunciationEnabledAtStart: initial?.pronunciationEnabledAtStart,
      pronunciationPlayed: false,
      pronunciationPlayedBeforeFirstKey: false,
      pronunciationPlayCount: 0,
      pronunciationAutomaticPlayCount: 0,
      pronunciationRequestedPlayCount: 0,
    }
    this.hasInputStarted = false
    this.lastAnswerRevealAtMs = undefined
  }

  recordInputStarted(nowMs: number) {
    if (this.hasInputStarted) return

    this.hasInputStarted = true
    if (this.lastAnswerRevealAtMs !== undefined) {
      this.context.lastAnswerRevealToFirstKeyMs = Math.max(0, nowMs - this.lastAnswerRevealAtMs)
    }
  }

  recordAnswerReveal(nowMs: number) {
    this.context.answerRevealed = true
    this.context.revealCount = (this.context.revealCount ?? 0) + 1
    this.lastAnswerRevealAtMs = nowMs

    if (!this.hasInputStarted) {
      this.context.revealedBeforeFirstKey = true
    }
  }

  recordMeaningReveal() {
    this.context.meaningRevealed = true
    this.context.meaningRevealCount = (this.context.meaningRevealCount ?? 0) + 1

    if (!this.hasInputStarted) {
      this.context.meaningRevealedBeforeFirstKey = true
    }
  }

  recordReviewHintAdvance(
    level: 0 | 1 | 2 | 3,
    coldProbeSurrendered: boolean,
    meta?: {
      hintPosition?: number
      autoHint0Triggered?: boolean
    },
  ) {
    const current = this.context.reviewHint
    const advanceCount = Math.min(4, (current?.advanceCount ?? 0) + 1) as ReviewHintContextV1['advanceCount']

    this.context.reviewHint = {
      version: 1,
      maxLevel:
        current === undefined
          ? level
          : (Math.max(current.maxLevel, level) as ReviewHintContextV1['maxLevel']),
      coldProbeSurrendered:
        (current?.coldProbeSurrendered ?? false) || coldProbeSurrendered,
      advanceCount,
      hintPosition:
        meta?.hintPosition ?? current?.hintPosition,
      autoHint0Triggered:
        (current?.autoHint0Triggered ?? false) ||
        (meta?.autoHint0Triggered ?? false),
    }
  }

  recordPronunciationPlayed(cue: PronunciationCue) {
    this.context.pronunciationPlayed = true
    this.context.pronunciationPlayCount = (this.context.pronunciationPlayCount ?? 0) + 1
    this.context.pronunciationAutomaticPlayCount =
      (this.context.pronunciationAutomaticPlayCount ?? 0) + (cue === 'automatic' ? 1 : 0)
    this.context.pronunciationRequestedPlayCount =
      (this.context.pronunciationRequestedPlayCount ?? 0) + (cue === 'requested' ? 1 : 0)

    if (!this.hasInputStarted) {
      this.context.pronunciationPlayedBeforeFirstKey = true
    }
  }

  snapshot(): LearningContextV1 {
    return { ...this.context }
  }
}

export function readLearningContext(record: IWordRecord): LearningContextV1 | undefined {
  return record.learningContext?.version === 1 ? record.learningContext : undefined
}
