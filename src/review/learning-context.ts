import type { AnswerVisibility, IWordRecord, LearningContextV1 } from '@/utils/db/record'

export function summarizeAnswerVisibility(letterVisibility: boolean[]): AnswerVisibility | undefined {
  if (letterVisibility.length === 0) return undefined

  const visibleCount = letterVisibility.filter(Boolean).length
  if (visibleCount === 0) return 'hidden'
  if (visibleCount === letterVisibility.length) return 'full'
  return 'partial'
}

/**
 * Captures semantic learning conditions without coupling the persisted schema
 * to specific UI controls such as hover, mouse, buttons, or hotkeys.
 */
export class LearningContextCollector {
  private context: LearningContextV1 = { version: 1 }
  private hasInputStarted = false

  reset(initial?: {
    answerVisibilityAtStart?: AnswerVisibility
    pronunciationEnabledAtStart?: boolean
  }) {
    this.context = {
      version: 1,
      answerVisibilityAtStart: initial?.answerVisibilityAtStart,
      answerRevealed: false,
      revealedBeforeFirstKey: false,
      revealCount: 0,
      pronunciationEnabledAtStart: initial?.pronunciationEnabledAtStart,
      pronunciationPlayed: false,
      pronunciationPlayCount: 0,
    }
    this.hasInputStarted = false
  }

  recordInputStarted() {
    this.hasInputStarted = true
  }

  recordAnswerReveal() {
    this.context.answerRevealed = true
    this.context.revealCount = (this.context.revealCount ?? 0) + 1
    if (!this.hasInputStarted) {
      this.context.revealedBeforeFirstKey = true
    }
  }

  recordPronunciationPlayed() {
    this.context.pronunciationPlayed = true
    this.context.pronunciationPlayCount = (this.context.pronunciationPlayCount ?? 0) + 1
  }

  snapshot(): LearningContextV1 {
    return { ...this.context }
  }
}

export function readLearningContext(record: IWordRecord): LearningContextV1 | undefined {
  return record.learningContext?.version === 1 ? record.learningContext : undefined
}
