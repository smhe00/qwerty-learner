import { recordErrorBookAction } from '@/utils'
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import IconBook from '~icons/bxs/book'

const ErrorBookButton = ({
  disabled = false,
}: {
  disabled?: boolean
}) => {
  const navigate = useNavigate()

  const toErrorBook = useCallback(() => {
    if (disabled) return
    navigate('/error-book')
    recordErrorBookAction('open')
  }, [disabled, navigate])

  return (
    <button
      type="button"
      onClick={toErrorBook}
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={disabled ? '错题本（Learn 模式禁用）' : '查看错题本'}
      className={`flex items-center justify-center rounded p-[2px] text-lg outline-none transition-colors duration-300 ease-in-out ${
        disabled
          ? 'cursor-not-allowed text-gray-400 opacity-40'
          : 'text-indigo-500 hover:bg-indigo-400 hover:text-white'
      }`}
      title={disabled ? 'Learn 模式暂不可用' : '查看错题本'}
    >
      <IconBook className="icon" />
    </button>
  )
}

export default ErrorBookButton
