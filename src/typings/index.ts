export * from './resource'

export type PronunciationType = 'us' | 'uk' | 'romaji' | 'zh' | 'ja' | 'de' | 'hapin' | 'kk' | 'id'
export type PhoneticType = 'us' | 'uk' | 'romaji' | 'zh' | 'ja' | 'de' | 'hapin' | 'kk' | 'id'
export type LanguageType = 'en' | 'romaji' | 'zh' | 'ja' | 'code' | 'de' | 'kk' | 'hapin' | 'id'
export type LanguageCategoryType = 'en' | 'ja' | 'de' | 'code' | 'kk' | 'id'

type Pronunciation2PhoneticMap = Record<PronunciationType, PhoneticType>

export const PRONUNCIATION_PHONETIC_MAP: Pronunciation2PhoneticMap = {
  us: 'us',
  uk: 'uk',
  romaji: 'romaji',
  zh: 'zh',
  ja: 'ja',
  de: 'de',
  hapin: 'hapin',
  kk: 'kk',
  id: 'id',
}

export type DictionaryExample = {
  en: string
  cn: string
  start: number
  end: number
}

export type DictionaryContentEntry = {
  /** Index into the unchanged authoritative trans array. */
  sourceIndex: number
  /** Exact source text, including original punctuation and labels. */
  text: string
}

export type DictionaryContent = {
  version: 1
  senses: DictionaryContentEntry[]
  collocations: DictionaryContentEntry[]
  relatedWords: DictionaryContentEntry[]
  synonyms: DictionaryContentEntry[]
  antonyms: DictionaryContentEntry[]
  notes: DictionaryContentEntry[]
  extra: DictionaryContentEntry[]
}

export type Word = {
  name: string
  trans: string[]
  /** Optional lossless presentation of the original trans entries. */
  content?: DictionaryContent
  // Curated concise meaning; missing/empty values have no usable short gloss.
  shortMeaning?: string
  usphone: string
  ukphone: string
  notation?: string
  example?: DictionaryExample[]
  tags?: string[]
}

export type WordWithIndex = Word & {
  // 在 chapter 中的原始索引
  index: number
}

export type InfoPanelType = 'donate' | 'vsc' | 'community' | 'redBook'

export type InfoPanelState = {
  [key in InfoPanelType]: boolean
}

export type LoopWordTimesOption = 1 | 3 | 5 | 8 | typeof Number.MAX_SAFE_INTEGER

export type WordDictationType = 'hideAll' | 'hideVowel' | 'hideConsonant' | 'randomHide'
/**
 * 标记用户是手动打开默写模式，还是通过点击 resultScreen 中的默写本章按钮打开的
 *
 * 预期行为是，在进入下一章节时，如果是手动打开的默写模式，则保持设定
 * 如果是通过点击 resultScreen 中的默写本章按钮打开的，则关闭默写模式
 */
export type WordDictationOpenBy = 'user' | 'auto'
