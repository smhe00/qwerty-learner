import { desktopLearnExerciseAtom } from '@/pages/Typing/store/learnExercise'
import { useAtom } from 'jotai'
import { Hand, Keyboard } from 'lucide-react'

export default function LearnExerciseSwitcher() {
  const [exercise, setExercise] = useAtom(desktopLearnExerciseAtom)
  const isTap = exercise === 'tap-recall'
  const label = isTap ? '轻触记忆' : '拼写记忆'
  const nextLabel = isTap ? '拼写记忆' : '轻触记忆'
  const Icon = isTap ? Hand : Keyboard

  return (
    <button
      type="button"
      data-learn-exercise={exercise}
      aria-label={'学习方式：' + label}
      title={'当前：' + label + '；点击切换到' + nextLabel}
      className="inline-flex h-9 w-20 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-[var(--focus-border)] bg-[var(--focus-surface-muted)] px-1.5 text-xs font-medium text-[var(--focus-text-secondary)] transition-colors hover:border-[var(--focus-accent)] hover:bg-[var(--focus-accent-soft)] hover:text-[var(--focus-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--focus-surface)]"
      onClick={(event) => {
        setExercise(isTap ? 'spelling' : 'tap-recall')
        // Pointer clicks return typing ownership to the learning surface;
        // keyboard activation keeps focus for the next deliberate action.
        if (event.detail > 0) event.currentTarget.blur()
      }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}
