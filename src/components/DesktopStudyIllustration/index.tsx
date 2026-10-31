import './desktop-study-illustration.css'
import { getStudyPresentation } from '@/resources/studyExamples'
import type { Word } from '@/typings'
import type { ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

type Layout = { source: string; size: number; paddingTop: number; imageTop: number }

/** The picture and word share one row; examples/definitions follow below. */
export default function DesktopStudyIllustration({ word, dictId, visible, answerVisible = true, children }: {
  word: Word
  dictId: string
  visible: boolean
  answerVisible?: boolean
  children: ReactNode
}) {
  const body = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const illustration = getStudyPresentation(dictId, word).illustration
  const source = illustration
    ? (REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner' : '') + illustration.path
    : undefined

  useLayoutEffect(() => {
    if (!visible || !source || failedSource === source || !body.current) {
      setLayout(null)
      return
    }
    const content = body.current
    let frame = 0
    const measure = () => {
      const token = content.querySelector<HTMLElement>('[data-typing-word], .mobile-practice-word')
      const card = content.closest<HTMLElement>('[data-desktop-tap-practice]')
      const size = card ? card.dataset.mobileTask === 'spelling' ? 96 : 128 : 176
      const available = card ? card.clientWidth - 64 : window.innerWidth - 128
      const box = token?.getBoundingClientRect()
      if (!box?.width || !box.height || window.innerWidth < 1200 || window.innerHeight < 650 ||
        content.getBoundingClientRect().width + size + 28 > available) {
        setLayout(null)
        return
      }
      const previousPadding = parseFloat(getComputedStyle(content).paddingTop) || 0
      const beforeWord = box.top - content.getBoundingClientRect().top - previousPadding
      // Align the image center with the word itself, even with a status above
      // or pronunciation/help text below the word. Round to avoid RO jitter.
      const offset = Math.round(((size - box.height) / 2 - beforeWord) * 4) / 4
      const paddingTop = Math.max(0, offset)
      const imageTop = Math.max(0, -offset)
      setLayout(old => old?.source === source && old.size === size && old.paddingTop === paddingTop && old.imageTop === imageTop
        ? old : { source, size, paddingTop, imageTop })
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(content)
    window.addEventListener('resize', schedule)
    measure()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
    }
  }, [source, visible, failedSource])

  const shown = visible && source && failedSource !== source && layout?.source === source
  return <div className="desktop-study-word-row" data-desktop-study-word-row data-has-study-image={shown || undefined}>
    {shown && layout && <figure className="desktop-study-illustration" data-desktop-study-illustration
      data-illustration-word={word.name} style={{ width: layout.size, marginTop: layout.imageTop }}>
      <img key={source} src={source} width={512} height={512}
        alt={answerVisible ? word.name + ' 的场景插画' : '单词场景插画'}
        loading="lazy" decoding="async" onError={() => setFailedSource(source)} />
    </figure>}
    <div key="word" ref={body} className="desktop-study-word-content" style={{ paddingTop: shown && layout ? layout.paddingTop : 0 }}>
      {children}
    </div>
  </div>
}
