/* eslint-env node */
import { randomUUID } from 'node:crypto'

/**
 * EXPERIMENTAL: not connected to the production gateway.
 *
 * store.transact(key, update) MUST durably and atomically apply a synchronous
 * update across ALL service instances. update returns { state, result }.
 * A Blob read/set, process-local mutex, or expiring lock is NOT this contract.
 * No in-memory production fallback is provided. Deployment requires a real
 * qualified adapter and routing ALL relevant mutations through this barrier.
 *
 * No lease expiry: a crashed/ambiguous writer deliberately prevents takeover.
 * A request deadline only cancels admission; it never releases a running write.
 */
export class HandoffError extends Error {
  constructor(code, cause) {
    super(code, cause ? { cause } : undefined)
    this.name = 'HandoffError'
    this.code = code
    this.statusCode = code === 'handoff_busy' || code === 'handoff_draining' ||
      code === 'handoff_timeout' ? 409 : 503
  }
}

// Only a server-side caller that PROVES no mutation began may use this error.
// Never classify a network failure or arbitrary HTTP 4xx as safe automatically.
export class BeforeMutationError extends Error {
  constructor(cause) {
    super('Operation rejected before any mutation', { cause })
    this.name = 'BeforeMutationError'
  }
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fresh = () => ({ version: 1, active: null, pending: null, blocked: null, closed: {} })

/** Pure transition; the provider must execute this INSIDE its transaction. */
export function transitionHandoff(current, command) {
  const { action, id, kind } = command || {}
  if (!ID.test(id || '') || !['writer', 'handoff'].includes(kind) ||
      !['enter', 'cancel', 'finish', 'block'].includes(action)) {
    throw new HandoffError('handoff_invalid_command')
  }
  const state = current === null ? fresh() : structuredClone(current)
  if (!state || state.version !== 1 || !state.closed ||
      Array.isArray(state.closed) || typeof state.closed !== 'object' ||
      !Object.hasOwn(state, 'active') || !Object.hasOwn(state, 'pending') ||
      !Object.hasOwn(state, 'blocked')) throw new HandoffError('handoff_invalid_state')
  for (const owner of [state.active, state.pending]) {
    if (owner !== null && (!owner || !ID.test(owner.id || '') ||
        !['writer', 'handoff'].includes(owner.kind))) {
      throw new HandoffError('handoff_invalid_state')
    }
  }
  if (state.pending && state.pending.kind !== 'handoff') {
    throw new HandoffError('handoff_invalid_state')
  }
  const result = status => ({ state, result: { status } })
  const close = status => {
    state.closed[id] = { kind, status }
    return result(status)
  }
  const terminal = state.closed[id]
  if (terminal) {
    if (terminal.kind !== kind) throw new HandoffError('handoff_operation_reused')
    return result(terminal.status)
  }
  if ((state.active?.id === id && state.active.kind !== kind) ||
      (state.pending?.id === id && state.pending.kind !== kind)) {
    throw new HandoffError('handoff_operation_reused')
  }
  if (state.blocked) return result('blocked')

  if (action === 'cancel') {
    // Only called by execute() BEFORE invoking the business callback. A closed
    // receipt prevents a delayed/retried enter RPC from resurrecting this ID.
    if (state.pending?.id === id) state.pending = null
    if (state.active?.id === id) state.active = null
    return close('cancelled')
  }
  if (action === 'finish' || action === 'block') {
    if (state.active?.id !== id) throw new HandoffError('handoff_not_owner')
    if (action === 'block') {
      state.blocked = { id, reason: 'operation-outcome-unknown' }
      return result('blocked')
    }
    state.active = null
    return close('done')
  }
  if (state.active?.id === id) return result('granted')
  if (kind === 'writer' && state.pending) return close('draining')
  if (kind === 'handoff') {
    if (state.pending && state.pending.id !== id) return close('busy')
    if (state.active) {
      state.pending = { id, kind }
      return result('waiting')
    }
    state.pending = null
  } else if (state.active) {
    return close('busy')
  }
  state.active = { id, kind }
  return result('granted')
}

export function createSessionHandoffBarrier({
  store, namespace, admissionTimeoutMs = 10_000, pollMs = 50,
  clock = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!store || typeof store.transact !== 'function') {
    throw new HandoffError('handoff_atomic_store_required')
  }
  if (typeof namespace !== 'string' || !/^[a-zA-Z0-9_-]{3,64}$/.test(namespace) ||
      !Number.isFinite(admissionTimeoutMs) || admissionTimeoutMs < 0 ||
      !Number.isFinite(pollMs) || pollMs <= 0 ||
      typeof clock !== 'function' || typeof sleep !== 'function') {
    throw new HandoffError('handoff_invalid_configuration')
  }
  return Object.freeze({
    async execute(accountHash, kind, operation) {
      if (!/^[a-f0-9]{64}$/.test(accountHash || '') ||
          !['writer', 'handoff'].includes(kind) || typeof operation !== 'function') {
        throw new HandoffError('handoff_invalid_operation')
      }
      const key = `${namespace}:${accountHash}`
      const id = randomUUID()
      const deadline = clock() + admissionTimeoutMs
      const step = async action => {
        try {
          const result = await store.transact(key,
            state => transitionHandoff(state, { action, id, kind }))
          if (!result || !['granted', 'waiting', 'busy', 'draining',
            'blocked', 'done', 'cancelled'].includes(result.status)) {
            throw new HandoffError('handoff_invalid_store_result')
          }
          return result.status
        } catch (error) {
          // The transaction MAY have committed. Do not execute the callback,
          // assume the barrier is absent, or opportunistically clear ownership.
          throw new HandoffError('handoff_state_unavailable', error)
        }
      }
      for (;;) {
        const status = await step('enter')
        if (status === 'granted') break
        if (status !== 'waiting') throw new HandoffError(`handoff_${status}`)
        if (clock() >= deadline) {
          const cancelled = await step('cancel')
          if (cancelled !== 'cancelled') throw new HandoffError('handoff_cancel_unconfirmed')
          throw new HandoffError('handoff_timeout')
        }
        await sleep(Math.min(pollMs, Math.max(0, deadline - clock())))
      }
      let output
      try {
        // No Promise.race/timeout and no finally-unlock around a cloud write.
        // The callback must await ALL effects; detached writes are forbidden.
        output = await operation()
      } catch (error) {
        if (error instanceof BeforeMutationError) {
          if (await step('finish') !== 'done') throw new HandoffError('handoff_release_unconfirmed')
          throw error.cause
        }
        await step('block')
        throw error
      }
      if (await step('finish') !== 'done') throw new HandoffError('handoff_release_unconfirmed')
      return output
    },
  })
}
