import catalog from './study-examples.json'
import { getStudyIllustration } from './studyIllustrations'
import type { Word } from '@/typings'
import { getFirstValidDictionaryExample, isValidDictionaryExample } from '@/utils/dictionaryExample'

const examples = new Map(catalog.map(entry => [JSON.stringify([entry.word, entry.sourceMeaning]), entry]))

/** A presentation overlay: never mutate dictionary words or learning identity. */
export function getStudyPresentation(dictId: string, word: Pick<Word, 'name' | 'trans' | 'example'>, desktop = true) {
  const original = getFirstValidDictionaryExample(word)
  const entry = desktop && dictId === 'shanghai-zhongkao-2027'
    ? examples.get(JSON.stringify([word.name, word.trans?.[0]])) : undefined
  if (!entry || JSON.stringify(word.example || []) !== JSON.stringify(entry.syllabusExamples) || !isValidDictionaryExample(entry.example)) {
    return { example: original, source: 'syllabus' as const, syllabusExamples: [] }
  }
  const asset = entry.illustrationId ? getStudyIllustration(dictId, word) : undefined
  const illustration = asset?.sourceId === entry.illustrationId ? asset : undefined
  return {
    example: entry.example,
    source: 'daily' as const,
    syllabusExamples: (word.example || []).filter(isValidDictionaryExample),
    illustration,
  }
}
