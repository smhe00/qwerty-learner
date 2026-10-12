import { currentChapterAtom, reviewModeInfoAtom } from '@/store'
import { useSetAtom } from 'jotai'
import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export default function ModeSwitcher() {
  const navigate = useNavigate()
  const location = useLocation()
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const setCurrentChapter = useSetAtom(currentChapterAtom)

  // The URL, not a possibly stale persisted Learn record, owns the visible mode.
  // An explicit /typing deep link must never appear selected as Learn.
  const isLearn = location.pathname.startsWith('/learn')

  const enterTyping = useCallback(() => {
    setReviewModeInfo((old) => ({
      ...old,
      isReviewMode: false,
    }))
    setCurrentChapter((chapter) => (chapter < 0 ? 0 : chapter))
    navigate('/typing')
  }, [navigate, setCurrentChapter, setReviewModeInfo])

  const enterLearn = useCallback(() => {
    navigate('/learn')
  }, [navigate])

  const activeClass = 'focus-mode-active'
  const inactiveClass = 'focus-mode-idle'
  const buttonClass =
    'flex min-h-10 items-center justify-center gap-1.5 rounded-lg ' +
    'px-3 py-2 text-sm font-medium transition-colors duration-150 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ' +
    'focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900'

  return (
    <div
      className="focus-mode-group inline-flex shrink-0 items-stretch gap-1 rounded-xl p-1"
      role="group"
      aria-label="练习模式切换"
      data-current-mode={isLearn ? 'learn' : 'typing'}
    >
      <button
        type="button"
        onClick={enterTyping}
        aria-label="Typing"
        aria-pressed={!isLearn}
        title={!isLearn ? '当前模式：Typing 打字练习' : '切换到 Typing 打字练习'}
        data-mode-option="typing"
        className={`${buttonClass} ${!isLearn ? activeClass : inactiveClass}`}
      >
        <span>Typing</span>
        <span className="text-xs font-medium">打字</span>
        {!isLearn && (
          <span aria-hidden="true" className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] leading-none dark:bg-slate-950/15">
            当前
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={enterLearn}
        aria-label="Learn"
        aria-pressed={isLearn}
        title={isLearn ? '当前模式：Learn 学习记忆' : '切换到 Learn 学习记忆'}
        data-mode-option="learn"
        className={`${buttonClass} ${isLearn ? activeClass : inactiveClass}`}
      >
        <span>Learn</span>
        <span className="text-xs font-medium">学习</span>
        {isLearn && (
          <span aria-hidden="true" className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] leading-none dark:bg-slate-950/15">
            当前
          </span>
        )}
      </button>
    </div>
  )
}
