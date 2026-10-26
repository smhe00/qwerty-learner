import { circleUnavailable, currentCircleAuth } from '@/circle/client'
import { useCircleAuth } from '@/circle/useCircleAuth'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import { Users } from 'lucide-react'
import { useContext } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export default function CircleEntry() {
  const auth = useCircleAuth()
  const unavailable = circleUnavailable()
  const typing = useContext(TypingContext)
  const location = useLocation()
  const navigate = useNavigate()
  const disabled = !auth || !!unavailable
  return (
    <button
      type="button"
      data-toolbar-trigger
      data-circle-entry
      tabIndex={-1}
      disabled={disabled}
      aria-label={disabled ? '圈子（登录后可用）' : '打开圈子'}
      title={unavailable || (auth ? '圈子 · 和同学一起坚持' : '登录后使用圈子')}
      className={
        'flex items-center justify-center rounded p-[2px] text-lg ' +
        (disabled ? 'cursor-not-allowed text-gray-400 opacity-40' : 'text-indigo-500 hover:bg-indigo-400 hover:text-white')
      }
      onClick={(event) => {
        event.stopPropagation()
        if (!currentCircleAuth() || circleUnavailable()) return
        typing?.dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: false })
        navigate('/circles', { state: { backgroundLocation: location } })
        event.currentTarget.blur()
      }}
    >
      <Users size={20} aria-hidden="true" />
    </button>
  )
}
