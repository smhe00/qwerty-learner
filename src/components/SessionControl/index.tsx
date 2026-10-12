import { Pause, Play } from 'lucide-react'

export default function SessionControl({
  active,
  onToggle,
  disabled = false,
  label = active ? '暂停' : '继续',
}: {
  active: boolean
  onToggle: () => void
  disabled?: boolean
  label?: string
}) {
  const Icon = active ? Pause : Play
  return (
    <button
      type="button"
      data-session-control
      aria-label={label}
      aria-keyshortcuts="Enter"
      title={active ? '暂停（Enter）' : label + '（Enter 或任意练习键）'}
      disabled={disabled}
      onClick={(event) => {
        if (!active) event.currentTarget.blur()
        onToggle()
      }}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only" role="status">
        {active ? '练习进行中' : label.includes('开始') ? '练习已就绪，按任意练习键开始' : '练习已暂停，按任意练习键继续'}
      </span>
    </button>
  )
}
