import type { maskDictionaryExample } from '@/utils/dictionaryExample'
import { useEffect, useId, useRef, useState } from 'react'

/** Expand the validated example without changing whether its target is masked. */
export default function MobilePracticeExample({
  example,
  showAnswer,
  fontSize,
  expanded,
  expandable,
  onToggle,
}: {
  example: ReturnType<typeof maskDictionaryExample>
  showAnswer: boolean
  fontSize: string
  expanded: boolean
  expandable: boolean
  onToggle: () => void
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const id = useId()
  const [clipped, setClipped] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || !expandable) return
    const measure = () => {
      if (!expanded) setClipped(element.scrollHeight > element.clientHeight + 1)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [example, showAnswer, expanded, expandable])
  return (
    <>
      <p
        id={id}
        ref={ref}
        className="mobile-practice-example"
        style={{ fontSize }}
        data-mobile-example
        data-expanded={expanded || undefined}
      >
        {example.before}
        <mark className={showAnswer ? 'mobile-practice-keyword' : 'mobile-practice-blank'} data-mobile-keyword>
          {showAnswer ? example.surface : example.masked}
        </mark>
        {example.after}
      </p>
      {expandable && (clipped || expanded) && (
        <button type="button" className="mobile-example-toggle" aria-expanded={expanded} aria-controls={id} onClick={onToggle}>
          {expanded ? '收起例句' : '展开完整例句'}
        </button>
      )}
    </>
  )
}
