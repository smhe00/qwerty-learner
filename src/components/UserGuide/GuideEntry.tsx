import './user-guide.css'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import { BookOpen } from 'lucide-react'
import { useContext } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export default function GuideEntry({ text = false, section, beforeOpen }: { text?: boolean; section?: string; beforeOpen?: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const typing = useContext(TypingContext)
  return (
    <button
      type="button"
      data-guide-entry={text ? 'text' : 'toolbar'}
      data-toolbar-trigger={text ? undefined : true}
      tabIndex={text ? undefined : -1}
      aria-label="使用指南"
      title="使用指南"
      className={text ? 'user-guide-text-entry' : 'flex items-center justify-center rounded p-[2px] text-lg text-indigo-500'}
      onClick={(event) => {
        event.stopPropagation()
        beforeOpen?.()
        typing?.dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: false })
        navigate('/guide' + (section ? '#' + section : ''), { state: { backgroundLocation: location } })
        event.currentTarget.blur()
      }}
    >
      {text ? '使用指南' : <BookOpen size={20} aria-hidden="true" />}
    </button>
  )
}
