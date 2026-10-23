import type { WordFinishResult } from '../components/WordPanel/components/Word'
import type { LearnExerciseKind } from '@/learn/task-selector'
import type { ExerciseConditionV1 } from '@/review/condition'
import type { ReviewPolicyDecisionV1 } from '@/review/decision'
import type { ReviewOutcome } from '@/review/types'
import type { LearningContextV1 } from '@/utils/db/record'
import { atom, useAtom } from 'jotai'
import type { PrimitiveAtom } from 'jotai'
import { useCallback, useMemo } from 'react'
import type { SetStateAction } from 'react'

export type PendingRecallAttempt = {
  condition: ExerciseConditionV1
  learningContext: LearningContextV1
  policyDecision: ReviewPolicyDecisionV1
  grade: ReviewOutcome
}
export type SavedAttempt = { result: WordFinishResult; title: string; autoAdvance: boolean }
type Draft = {
  revealedAttempt: PendingRecallAttempt | null
  feedback: SavedAttempt | null
  isSaving: boolean
  manualExercise: 'tap-recall' | 'cold-spelling' | null
  pendingSpelling: string | null
  spellingInput: string
  error: string
  frozenTask: LearnExerciseKind | null
}
const initial = (): Draft => ({
  revealedAttempt: null,
  feedback: null,
  isSaving: false,
  manualExercise: null,
  pendingSpelling: null,
  spellingInput: '',
  error: '',
  frozenTask: null,
})
// UI only: never localStorage/IndexedDB/cloud data. A full document replacement
// (including the account handoff) discards this cache. Bound retained cards.
const drafts = new Map<string, PrimitiveAtom<Draft>>()
function getDraft(key: string) {
  let value = drafts.get(key)
  if (!value) {
    if (drafts.size >= 24) drafts.delete(drafts.keys().next().value as string)
    value = atom(initial())
    drafts.set(key, value)
  }
  return value
}
export function useMobilePracticeDraft(key?: string) {
  const draftAtom = useMemo(() => (key ? getDraft(key) : atom(initial())), [key])
  const [draft, setDraft] = useAtom(draftAtom)
  const setters = useMemo(() => {
    const field =
      <K extends keyof Draft>(name: K) =>
      (value: SetStateAction<Draft[K]>) =>
        setDraft((old) => ({
          ...old,
          [name]: typeof value === 'function' ? (value as (previous: Draft[K]) => Draft[K])(old[name]) : value,
        }))
    return {
      setRevealedAttempt: field('revealedAttempt'),
      setFeedback: field('feedback'),
      setIsSaving: field('isSaving'),
      setManualExercise: field('manualExercise'),
      setPendingSpelling: field('pendingSpelling'),
      setSpellingInput: field('spellingInput'),
      setError: field('error'),
      setFrozenTask: field('frozenTask'),
    }
  }, [setDraft])
  const discard = useCallback(() => {
    if (key && drafts.get(key) === draftAtom) drafts.delete(key)
  }, [key, draftAtom])
  return { ...draft, ...setters, discard }
}
