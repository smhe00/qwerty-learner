import { Plus } from 'lucide-react'

/** Quiet, consistent secondary action on Learn completion surfaces. */
export default function FiveMoreButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label="多学五词"
      disabled={disabled}
      onClick={onClick}
      className="group inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-slate-200/90 bg-white/70 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm shadow-slate-200/30 transition-colors duration-150 hover:border-indigo-200 hover:bg-indigo-50/70 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:shadow-none dark:hover:border-indigo-700 dark:hover:bg-slate-800 dark:hover:text-indigo-300 dark:focus-visible:ring-offset-slate-900"
    >
      <Plus aria-hidden="true" className="h-3.5 w-3.5 text-indigo-400 transition-colors group-hover:text-indigo-600" />
      <span>再学 5 词</span>
    </button>
  )
}
