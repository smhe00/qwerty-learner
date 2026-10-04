import Tooltip from '@/components/Tooltip'
import { useNavigate } from 'react-router-dom'
import IconTrophy from '~icons/tabler/trophy'

export default function AchievementsButton() {
  const navigate = useNavigate()

  return (
    <Tooltip className="h-7 w-7" content="查看成就">
      <button
        className="p-[2px] text-lg text-indigo-500 focus:outline-none"
        type="button"
        onClick={(event) => {
          navigate('/achievements')
          event.currentTarget.blur()
        }}
        aria-label="查看成就"
      >
        <IconTrophy />
      </button>
    </Tooltip>
  )
}
