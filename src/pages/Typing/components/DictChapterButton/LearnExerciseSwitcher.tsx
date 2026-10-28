import { desktopLearnExerciseAtom } from '@/pages/Typing/store/learnExercise'
import { learnInputModeAtom, learnInputModeLabels, nextLearnInputMode } from '@/store/learnInputMode'
import { useAtom, useAtomValue } from 'jotai'
import { Hand, Keyboard, Wand2 } from 'lucide-react'

export default function LearnExerciseSwitcher() {
  const exercise = useAtomValue(desktopLearnExerciseAtom)
  const [mode, setMode] = useAtom(learnInputModeAtom)
  const label = learnInputModeLabels[mode]
  const next = nextLearnInputMode(mode)
  const nextLabel = learnInputModeLabels[next]
  const Icon = mode === 'auto' ? Wand2 : mode === 'touch' ? Hand : Keyboard

  return (
    <button
      type="button"
      data-learn-exercise={exercise}
      data-input-mode={mode}
      aria-label={'学习方式：' + label}
      title={'当前：' + label + '；点击切换到' + nextLabel}
      className="inline-flex h-9 w-20 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--focus-border)] bg-[var(--focus-surface-muted)] px-2 text-base font-medium text-[var(--focus-text-secondary)] transition-colors hover:border-[var(--focus-accent)] hover:bg-[var(--focus-accent-soft)] hover:text-[var(--focus-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--focus-surface)]"
      onClick={(event) => {
        setMode(next)
        // Pointer clicks return typing ownership to the learning surface;
        // keyboard activation keeps focus for the next deliberate action.
        if (event.detail > 0) event.currentTarget.blur()
      }}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}
