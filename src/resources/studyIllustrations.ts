import catalog from './study-illustrations.json'
import type { Word } from '@/typings'

const illustrations = new Map(catalog.map(entry => [JSON.stringify([entry.word, entry.sourceMeaning]), entry]))

/** Screened presentation assets only. Dictionary text remains the authority. */
export function getStudyIllustration(dictId: string, word: Pick<Word, 'name' | 'trans'>) {
  if (dictId !== 'shanghai-zhongkao-2027') return undefined
  const entry = illustrations.get(JSON.stringify([word.name, word.trans?.[0]]))
  if (!entry) return undefined
  return { ...entry, path: '/images/word-atlas/' + entry.sourceId + '.webp' }
}
