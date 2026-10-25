/* eslint-env node */
// Server-internal outcome, issued ONLY by a closed request scope after all
// dispatched mutations acknowledged completion. Business success is not needed.
// A client timeout or rejected provider write is NOT proof of stopped execution.
export class StoppedOperationError extends Error {
  constructor(cause) {
    super('Operation ended with its write scope closed', { cause })
    this.name = 'StoppedOperationError'
  }
}
