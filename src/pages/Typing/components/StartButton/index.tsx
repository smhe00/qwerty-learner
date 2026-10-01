import { TypingContext, TypingStateActionType } from '../../store'
import Tooltip from '@/components/Tooltip'
import { currentChapterAtom, currentDictIdAtom, isReviewModeAtom, reviewModeInfoAtom } from '@/store'
import { db } from '@/utils/db'
import { autoUpdate, offset, useFloating, useHover, useInteractions } from '@floating-ui/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useContext, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'

export default function StartButton({ isLoading }: { isLoading: boolean }) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!
  const currentDictId = useAtomValue(currentDictIdAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const navigate = useNavigate()

  const reviewWordCount = useLiveQuery(
    async () => {
      const records = await db.wordRecords
        .where('dict')
        .equals(currentDictId)
        .and((record) => record.wrongCount > 0)
        .toArray()
      return new Set(records.map((record) => record.word)).size
    },
    [currentDictId],
    0,
  )
  const hasReviewWords = reviewWordCount > 0

  const onToggleIsTyping = useCallback(() => {
    !isLoading && dispatch({ type: TypingStateActionType.TOGGLE_IS_TYPING })
  }, [isLoading, dispatch])

  const onClickCloudBackup = useCallback(() => {
    window.dispatchEvent(new CustomEvent('qwerty:open-data-settings'))
  }, [])

  const onClickReview = useCallback(() => {
    if (!hasReviewWords) return
    navigate('/gallery?review=1')
  }, [hasReviewWords, navigate])

  const onClickBackToLearning = useCallback(() => {
    setCurrentChapter(0)
    setReviewModeInfo((old) => ({ ...old, isReviewMode: false }))
  }, [setCurrentChapter, setReviewModeInfo])

  useHotkeys('enter', onToggleIsTyping, { enableOnFormTags: true, preventDefault: true }, [onToggleIsTyping])

  const [isShowReStartButton, setIsShowReStartButton] = useState(false)
  const { refs, context } = useFloating({
    open: isShowReStartButton,
    onOpenChange: setIsShowReStartButton,
    whileElementsMounted: autoUpdate,
    middleware: [offset(5)],
  })
  const hoverButton = useHover(context)
  const { getReferenceProps, getFloatingProps } = useInteractions([hoverButton])

  return (
    <Tooltip content={`${state.isTyping ? '暂停' : '开始'} （Enter）`} className="box-content h-7 w-8 px-6 py-1">
      <div
        ref={refs.setReference}
        {...getReferenceProps()}
        className={`${
          state.isTyping
            ? 'bg-gray-400 shadow-gray-200 dark:bg-gray-600  dark:shadow-none'
            : 'bg-indigo-500 shadow-indigo-300 dark:shadow-indigo-500/60'
        } ${
          isShowReStartButton ? 'h-28' : 'h-auto'
        } flex-column absolute left-0 top-0 w-20 rounded-lg shadow-lg transition-colors duration-200`}
      >
        <button
          className={`${
            state.isTyping ? 'bg-gray-400  dark:bg-gray-700 dark:hover:bg-gray-500' : 'bg-indigo-500'
          } my-btn-primary w-20 shadow`}
          type="button"
          onClick={onToggleIsTyping}
          aria-label={state.isTyping ? '暂停' : '开始'}
        >
          <span className="font-medium">{state.isTyping ? '暂停' : '开始'}</span>
        </button>
        {isShowReStartButton && (
          <div className="absolute bottom-0 flex w-20 flex-col items-center justify-center" ref={refs.setFloating} {...getFloatingProps()}>
            {isReviewMode ? (
              <button
                className={`${
                  state.isTyping ? 'bg-gray-500 dark:bg-gray-700 dark:hover:bg-gray-500 ' : 'bg-indigo-400 '
                } my-btn-primary mb-1 mt-1 w-18 transition-colors duration-200`}
                type="button"
                onClick={onClickBackToLearning}
                aria-label={'返回学习'}
                title="返回普通学习，保留当前复习进度"
              >
                学习
              </button>
            ) : (
              <button
                className={`${
                  state.isTyping ? 'bg-gray-500 dark:bg-gray-700 dark:hover:bg-gray-500 ' : 'bg-indigo-400 '
                } my-btn-primary mb-1 mt-1 w-18 transition-colors duration-200 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 disabled:opacity-70 dark:disabled:bg-gray-700`}
                type="button"
                onClick={onClickReview}
                disabled={!hasReviewWords}
                aria-label={'复习错词'}
                title={hasReviewWords ? `${reviewWordCount} 个错词可复习` : '完成一些单词学习后即可复习'}
              >
                复习
              </button>
            )}
            <button
              className={`${
                state.isTyping ? 'bg-gray-500 dark:bg-gray-700 dark:hover:bg-gray-500 ' : 'bg-indigo-400 '
              } my-btn-primary mb-1 w-18 transition-colors duration-200`}
              type="button"
              onClick={onClickCloudBackup}
              aria-label={'打开云备份'}
              title="打开云端登录、上传和恢复页面"
            >
              云备份
            </button>
          </div>
        )}
      </div>
    </Tooltip>
  )
}
