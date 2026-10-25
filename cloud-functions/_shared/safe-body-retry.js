/* eslint-env node */
// Isomorphic transport policy, shared by the browser and independent test
// clients. An ambiguous response/network error NEVER authorizes a replay.
const AUTH_METHODS = {
  '/api/auth/register': 'POST',
  '/api/auth/login': 'POST',
  '/api/auth/change-password': 'POST',
  '/api/auth/account': 'DELETE',
}

export function safeBodyReadFailure(path, method, status, body) {
  return AUTH_METHODS[path] === method && status === 503 &&
    body?.error === 'request_body_unavailable' &&
    body?.details?.stage === 'request-body' && body?.details?.safeToRetry === true
}

/** @template {{status: number, body?: any}} T
 * @param {() => Promise<T>} send
 * @param {{path: string, method: string, pause?: () => Promise<unknown>}} options
 * @returns {Promise<T>}
 */
export async function retrySafeBodyRequest(send, { path, method,
  pause = () => new Promise(resolve => setTimeout(resolve, 250)) }) {
  const first = await send()
  if (!safeBodyReadFailure(path, method, first.status, first.body)) return first
  await pause()
  // Exactly one retry; the second result is final even if still unavailable.
  return send()
}
