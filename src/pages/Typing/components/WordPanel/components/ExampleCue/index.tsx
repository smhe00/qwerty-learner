import SyllabusExamples from '@/components/SyllabusExamples'
import { getStudyPresentation } from '@/resources/studyExamples'
import { maskDictionaryExample } from '@/utils/dictionaryExample'
import type { Word } from '@/typings'
import { useMemo } from 'react'

export default function ExampleCue({
  word,
  revealed,
  dictId,
  answerVisible,
}: {
  word: Word
  revealed: boolean
  dictId: string
  answerVisible: boolean
}) {
  const presentation = useMemo(() => getStudyPresentation(dictId, word), [dictId, word])
  const example = presentation.example
  const parts = useMemo(
    () => (example ? maskDictionaryExample(example) : undefined),
    [example],
  )

  if (!example || !parts) return null

  return (
    <div
      data-typing-example="visible"
      data-typing-example-revealed={revealed ? 'true' : 'false'}
      data-study-example-source={presentation.source}
      className="focus-example-cue mt-4 max-w-3xl whitespace-pre-wrap px-4 text-center font-sans text-base leading-7 sm:px-6"
    >
      {presentation.source === 'daily' && <p className="mb-1 text-xs text-slate-600 dark:text-slate-300">日常例句</p>}
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
      {answerVisible && <SyllabusExamples examples={presentation.syllabusExamples} />}
    </div>
  )
}
