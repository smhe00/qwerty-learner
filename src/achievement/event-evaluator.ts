export const VOLUNTARY_CONTINUE_WINDOW_SECONDS = 30 * 60

export const SUPPORTED_EVENT_METRICS = new Set([
  'voluntary_continue_after_session',
])

export function evaluateVoluntaryContinueAttempt(input: {
  intentAt: number
  completedSessionId: string
  currentSessionId: string
  attemptAt: number
}): number {
  if (!input.completedSessionId || !input.currentSessionId) return 0
  if (input.completedSessionId === input.currentSessionId) return 0
  if (input.attemptAt < input.intentAt) return 0
  if (
    input.attemptAt - input.intentAt >
    VOLUNTARY_CONTINUE_WINDOW_SECONDS
  ) {
    return 0
  }
  return 1
}
