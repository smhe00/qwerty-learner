import './desktop-study-illustration.css'
import { getStudyIllustration } from '@/resources/studyIllustrations'
import type { Word } from '@/typings'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Placement = { source: string; left: number; top: number; width: number }

/** A side illustration never participates in letter/meaning layout or scoring. */
export default function DesktopStudyIllustration({ word, dictId, visible }: {
  word: Word
  dictId: string
  visible: boolean
}) {
  const marker = useRef<HTMLSpanElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const illustration = getStudyIllustration(dictId, word)
  const source = illustration
    ? (REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner' : '') + illustration.path
    : undefined

  useLayoutEffect(() => {
    if (!visible || !source) {
      setPlacement(null)
      return
    }
    const anchor = marker.current?.closest<HTMLElement>('.focus-word-stack, [data-desktop-tap-practice]')
    if (!anchor) return
    let frame = 0
    const measure = () => {
      const box = anchor.getBoundingClientRect()
      const width = Math.min(208, Math.max(160, window.innerWidth * .15))
      const left = box.right + 36
      // At zoom/narrow widths retain the existing unaltered text layout.
      if (window.innerWidth < 1200 || window.innerHeight < 650 ||
        box.width === 0 || left + width > window.innerWidth - 32) {
        setPlacement(null)
        return
      }
      const top = Math.max(120, Math.min(window.innerHeight - width - 112, (box.top + box.bottom - width - 30) / 2))
      setPlacement(old => old?.source === source && old.left === left && old.top === top && old.width === width
        ? old : { source, left, top, width })
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(anchor)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    measure()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [source, visible])

  const painted = visible && illustration && source && failedSource !== source && placement?.source === source
  return <>
    <span ref={marker} hidden data-study-illustration-anchor />
    {painted && placement && createPortal(
      <figure
        className="desktop-study-illustration"
        data-desktop-study-illustration
        data-illustration-word={word.name}
        style={{ left: placement.left, top: placement.top, width: placement.width }}
        onKeyDown={event => event.stopPropagation()}
        onKeyUp={event => event.stopPropagation()}
      >
        <img key={source} src={source} width={512} height={512} alt={word.name + ' 的场景插画'}
          loading="lazy" decoding="async" onError={() => setFailedSource(source)} />
        <figcaption>
          插画：<a href="https://github.com/designfuchen/word-atlas" target="_blank" rel="noreferrer">Word Atlas contributors</a>
          <span aria-hidden="true"> · </span>
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
        </figcaption>
      </figure>, document.body,
    )}
  </>
}
