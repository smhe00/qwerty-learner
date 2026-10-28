import { atom } from 'jotai'

export type LearnInputMode = 'auto' | 'touch' | 'keyboard'
export const LEARN_INPUT_MODE_KEY = 'learnInputMode'
export const learnInputModeLabels = { auto: '自动', touch: '触控', keyboard: '键盘' } as const

function readPreference(): LearnInputMode {
  try {
    const saved = localStorage.getItem(LEARN_INPUT_MODE_KEY)
    return saved === 'touch' || saved === 'keyboard' ? saved : 'auto'
  } catch {
    return 'auto'
  }
}

// Device-local presentation only: deliberately outside workspace/cloud settings.
// Persist the user's choice, never a claim that hardware is still connected.
const preferenceAtom = atom<LearnInputMode>(readPreference())
export const learnKeyboardIntentAtom = atom({ used: false, spelling: false })
export const learnInputModeAtom = atom(
  (get) => get(preferenceAtom),
  (_get, set, mode: LearnInputMode) => {
    set(preferenceAtom, mode)
    if (mode === 'auto') set(learnKeyboardIntentAtom, (old) => ({ ...old, spelling: false }))
    try {
      localStorage.setItem(LEARN_INPUT_MODE_KEY, mode)
    } catch {
      // Storage may be unavailable; the current document still honors the choice.
    }
  },
)

export function nextLearnInputMode(mode: LearnInputMode): LearnInputMode {
  return mode === 'auto' ? 'touch' : mode === 'touch' ? 'keyboard' : 'auto'
}
