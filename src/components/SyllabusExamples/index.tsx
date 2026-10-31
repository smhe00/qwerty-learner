import type { DictionaryExample } from '@/typings'

/** Only mount with the answer revealed; original examples are never rewritten. */
export default function SyllabusExamples({ examples, onInspect }: { examples: DictionaryExample[]; onInspect?: () => void }) {
  if (!examples.length) return null
  return (
    <details data-syllabus-examples className="mt-3 max-w-3xl text-left font-sans text-sm leading-6" onToggle={onInspect}>
      <summary className="cursor-pointer py-2 text-slate-600 dark:text-slate-300">考纲例句（{examples.length}）</summary>
      <ol tabIndex={0} aria-label="考纲原例句" className="max-h-56 space-y-3 overflow-y-auto overscroll-contain pb-2 pr-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-600 dark:focus-visible:outline-slate-300">
        {examples.map((example, index) => <li key={index} data-syllabus-example>
          <p>{example.en.slice(0, example.start)}<strong>{example.en.slice(example.start, example.end)}</strong>{example.en.slice(example.end)}</p>
          {example.cn && <p className="text-slate-600 dark:text-slate-300">{example.cn}</p>}
        </li>)}
      </ol>
    </details>
  )
}
