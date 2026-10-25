/* eslint-env node */
import { BeforeMutationError, HandoffError } from './session-handoff-barrier.js'

// Explicit inventory: a newly exported service method fails construction until
// its authority-changing effects have been reviewed. Do not infer safety from
// names such as get/read or silently expose an unguarded fallback.
const READ_METHODS = new Set([
  'me', 'readLearningBatch', 'observeLearningBatchReceipts',
  'readChainedLearningBatch', 'readChainedCheckout',
  'verifyChainedLearningHistory', 'verifyWitnessedChainSet',
  'observeChainedLearningReceipts', 'syncMeta', 'getSync',
  'getSyncV4BinaryManifest', 'getSyncV4BinaryPart',
])
const WRITE_METHODS = new Set([
  'changePassword', 'revokeSession', 'publishLearningBatch',
  'publishChainedLearningBatch', 'issueChainedCheckout', 'deleteAccount',
  'putSync', 'putSyncV4', 'putSyncV4Recovery', 'putSyncV4Binary',
  'putSyncV4BinaryRecovery', 'migrateSyncV4Binary',
])
const READ_STORAGE = new Set([
  'getAccount', 'getLatestAuth', 'getLatestSession', 'getIndependentSession',
  'getSessionRevocation', 'getImmutableEventBatch', 'observeImmutableEventBatches',
  'getImmutableChainedBatch', 'observeImmutableChainedBatches',
  'getImmutableDeviceCheckout', 'getV4UploadPart', 'getLatestRevisionMeta',
  'getLatestRevision', 'getBinaryRevisionPart', 'getAuthRateLimitCounter',
  'getLastV4RevisionTiming',
])

/**
 * Integrates the actual backend methods, not a test-only wrapping convention.
 * Must be enabled consistently for ALL authoritative writers before cutover.
 * This does not coordinate direct gateway writes, Circle or idle maintenance;
 * those remain explicit deployment blockers, not implicit exemptions.
 */
export function createGuardedBackendService(factory, settings, barrier) {
  if (!barrier || typeof barrier.execute !== 'function') {
    throw new HandoffError('handoff_atomic_store_required')
  }
  if (settings.multiSessionEnabled) {
    throw new HandoffError('handoff_requires_single_session')
  }
  if (typeof factory !== 'function' || !settings.storage) {
    throw new HandoffError('handoff_invalid_configuration')
  }
  const base = factory(settings)
  const quiet = factory({ ...settings, activityGuard: null,
    registrationGuard: null, handoffPreflight: true })
  for (const name of Object.keys(base)) {
    if (!READ_METHODS.has(name) && !WRITE_METHODS.has(name) &&
        !['login', 'register', 'cleanupTestUser'].includes(name)) {
      throw new HandoffError('handoff_unclassified_service_method')
    }
  }

  async function principal(name, args) {
    const value = name === 'login'
      ? await quiet.preflightLogin(args[0], args[1])
      : name === 'register'
        ? await quiet.preflightRegister(args[0], args[1])
        : await quiet.preflightToken(args[0])
    if (!value || !/^[a-f0-9]{64}$/.test(value.accountHash || '') ||
        (value.accountId !== null && !/^[a-f0-9]{32}$/.test(value.accountId || ''))) {
      throw new HandoffError('handoff_invalid_principal')
    }
    return value
  }

  async function execute(name, args) {
    // Invalid credentials never create a pending takeover or a lock entry.
    const admitted = await principal(name, args)
    const kind = ['login', 'register', 'changePassword', 'deleteAccount',
      'revokeSession'].includes(name) ? 'handoff' : 'writer'
    return barrier.execute(admitted.accountHash, kind, async () => {
      let mutationStarted = false
      let mutationFailed = false
      let activityIdentity = null
      const pending = new Set()
      function mutation(operation) {
        mutationStarted = true
        const work = Promise.resolve().then(operation)
        pending.add(work)
        // Observe even errors swallowed by existing bestEffortPrune(). A
        // successful outer call is NOT evidence that cleanup writes settled.
        work.then(() => pending.delete(work), () => {
          mutationFailed = true
          pending.delete(work)
        })
        return work
      }
      const storage = new Proxy(settings.storage, {
        get(target, property) {
          const value = Reflect.get(target, property)
          if (typeof value !== 'function') return value
          if (READ_STORAGE.has(property)) return value.bind(target)
          // Unrecognized storage operations are conservatively mutations.
          return (...parameters) => mutation(() => value.apply(target, parameters))
        },
      })
      const credentials = settings.credentials?.authorize
        ? { ...settings.credentials,
          authorize: identity => mutation(() => settings.credentials.authorize(identity)) }
        : settings.credentials
      const service = factory({ ...settings, storage, credentials,
        handoffPreflight: false,
        // Record activity only after actual validation succeeds, under the
        // same barrier. A wrong password/invalid payload cannot strand a lock
        // merely because authenticate() ordinarily touches idle metadata.
        activityGuard: async identity => { activityIdentity = identity },
        registrationGuard: settings.registrationGuard
          ? hash => mutation(() => settings.registrationGuard(hash)) : null,
      })
      try {
        // Preflight is advisory, never permission to bypass in-gate auth. A
        // login may have won between admission checks and barrier ownership.
        const current = await principal(name, args)
        if (current.accountHash !== admitted.accountHash ||
            current.accountId !== admitted.accountId) {
          throw new HandoffError('handoff_identity_changed')
        }
        const result = await service[name](...args)
        while (pending.size) await Promise.allSettled([...pending])
        if (mutationFailed) throw new HandoffError('handoff_operation_outcome_unknown')
        if (activityIdentity && settings.activityGuard) {
          await mutation(() => settings.activityGuard(activityIdentity))
        }
        return result
      } catch (error) {
        // Drain any tracked calls before unwinding; a failure still poisons the
        // barrier, because a provider timeout can hide an eventual side effect.
        while (pending.size) await Promise.allSettled([...pending])
        if (!mutationStarted) throw new BeforeMutationError(error)
        throw error
      }
    })
  }

  const guarded = {}
  for (const name of Object.keys(base)) {
    if (READ_METHODS.has(name)) {
      // A read API can still write activity metadata. Include that whole
      // request in the drain barrier rather than silently disabling valid
      // activity tracking or launching an old-session write after takeover.
      // Truly read-only instances retain every token/identity check.
      guarded[name] = settings.activityGuard
        ? (...args) => execute(name, args)
        : (...args) => quiet[name](...args)
    }
    else if (name === 'cleanupTestUser') {
      // This helper has no authenticated principal; keep it out of the pilot.
      guarded[name] = async () => { throw new HandoffError('handoff_unguarded_cleanup_disabled') }
    } else guarded[name] = (...args) => execute(name, args)
  }
  return Object.freeze(guarded)
}
