import {
  getFirstValidDictionaryExample,
  maskDictionaryExample,
} from '@/utils/dictionaryExample'
import type { Word } from '@/typings'
import { useMemo } from 'react'

export default function ExampleCue({
  word,
  revealed,
}: {
  word: Word
  revealed: boolean
}) {
  const example = useMemo(
    () => getFirstValidDictionaryExample(word),
    [word],
  )
  const parts = useMemo(
    () => (example ? maskDictionaryExample(example) : undefined),
    [example],
  )

  if (!example || !parts) return null

  return (
    <div
      data-typing-example="visible"
      data-typing-example-revealed={revealed ? 'true' : 'false'}
      className="focus-example-cue mt-4 max-w-3xl whitespace-pre-wrap px-4 text-center font-sans text-base leading-7 sm:px-6"
    >
      <div
        data-typing-example-en="visible"
        className="focus-example-en"
      >
        <span>{parts.before}</span>
        <span
          data-typing-example-surface={revealed ? parts.surface : ''}
          className={
            revealed
              ? 'rounded px-1 font-semibold text-indigo-600 transition-all duration-300 dark:text-indigo-300'
              : 'font-mono tracking-wide text-gray-400 dark:text-gray-500'
          }
        >
          {revealed ? parts.surface : parts.masked}
        </span>
        <span>{parts.after}</span>
      </div>
      <div
        data-typing-example-cn="visible"
        className="focus-example-cn mt-1"
      >
        {example.cn}
      </div>
    </div>
  )
}
