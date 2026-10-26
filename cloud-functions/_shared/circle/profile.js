/* eslint-env node */
import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'
import { runtimeEnvironment } from '../runtime-environment.js'

const scopes = new AsyncLocalStorage()
const methods = new Set(['get', 'getWithHeaders', 'list', 'set', 'setJSON', 'delete'])
const elapsed = start => Math.round((performance.now() - start) * 10) / 10
function category(key) {
  if (typeof key !== 'string') return 'other'
  if (key.includes('/identity.json')) return 'identity'
  if (key.includes('/sessions/')) return 'sessions'
  if (key.includes('/independent-sessions/')) return 'revocation'
  if (key.startsWith('rate-limit/auth/')) return 'rate_counter'
  if (key.includes('/auth/')) return 'credentials'
  if (key.startsWith('maintenance/administrator/')) return 'admin_binding'
  if (key.startsWith('maintenance/idle/')) return key.includes('/days/') ? 'idle_day' : 'idle_guard'
  if (key.startsWith('maintenance/')) return 'maintenance'
  if (key.endsWith('/used.json')) return 'social_hold'
  if (key.startsWith('social/v3/')) {
    if (key.includes('/summaries/') || key.endsWith('/roster.json')) return 'circle_cache'
    if (key.includes('/days/')) return 'circle_activity'
    if (key.includes('/members/')) return 'circle_members'
    return 'circle_control'
  }
  if (key.startsWith('social/v2/')) return 'legacy'
  return 'other'
}
function startSpan(scope, kind, name, op) {
  if (scope.spans.length >= 96) { scope.truncated = true; return () => {} }
  const start = performance.now()
  const span = {kind, name, op, startMs: elapsed(scope.start), ms: 0}
  scope.spans.push(span)
  return () => { span.ms = elapsed(start) }
}
export function profileCircleStore(store) {
  const scope = scopes.getStore()
  if (!scope) return store
  const wrappers = new Map()
  return new Proxy(store, { get(target, property) {
    const value = Reflect.get(target, property, target)
    if (typeof value !== 'function') return value
    if (!methods.has(property)) return value.bind(target)
    if (!wrappers.has(property)) wrappers.set(property, (...args) => {
      const end = startSpan(scope, 'blob', category(property === 'list' ? args[0]?.prefix : args[0]), property)
      try {
        const result = Reflect.apply(value, target, args)
        if (result && typeof result.then === 'function') return result.then(v => {end();return v}, e => {end();throw e})
        end();return result
      } catch (error) { end();throw error }
    })
    return wrappers.get(property)
  }})
}
export async function timeCircleStage(name, operation) {
  const scope = scopes.getStore()
  if (!scope) return operation()
  if (!/^[a-z][a-z_]{0,35}$/.test(name)) throw new TypeError('Fixed Circle timing stage required')
  const end = startSpan(scope, 'stage', name, 'run')
  try { return await operation() } finally { end() }
}
export function profileCircleRequest(context, operation) {
  const request = context.request
  const path = new URL(request.url).pathname.replace(/^\/api(?=\/|$)/, '')
  // Timings are opt-in metadata on authenticated successful Circle responses.
  // Client URL/headers cannot enable them outside exact trusted etest.
  if (runtimeEnvironment(context.env).branch !== 'etest' ||
      !(/^\/circle\/v2(?:\/|$)/.test(path)) ||
      request.headers.get('x-qwerty-circle-timing') !== '1' ||
      !/^Bearer \S+$/i.test(request.headers.get('authorization') || '')) return operation()
  const scope = {start:performance.now(),spans:[],truncated:false}
  return scopes.run(scope, async () => {
    const response = await operation()
    if (response.status >= 200 && response.status < 300) {
      const totalMs = elapsed(scope.start)
      response.headers.set('Server-Timing', 'circle;dur=' + totalMs)
      const encode = () => Buffer.from(JSON.stringify({version:1,totalMs,spans:scope.spans,truncated:scope.truncated})).toString('base64url')
      let encoded = encode()
      while (encoded.length > 6000 && scope.spans.length) {
        scope.truncated = true
        scope.spans.pop()
        encoded = encode()
      }
      response.headers.set('X-Qwerty-Circle-Timing', encoded)
    }
    return response
  })
}
