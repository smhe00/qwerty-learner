import { timePerfStage } from './perf-diagnostics'
import { matchesStartupCloudBaseline, sealStartupLocalProof } from './startup-local-proof'
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

export type StartupSyncResult = S2ExecutionResult | { status: 'upload-deferred'; revision: number }

/** Guarded sync only; only startup may reuse evidence. The fresh authenticated
 * metadata call is mandatory, including cache hits. An unchanged cloud baseline
 * retains local edits until a scheduled/explicit sync. Every changed/unknown
 * cloud state keeps the complete audited executor and recovery journals. */
export async function executeStartupSyncV2(
  port: SyncV2ExecutionPort,
  cache: StartupLocalProofPort,
  options: { allowReuse?: boolean } = {},
): Promise<StartupSyncResult> {
  await port.assertQuiescentOwner()
  if (!port.accountId.trim() || !Number.isSafeInteger(port.registryGeneration) || port.registryGeneration < 1) {
    throw Error('S2 requires a valid isolated account workspace generation')
  }
  await port.flush()
  const reads = await Promise.allSettled([
    timePerfStage('sync', 'remote-meta', () => port.getMeta()),
    port.readBaseline(),
  ])
  const failed = reads.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  const [remote, baseline] = reads.map(result => (result as PromiseFulfilledResult<unknown>).value) as [
    RemoteSyncMeta, SyncV2Baseline | null,
  ]
  await port.assertQuiescentOwner()
  if (options.allowReuse !== false && matchesStartupCloudBaseline(port.accountId, baseline, remote)) {
    // No local scan is needed: both clean and edited local data stay here.
    // This is not proof of equality. Do not update the baseline or mark synced.
    return timePerfStage('sync', 'startup-upload-deferred', async () => ({ status: 'upload-deferred', revision: remote.revision }))
  }

  // Changed/unknown cloud and explicit sync retain the full data audit.
  const localDigest = await timePerfStage('sync', 'local-state-check', () => cache.readDigest()).catch(() => null)
  await port.assertQuiescentOwner()

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
