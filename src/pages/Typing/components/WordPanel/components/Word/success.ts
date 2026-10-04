export type SuccessInputDecision =
  | 'type-key'
  | 'fast-forward'
  | 'ignore'

/**
 * Keep Space semantics unambiguous across spelling and success:
 * - before input is locked, Space is an ordinary spelling character;
 * - after confirmed success, Space fast-forwards to the next item;
 * - a transient lock that is not confirmed success accepts no input.
 */
export function decideSuccessInput(input: {
  inputLocked: boolean
  isFinished: boolean
  key: string
}): SuccessInputDecision {
  if (!input.inputLocked) return 'type-key'
  if (input.isFinished && input.key === ' ') return 'fast-forward'
  return 'ignore'
}
