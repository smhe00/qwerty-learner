import { TypingContext, TypingStateActionType } from '../../store'
import SessionControl from '@/components/SessionControl'
import { useCallback, useContext } from 'react'

export default function SessionButton({ isLoading }: { isLoading: boolean }) {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!
  const onToggle = useCallback(() => {
    if (!isLoading && !state.isFinished) {
      dispatch({ type: TypingStateActionType.TOGGLE_IS_TYPING })
    }
  }, [dispatch, isLoading, state.isFinished])
  if (state.isFinished) return null

  const started = state.timerData.time || state.chapterData.correctCount || state.chapterData.wrongCount
  return (
    <SessionControl
      active={state.isTyping}
      disabled={isLoading}
      label={state.isTyping ? '暂停' : started ? '继续' : '开始'}
      onToggle={onToggle}
    />
  )
}
