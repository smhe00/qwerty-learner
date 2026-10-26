// No database/auth imports: this runs before the guarded first-visit bootstrap.
const KEY = 'qwerty.feedback.recovery.v1'
const valid = (value: string | null) => (value && /^[a-f0-9]{64}$/.test(value) ? value : null)
export function captureFeedbackRecoveryLink(): void {
  const secret = /^#feedback=([a-f0-9]{64})$/.exec(window.location.hash)?.[1]
  if (!secret) return
  // A same-URL replace with a fragment may only navigate within the document.
  // Keep the credential through the required bootstrap reload, without putting
  // it in a query/referrer, learning settings, or the server request URL.
  sessionStorage.setItem(KEY, secret)
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
}
export function pendingFeedbackRecovery(): string | null {
  return valid(sessionStorage.getItem(KEY))
}
export function finishFeedbackRecovery(): void {
  sessionStorage.removeItem(KEY)
}
