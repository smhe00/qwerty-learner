/* eslint-env node */
import { circleBlobClientsEnabled, createBlobClientFactory } from './blob-clients.js'
import { profileCircleStore } from './circle/profile.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { getStore as nativeGetStore } from '@edgeone/pages-blob'
import { HandoffError } from './session-handoff-barrier.js'
import { StoppedOperationError } from './session-handoff-stopped.js'

// Request-local instrumentation only. Mutual exclusion lives in Blob, never
// this AsyncLocalStorage or an in-process Map. No client headers can bypass it.
const scopes = new AsyncLocalStorage()
const reusableGetStore = createBlobClientFactory(nativeGetStore)
const selectStore = options => circleBlobClientsEnabled() ? reusableGetStore(options) : nativeGetStore(options)
const rateLimitedContexts = new WeakSet()
export const markHandoffRateLimited = context => rateLimitedContexts.add(context)
export const wasHandoffRateLimited = context => rateLimitedContexts.has(context)
export const rawHandoffStore = options => profileCircleStore(selectStore(options))

export function getStore(options) {
  const raw = profileCircleStore(selectStore(options))
  const scope = scopes.getStore()
  if (!scope) return raw
  return new Proxy(raw, {
    get(target, property) {
      const value = Reflect.get(target, property)
      if (typeof value !== 'function') return value
      if (['get', 'getWithHeaders', 'list'].includes(property)) return value.bind(target)
      if (!['set', 'setJSON', 'delete'].includes(property)) {
        return () => { throw new HandoffError('handoff_unclassified_blob_operation') }
      }
      return (...args) => {
        if (scope.closed) throw new HandoffError('handoff_request_closed')
        scope.mutationStarted = true
        const work = Promise.resolve().then(async () => {
          if (scope.holdMs && property === 'setJSON' &&
              /\/revisions\/\d{12}\.json$/.test(args[0])) {
            const ms = scope.holdMs
            scope.holdMs = 0
            await scope.markHeld()
            await new Promise(resolve => setTimeout(resolve, ms))
          }
          return value.apply(target, args)
        })
        scope.pending.add(work)
        work.then(() => scope.pending.delete(work), () => {
          scope.failed = true
          scope.pending.delete(work)
        })
        return work
      }
    },
  })
}

export async function runHandoffScope({ holdMs = 0, markHeld, certifyStopped = false }, operation) {
  const scope = { mutationStarted: false, failed: false, pending: new Set(),
    closed: false, holdMs, markHeld }
  return scopes.run(scope, async () => {
    let output, failure, rejected = false
    try {
      output = await operation()
    } catch (error) {
      rejected = true
      failure = error
    } finally {
      // Keep ownership until every dispatched mutation settles. Closing the
      // scope then rejects detached continuations and retries before submission.
      while (scope.pending.size) await Promise.allSettled([...scope.pending])
      scope.closed = true
    }
    // A rejected provider mutation MAY still land remotely; never certify it
    // as stopped just because its Promise rejected or the handler caught it.
    if (scope.failed) throw new HandoffError('handoff_operation_outcome_unknown', failure)
    // Preserve the original scope-only error contract. Only an owning barrier
    // caller opts into the internal stopped certificate and unwraps its cause.
    if (rejected) {
      if (certifyStopped) throw new StoppedOperationError(failure)
      throw failure
    }
    return output
  })
}
