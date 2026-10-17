import { MIN_CROSS_SESSION_INDEPENDENT_DELAY_SECONDS, MIN_INDEPENDENT_INTERVENING_ITEMS } from './acquisition'
import { deriveLearnDailyProgress } from './daily-session'
import type { LearnDailySessionV1 } from './daily-session'
import type { IReviewWordState } from '@/review/types'
import type { Word } from '@/typings'
import type { IWordRecord } from '@/utils/db/record'

/** Real Learn evidence only; reloading, Typing and duplicate copies give no spacing credit. */
export function hasLearnRetrySpacing(word: string, records: IWordRecord[], now: number): boolean {
  const ordered = records.filter(record => record.sourceMode === 'learn' && record.timeStamp <= now)
    .sort((a, b) => a.timeStamp - b.timeStamp || (a.id ?? 0) - (b.id ?? 0))
  const lastIndex = ordered.map(record => record.word).lastIndexOf(word)
  if (lastIndex < 0) return true
  if (now - ordered[lastIndex].timeStamp >= MIN_CROSS_SESSION_INDEPENDENT_DELAY_SECONDS) return true
  return new Set(ordered.slice(lastIndex + 1).map(record => record.word)).size >= MIN_INDEPENDENT_INTERVENING_ITEMS
}

/** Prefer weak admitted words; rotate recent practice instead of copying the same filler forever. */
export function rankLearnInterleavingWords(input: {
  words: Word[]
  states: IReviewWordState[]
  records: IWordRecord[]
  excludedNames: Iterable<string>
}): Word[] {
  const excluded = new Set(input.excludedNames)
  const states = new Map(input.states.filter(state => state.lifecycle !== 'excluded').map(state => [state.word, state]))
  const errors = new Map<string, number>()
  const latest = new Map<string, number>()
  for (const record of input.records) {
    if (record.sourceMode !== 'learn') continue
    errors.set(record.word, (errors.get(record.word) ?? 0) + record.wrongCount)
    latest.set(record.word, Math.max(latest.get(record.word) ?? 0, record.timeStamp))
  }
  const recent = new Set(input.records.filter(record => record.sourceMode === 'learn')
    .sort((a, b) => b.timeStamp - a.timeStamp || (b.id ?? 0) - (a.id ?? 0))
    .slice(0, MIN_INDEPENDENT_INTERVENING_ITEMS - 1).map(record => record.word))
  return input.words.filter(word => states.has(word.name) && !excluded.has(word.name))
    .sort((a, b) => {
      const left = states.get(a.name)
      const right = states.get(b.name)
      if (!left || !right) return 0
      return Number(recent.has(a.name)) - Number(recent.has(b.name)) || right.lapseCount - left.lapseCount ||
        (errors.get(b.name) ?? 0) - (errors.get(a.name) ?? 0) ||
        (latest.get(a.name) ?? 0) - (latest.get(b.name) ?? 0)
    })
}

export function planLearnContinuation(input: {
  session: LearnDailySessionV1
  words: Word[]
  states: IReviewWordState[]
  records: IWordRecord[]
  now: number
}) {
  const records = input.records.filter(record => record.dict === input.session.dict)
  const completed = new Set(deriveLearnDailyProgress({ session: input.session, wordRecords: records }).independentCompletedWords)
  const active = new Set(input.states.filter(state => state.lifecycle !== 'excluded').map(state => state.word))
  const review = new Set(input.session.plannedReviewWords)
  const unfinishedReviews = input.words.filter(word => review.has(word.name) && active.has(word.name) && !completed.has(word.name))
  const readyReviews = unfinishedReviews.filter(word => hasLearnRetrySpacing(word.name, records, input.now))
  const spacingWords = rankLearnInterleavingWords({
    words: input.words, states: input.states, records,
    excludedNames: unfinishedReviews.map(word => word.name),
  })
  return { unfinishedReviews, readyReviews, spacingWords }
}
