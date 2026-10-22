import { atom } from 'jotai'

// Presentation preference for this app instance only. It is not learning
// evidence and must never enter the persisted workspace or cloud backup.
export const desktopLearnExerciseAtom = atom<'spelling' | 'tap-recall'>('spelling')
