import { countLongTermMasteredWords } from '@/learn/mastery'
import type { IReviewWordState } from '@/review/types'

export const SUPPORTED_STATE_METRICS = new Set([
  'long_term_mastered_word_count',
  'chapter_long_term_mastery_ratio',
])

export function evaluateLongTermMasteredWordCount(
  states: IReviewWordState[],
): number {
  return countLongTermMasteredWords(states)
}
