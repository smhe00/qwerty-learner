import Tooltip from '@/components/Tooltip'
import { useLocation, useNavigate } from 'react-router-dom'
import IconTrophy from '~icons/tabler/trophy'

export default function AchievementsButton() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <Tooltip className="h-9 w-9" content="查看成就">
      <button
        data-toolbar-trigger
        tabIndex={-1}
        className="p-[2px] text-lg text-indigo-500 focus:outline-none"
        type="button"
        onClick={(event) => {
          navigate('/achievements', { state: { backgroundLocation: location } })
          event.currentTarget.blur()
        }}
        aria-label="查看成就"
      >
        <IconTrophy />
      </button>
    </Tooltip>
  )
}
