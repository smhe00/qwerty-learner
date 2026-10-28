import { atom } from 'jotai'
import { learnInputModeAtom } from '@/store/learnInputMode'

// The desktop shell defaults to keyboard; a manual touch choice overrides it.
export const desktopLearnExerciseAtom = atom((get) => get(learnInputModeAtom) === 'touch' ? 'tap-recall' : 'spelling')
