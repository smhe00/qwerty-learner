import { timePerfStage } from './perf-diagnostics'
import { matchesStartupLocalProof, sealStartupLocalProof } from './startup-local-proof'
import type { StartupLocalProof } from './startup-local-proof'
import { executeManualSyncV2 } from './v2-manual-executor'
import type { S2ExecutionResult, SyncV2ExecutionPort } from './v2-manual-executor'
import type { RemoteSyncMeta } from './types'
import type { SyncV2Baseline } from './v2-policy'

export type StartupLocalProofPort = {
  readDigest(): Promise<string | null>
  read(): Promise<StartupLocalProof | null>
  save(proof: StartupLocalProof): Promise<unknown>
}

/** Guarded sync only; only startup may reuse evidence. The fresh authenticated
 * metadata call is mandatory, including cache hits. Manual sync and every changed/unknown state keep the
 * complete audited executor, CAS protocol and durable recovery journals. */
export async function executeStartupSyncV2(
  port: SyncV2ExecutionPort,
  cache: StartupLocalProofPort,
  options: { allowReuse?: boolean } = {},
): Promise<S2ExecutionResult> {
  await port.assertQuiescentOwner()
  if (!port.accountId.trim() || !Number.isSafeInteger(port.registryGeneration) || port.registryGeneration < 1) {
    throw Error('S2 requires a valid isolated account workspace generation')
  }
  await port.flush()
  const reads = await Promise.allSettled([
    timePerfStage('sync', 'remote-meta', () => port.getMeta()),
    port.readBaseline(),
    timePerfStage('sync', 'local-state-check', () => cache.readDigest()).catch(() => null),
    cache.read().catch(() => null),
  ])
  const failed = reads.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  const [remote, baseline, localDigest, proof] = reads.map(result => (result as PromiseFulfilledResult<unknown>).value) as [
    RemoteSyncMeta, SyncV2Baseline | null, string | null, StartupLocalProof | null,
  ]
  await port.assertQuiescentOwner()
  const unchanged = await matchesStartupLocalProof({
    proof, accountId: port.accountId, generation: port.registryGeneration, localDigest, baseline, remote,
  }).catch(() => false)
  await port.assertQuiescentOwner()
  if (options.allowReuse !== false && unchanged) {
    return timePerfStage('sync', 'startup-local-current', async () => ({ status: 'noop', revision: remote.revision }))
  }

  // Reuse the first fresh metadata read only for the initial decision. Pull
  // and merge rechecks must still perform their own real network requests.
  let firstMeta = true
  const outcome = await executeManualSyncV2({
    ...port,
    getMeta: () => {
      if (!firstMeta) return port.getMeta()
      firstMeta = false
      return Promise.resolve(remote)
    },
  })
  if (localDigest && (outcome.status === 'noop' || outcome.status === 'pushed')) {
    await port.assertQuiescentOwner()
    const next = await port.readBaseline()
    const after = await cache.readDigest().catch(() => null)
    await port.assertQuiescentOwner()
    // Only a completed full audit can seed a proof, and only while the actual
    // working content stayed unchanged across that audit and baseline commit.
    if (next && next.accountId === port.accountId && next.baseRevision === outcome.revision && next.baseRevision > 0 && after === localDigest) {
      try {
        await cache.save(await sealStartupLocalProof({
          accountId: port.accountId, generation: port.registryGeneration,
          localDigest, revision: next.baseRevision, logicalFingerprint: next.logicalFingerprint,
        }))
      } catch { /* Cache failure never changes an already verified sync result. */ }
      await port.assertQuiescentOwner()
    }
  }
  return outcome
}
