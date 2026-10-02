import { recordAnalysisAction } from '@/utils'
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ChartPie from '~icons/heroicons/chart-pie-solid'

const AnalysisButton = ({
  disabled = false,
}: {
  disabled?: boolean
}) => {
  const navigate = useNavigate()

  const toAnalysis = useCallback(() => {
    if (disabled) return
    navigate('/analysis')
    recordAnalysisAction('open')
  }, [disabled, navigate])

  return (
    <button
      type="button"
      onClick={toAnalysis}
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={disabled ? '数据统计（Learn 模式禁用）' : '查看数据统计'}
      className={`flex items-center justify-center rounded p-[2px] text-lg outline-none transition-colors duration-300 ease-in-out ${
        disabled
          ? 'cursor-not-allowed text-gray-400 opacity-40'
          : 'text-indigo-500 hover:bg-indigo-400 hover:text-white'
      }`}
      title={disabled ? 'Learn 模式暂不可用' : '查看数据统计'}
    >
      <ChartPie className="icon" />
    </button>
  )
}

export default AnalysisButton
