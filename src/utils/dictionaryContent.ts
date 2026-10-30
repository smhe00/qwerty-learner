import type { DictionaryContent, Word } from '@/typings'

export const dictionaryContentKinds = ['senses', 'collocations', 'relatedWords', 'synonyms', 'antonyms', 'notes', 'extra'] as const

/** Classify complete source lines only; never rewrite or split their meaning. */
export function createDictionaryContent(trans: readonly string[]): DictionaryContent {
  const content: DictionaryContent = {
    version: 1, senses: [], collocations: [], relatedWords: [],
    synonyms: [], antonyms: [], notes: [], extra: [],
  }
  trans.forEach((text, sourceIndex) => {
    const value = text.trim()
    const kind =
      /^词组(?:\s|$)/.test(value) ? 'collocations' :
      /^点拨(?:\s|$)/.test(value) ? 'notes' :
      /^近义(?:\s|$)/.test(value) ? 'synonyms' :
      /^反义(?:\s|$)/.test(value) ? 'antonyms' :
      sourceIndex === 0 || /^(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|det|aux|modal|phr|abbr)\./i.test(value) ? 'senses' :
      /^[A-Za-z][A-Za-z’' -]*\s+(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|det|aux|modal|phr|abbr)\./i.test(value) ? 'relatedWords' :
      'extra'
    content[kind].push({ sourceIndex, text })
  })
  return content
}

/** Reject stale or partial metadata as a whole, retaining the legacy full text. */
export function getDictionaryContent(word: Pick<Word, 'trans' | 'content' | 'shortMeaning'>): DictionaryContent | null {
  const content = word.content
  if (!content || content.version !== 1 || !Array.isArray(word.trans)) return null
  const seen = new Set<number>()
  for (const kind of dictionaryContentKinds) {
    if (!Array.isArray(content[kind])) return null
    for (const entry of content[kind]) {
      if (!entry || !Number.isInteger(entry.sourceIndex) ||
        entry.sourceIndex < 0 || entry.sourceIndex >= word.trans.length ||
        entry.text !== word.trans[entry.sourceIndex] || seen.has(entry.sourceIndex)) return null
      seen.add(entry.sourceIndex)
    }
  }
  if (seen.size !== word.trans.length) return null
  if (!content.senses.length && !(typeof word.shortMeaning === 'string' && word.shortMeaning.trim())) return null
  return content
}

export function getDictionaryMeaning(word: Pick<Word, 'trans' | 'content' | 'shortMeaning'>): string {
  const content = getDictionaryContent(word)
  return content ? (content.senses.length ? content.senses.map(entry => entry.text).join('；') : word.shortMeaning!) : word.trans.join('；')
}
