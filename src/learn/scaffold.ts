import type { LearnInteractionStrainTier } from './strain'
import type { ExerciseLetterCondition } from '@/review/condition'

export const LEARN_DYNAMIC_SCAFFOLD_POLICY_VERSION =
  'learn-dynamic-scaffold-v1.1'

export type LearnScaffoldLevel = 'S0' | 'S1' | 'S2' | 'S3'

export type LearnScaffoldPhase =
  | 'exposure'
  | 'guided'
  | 'supported'
  | 'independent'

export type LearnScaffoldDecision = {
  policyVersion: typeof LEARN_DYNAMIC_SCAFFOLD_POLICY_VERSION
  level: LearnScaffoldLevel
  strainTier: LearnInteractionStrainTier
  assistedCycles: number
  hintPosition?: number
  reasonCodes: string[]
}

export type LearnScaffoldPresentation = {
  purpose: 'training' | 'probe'
  audio: 'none' | 'automatic'
  phonetic: 'hidden' | 'visible'
  letters: ExerciseLetterCondition
}

/**
 * Learn-only adaptive difficulty controller.
 *
 * It can soften training presentation but cannot weaken the Independent
 * admission boundary. Ordinary Typing never calls or interprets this policy.
 */
export function decideLearnScaffold(input: {
  phase: LearnScaffoldPhase
  strainTier?: LearnInteractionStrainTier
  assistedCycles?: number
  hintPosition?: number
}): LearnScaffoldDecision {
  const strainTier = input.strainTier ?? 'unknown'
  const assistedCycles = Math.max(0, input.assistedCycles ?? 0)
  const hintPosition =
    input.hintPosition !== undefined &&
    Number.isInteger(input.hintPosition) &&
    input.hintPosition >= 0
      ? input.hintPosition
      : undefined
  const reasonCodes = [
    LEARN_DYNAMIC_SCAFFOLD_POLICY_VERSION,
    `strain-${strainTier}`,
  ]

  if (input.phase === 'exposure' || input.phase === 'guided') {
    return {
      policyVersion: LEARN_DYNAMIC_SCAFFOLD_POLICY_VERSION,
      level: 'S0',
      strainTier,
      assistedCycles,
      reasonCodes: [
        ...reasonCodes,
        'phase-exposure',
        'confidence-first-visible-copy',
      ],
    }
  }

  if (input.phase === 'independent') {
    return {
      policyVersion: LEARN_DYNAMIC_SCAFFOLD_POLICY_VERSION,
      level: 'S3',
      strainTier,
      assistedCycles,
      reasonCodes: [
        ...reasonCodes,
        'independent-admission-boundary',
        'scaffold-must-not-weaken-probe',
      ],
    }
  }

  const needsStrongSupport =
    assistedCycles > 0 ||
    hintPosition !== undefined ||
    strainTier === 'elevated' ||
    strainTier === 'recovery'

  return {
    policyVersion: LEARN_DYNAMIC_SCAFFOLD_POLICY_VERSION,
    level: needsStrongSupport ? 'S1' : 'S2',
    strainTier,
    assistedCycles,
    ...(hintPosition !== undefined ? { hintPosition } : {}),
    reasonCodes: [
      ...reasonCodes,
      ...(assistedCycles > 0 ? ['prior-independent-assistance'] : []),
      ...(hintPosition !== undefined
        ? [`position-targeted-support-${hintPosition}`]
        : []),
      ...(strainTier === 'elevated'
        ? ['interaction-strain-elevated']
        : []),
      ...(strainTier === 'recovery'
        ? ['interaction-strain-recovery']
        : []),
      needsStrongSupport
        ? 'supported-strong-support'
        : 'supported-light-support',
    ],
  }
}

export function getLearnScaffoldPresentation(
  level: LearnScaffoldLevel,
  options?: { hintPosition?: number },
): LearnScaffoldPresentation {
  switch (level) {
    case 'S0':
      return {
        purpose: 'training',
        audio: 'automatic',
        phonetic: 'visible',
        letters: { mode: 'all-visible' },
      }
    case 'S1': {
      const hintPosition =
        options?.hintPosition !== undefined &&
        Number.isInteger(options.hintPosition) &&
        options.hintPosition >= 0
          ? options.hintPosition
          : undefined
      return {
        purpose: 'training',
        audio: 'automatic',
        phonetic: 'visible',
        letters:
          hintPosition === undefined
            ? { mode: 'all-hidden' }
            : {
                mode: 'partial',
                visiblePositions: [hintPosition],
              },
      }
    }
    case 'S2':
      return {
        purpose: 'training',
        audio: 'none',
        phonetic: 'hidden',
        letters: { mode: 'all-hidden' },
      }
    case 'S3':
      return {
        purpose: 'probe',
        audio: 'none',
        phonetic: 'hidden',
        letters: { mode: 'all-hidden' },
      }
  }
}
