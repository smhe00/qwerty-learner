import type { Word } from '@/typings'

function stableKey(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function ordered(words: readonly Word[]): Word[] {
  return [...words].sort((a, b) => stableKey(a.name) - stableKey(b.name))
}

export function getShortMeaning(word: Pick<Word, 'shortMeaning'>): string {
  return typeof word.shortMeaning === 'string' ? word.shortMeaning.trim() : ''
}

// Cloze still asks for English words and can use dictionaries without glosses.
export function buildContextChoices(word: Word, queue: readonly Word[]): Word[] {
  const seen = new Set<string>()
  const targetMeaning = word.trans?.filter(Boolean).join('；')
  const candidates = queue.filter((candidate) => {
    if (!candidate.name || candidate.name === word.name || seen.has(candidate.name)) return false
    seen.add(candidate.name)
    return true
  })
  const differentMeanings = candidates.filter((candidate) => candidate.trans?.filter(Boolean).join('；') !== targetMeaning)
  const distractors = ordered(differentMeanings.length >= 3 ? differentMeanings : candidates).slice(0, 3)
  return ordered([...distractors, word])
}

function meaningParts(meaning: string): string[] {
  return meaning.normalize('NFKC').toLowerCase().split(/[；;，,、/]+/u)
    .map((part) => part.replace(/[\s\p{P}\p{S}]/gu, ''))
    .filter(Boolean)
}

// Both listening-to-meaning and word-to-meaning require actual short glosses.
// Exact shared senses are excluded across ALL options, not just the target.
// This is a conservative text check, not a semantic synonym classifier.
export function buildShortMeaningChoices(word: Word, queue: readonly Word[]): Word[] {
  const target = getShortMeaning(word)
  const targetParts = meaningParts(target)
  if (!target || !targetParts.length) return []

  const seenNames = new Set([word.name])
  const seenParts = new Set(targetParts)
  const distractors: Word[] = []
  for (const candidate of ordered(queue)) {
    const meaning = getShortMeaning(candidate)
    const parts = meaningParts(meaning)
    if (!candidate.name || seenNames.has(candidate.name) || !parts.length || parts.some((part) => seenParts.has(part))) continue
    seenNames.add(candidate.name)
    parts.forEach((part) => seenParts.add(part))
    distractors.push(candidate)
    if (distractors.length === 3) break
  }
  return distractors.length ? ordered([...distractors, word]) : []
}
