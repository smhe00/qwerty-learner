import { atom } from 'jotai'
import type { LearnExercisePreference } from '@/learn/task-selector'

// Per-app presentation intent, never a hardware-connection claim or cloud data.
export const mobileLearnInputAtom = atom<{
  preference: LearnExercisePreference
  keyboardUsed: boolean
}>({ preference: 'auto', keyboardUsed: false })
