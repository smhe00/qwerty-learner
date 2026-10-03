import type { DictionaryExample, Word } from '@/typings'

export function isValidDictionaryExample(
  example: DictionaryExample | undefined,
): example is DictionaryExample {
  return Boolean(
    example &&
      typeof example.en === 'string' &&
      typeof example.cn === 'string' &&
      Number.isInteger(example.start) &&
      Number.isInteger(example.end) &&
      example.start >= 0 &&
      example.end > example.start &&
      example.end <= example.en.length,
  )
}

export function getFirstValidDictionaryExample(
  word: Pick<Word, 'example'>,
): DictionaryExample | undefined {
  return word.example?.find(isValidDictionaryExample)
}

export function maskDictionaryExample(example: DictionaryExample): {
  before: string
  masked: string
  surface: string
  after: string
} {
  const surface = example.en.slice(example.start, example.end)
  return {
    before: example.en.slice(0, example.start),
    masked: '_'.repeat(Math.max(3, surface.length)),
    surface,
    after: example.en.slice(example.end),
  }
}
