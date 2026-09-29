export const EXERCISE_CONDITION_VERSION = 1 as const

export type ExercisePurpose = 'training' | 'probe'
export type ExerciseConditionSource = 'user-settings' | 'adaptive-policy'
export type ExerciseAudioCondition = 'none' | 'automatic'
export type ExerciseVisibility = 'hidden' | 'visible'
export type ExerciseLetterMode = 'all-visible' | 'all-hidden' | 'partial' | 'targeted-mask'
export type ExerciseProbeDimension = 'none' | 'audio' | 'orthography' | 'meaning'

export type ExerciseLetterCondition = {
  mode: ExerciseLetterMode
  visiblePositions?: number[]
  maskedPositions?: number[]
}

export type ExerciseConditionV1 = {
  version: typeof EXERCISE_CONDITION_VERSION
  purpose: ExercisePurpose
  source: ExerciseConditionSource
  audio: ExerciseAudioCondition
  meaning: ExerciseVisibility
  phonetic: ExerciseVisibility
  letters: ExerciseLetterCondition
  probeDimension: ExerciseProbeDimension
}

export type BaselineExerciseConditionInput = {
  pronunciationEnabled: boolean
  meaningVisible: boolean
  phoneticVisible: boolean
  letterVisibility: boolean[]
}

/**
 * Captures the presentation selected by the existing user settings.
 *
 * This is intentionally a pure baseline policy: it records current behaviour
 * without introducing adaptive presentation changes.
 */
export function createBaselineExerciseCondition(
  input: BaselineExerciseConditionInput,
): ExerciseConditionV1 {
  const visiblePositions: number[] = []
  const maskedPositions: number[] = []

  input.letterVisibility.forEach((visible, index) => {
    if (visible) visiblePositions.push(index)
    else maskedPositions.push(index)
  })

  let mode: ExerciseLetterMode = 'all-visible'
  if (input.letterVisibility.length > 0 && visiblePositions.length === 0) {
    mode = 'all-hidden'
  } else if (maskedPositions.length > 0) {
    mode = 'partial'
  }

  return {
    version: EXERCISE_CONDITION_VERSION,
    purpose: 'training',
    source: 'user-settings',
    audio: input.pronunciationEnabled ? 'automatic' : 'none',
    meaning: input.meaningVisible ? 'visible' : 'hidden',
    phonetic: input.phoneticVisible ? 'visible' : 'hidden',
    letters:
      mode === 'partial'
        ? {
            mode,
            visiblePositions,
            maskedPositions,
          }
        : { mode },
    probeDimension: 'none',
  }
}
