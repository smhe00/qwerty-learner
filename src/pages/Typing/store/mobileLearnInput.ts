import { atom } from 'jotai'
import type { LearnExercisePreference } from '@/learn/task-selector'
import { learnInputModeAtom, learnKeyboardIntentAtom } from '@/store/learnInputMode'

// Per-app presentation intent, never a hardware-connection claim or cloud data.
export const mobileLearnInputAtom = atom((get): { preference: LearnExercisePreference; keyboardUsed: boolean } => {
  const mode = get(learnInputModeAtom)
  const intent = get(learnKeyboardIntentAtom)
  return {
    preference: mode === 'touch' ? 'tap-recall' : mode === 'keyboard' || intent.spelling ? 'cold-spelling' : 'auto',
    keyboardUsed: mode === 'keyboard' || intent.used,
  }
})
