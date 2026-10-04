import { CHAPTER_LENGTH } from '@/constants'
import { isLongTermMastered } from '@/learn/mastery'
import type { IReviewWordState } from '@/review/types'
import type { IWordRecord } from '@/utils/db/record'
import type { Word } from '@/typings'

export type AchievementUnitMembership = {
  unitIndex: number
  words: string[]
}

export function buildAchievementUnitMembership(
  dictionaryWords: Word[],
): Map<string, AchievementUnitMembership> {
  const membership = new Map<string, AchievementUnitMembership>()
  const unitWords = new Map<number, string[]>()

  dictionaryWords.forEach((word, index) => {
    if (!word?.name) return
    const unitIndex = Math.floor(index / CHAPTER_LENGTH)
    const words = unitWords.get(unitIndex) ?? []
    if (!words.includes(word.name)) words.push(word.name)
    unitWords.set(unitIndex, words)

    // Learn owns one long-term memory per exact word name. If a dictionary
    // repeats a name in later chapters, its stable Achievement unit is the
    // first original occurrence, matching canonical Learn identity without
    // shifting the source dictionary's chapter boundaries.
    if (!membership.has(word.name)) {
      membership.set(word.name, { unitIndex, words: [] })
    }
  })

  for (const [word, entry] of membership) {
    membership.set(word, {
      unitIndex: entry.unitIndex,
      words: [...(unitWords.get(entry.unitIndex) ?? [])],
    })
  }

  return membership
}

export function evaluateNewUnitLearnStarted(input: {
  current: IWordRecord
  records: IWordRecord[]
  dictionaryWords: Word[]
}): number {
  if (input.current.sourceMode !== 'learn') return 0
  const membership = buildAchievementUnitMembership(input.dictionaryWords)
  const currentUnit = membership.get(input.current.word)
  if (!currentUnit) return 0

  const priorLearnInSameUnit = input.records.some((record) => {
    if (record.sourceMode !== 'learn') return false
    if (record.id === input.current.id) return false
    const member = membership.get(record.word)
    if (!member || member.unitIndex !== currentUnit.unitIndex) return false
    if (record.timeStamp < input.current.timeStamp) return true
    return (
      record.timeStamp === input.current.timeStamp &&
      (record.id ?? Number.MAX_SAFE_INTEGER) <
        (input.current.id ?? Number.MAX_SAFE_INTEGER)
    )
  })

  return priorLearnInSameUnit ? 0 : 1
}

export function evaluateChapterLongTermMasteryRatio(input: {
  word: string
  dictionaryWords: Word[]
  states: IReviewWordState[]
}): number | null {
  const membership = buildAchievementUnitMembership(input.dictionaryWords)
  const currentUnit = membership.get(input.word)
  if (!currentUnit) return null

  const stateByWord = new Map(
    input.states.map((state) => [state.word, state]),
  )
  const eligibleWords = currentUnit.words.filter((word) => {
    const state = stateByWord.get(word)
    return state?.lifecycle !== 'excluded'
  })
  if (eligibleWords.length === 0) return null

  const mastered = eligibleWords.filter((word) =>
    isLongTermMastered(stateByWord.get(word)),
  ).length

  return mastered / eligibleWords.length
}
