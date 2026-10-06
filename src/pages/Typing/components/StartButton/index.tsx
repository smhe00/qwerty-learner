import { TypingContext, TypingStateActionType } from '../../store'
import Tooltip from '@/components/Tooltip'
import { shouldIgnoreTypingKeyEvent } from '@/utils'
import { useCallback, useContext } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

export default function StartButton({
  isLoading,
}: {
  isLoading: boolean
}) {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!

  const onToggleIsTyping = useCallback(() => {
    if (!isLoading) {
      dispatch({ type: TypingStateActionType.TOGGLE_IS_TYPING })
    }
  }, [isLoading, dispatch])

  useHotkeys(
    'enter',
    (event) => {
      if (shouldIgnoreTypingKeyEvent(event)) return
      event.preventDefault()
      onToggleIsTyping()
    },
    { enableOnFormTags: false, preventDefault: false },
    [onToggleIsTyping],
  )

  return (
    <Tooltip
      content={`${state.isTyping ? '暂停' : '开始'} （Enter）`}
      className="shrink-0"
    >
      <button
        className={`my-btn-primary w-20 shadow ${
          state.isTyping
            ? 'bg-gray-400 shadow-gray-200 dark:bg-gray-700 dark:shadow-none dark:hover:bg-gray-500'
            : 'bg-indigo-500 shadow-indigo-300 dark:shadow-indigo-500/60'
        }`}
        type="button"
        onClick={onToggleIsTyping}
        aria-label={state.isTyping ? '暂停' : '开始'}
      >
        <span className="font-medium">
          {state.isTyping ? 'Pause' : 'Start'}
        </span>
      </button>
    </Tooltip>
  )
}
