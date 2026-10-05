export type SuccessAudioGateState = {
  minFeedbackElapsed: boolean
  audioStarted: boolean
  audioSettled: boolean
  audioUnavailable: boolean
  timeoutExpired: boolean
  fastForward: boolean
}

export function isOwnedAudioEvent(
  currentOwnerKey: string,
  eventOwnerKey: string,
): boolean {
  return currentOwnerKey === eventOwnerKey
}

export function shouldReleaseSuccessFeedback(
  state: SuccessAudioGateState,
): boolean {
  if (state.fastForward) return true
  if (!state.minFeedbackElapsed) return false

  return (
    state.audioSettled ||
    state.audioUnavailable ||
    state.timeoutExpired
  )
}
