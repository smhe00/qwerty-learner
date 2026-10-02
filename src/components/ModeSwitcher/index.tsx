import { currentChapterAtom, reviewModeInfoAtom } from '@/store'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export default function ModeSwitcher() {
  const navigate = useNavigate()
  const location = useLocation()
  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const setCurrentChapter = useSetAtom(currentChapterAtom)

  const isLearn =
    location.pathname.startsWith('/learn') || reviewModeInfo.isReviewMode

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

  return (
    <div
      className="flex rounded-lg bg-gray-100 p-0.5 text-sm dark:bg-gray-700"
      role="group"
      aria-label="学习模式"
    >
      <button
        type="button"
        onClick={enterTyping}
        aria-pressed={!isLearn}
        className={`rounded-md px-3 py-1.5 transition-colors ${
          !isLearn
            ? 'bg-white font-medium text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300'
            : 'text-gray-500 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white'
        }`}
      >
        Typing
      </button>
      <button
        type="button"
        onClick={enterLearn}
        aria-pressed={isLearn}
        className={`rounded-md px-3 py-1.5 transition-colors ${
          isLearn
            ? 'bg-white font-medium text-emerald-600 shadow-sm dark:bg-gray-800 dark:text-emerald-300'
            : 'text-gray-500 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white'
        }`}
      >
        Learn
      </button>
    </div>
  )
}
