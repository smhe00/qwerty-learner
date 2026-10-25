/* eslint-env node */
// Private, request-scoped bytes only. No clone()/tee(), client-controlled bypass,
// global credential cache, or fallback read after an ambiguous receive error.
// The original router still performs its ordinary size/length/JSON checks.
const bodies = new WeakMap()

export function receiveHandoffAuthBody(request) {
  if (!bodies.has(request)) {
    bodies.set(request, Promise.resolve().then(() => request.arrayBuffer()))
  }
  return bodies.get(request)
}

export function bufferedHandoffAuthBody(request) {
  return bodies.get(request)
}
