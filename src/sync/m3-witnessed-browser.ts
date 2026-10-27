/**
 * M2/M3 read-only, account-pinned browser inspector.
 * Not invoked by React Learn, S1 transitions, V4 auto-sync or settings.
 * Pilot endpoints are OFF by default; no data mutation here.
 */
import { readChainedEventBatch, verifyWitnessedChainedEventHeads } from './api'
import { loadAuth } from './auth'
import { historyCache } from './history-verification-cache'
import { createHistoryContinuation } from './history-verification-continuation'
import { recordLearningSyncDiagnostic } from './learning-sync-diagnostics'
import { inspectWitnessedDeviceConvergence } from './m3-witnessed-receiver'
import type { WitnessedReceiveResult } from './m3-witnessed-receiver'
import type { ChainedReceipt } from './multi-device-outbox'
import { startupSyncTimeRemaining } from './startup-sync-budget'
import { workspaceRegistryPort } from './workspace-vault'
import { db } from '@/utils/db/core'

export async function inspectOwnedWitnessedHistory(
  heads: ChainedReceipt[],
  options: { allowUnchanged?: boolean; onProgress?: (completed: number, total: number) => void } = {},
): Promise<WitnessedReceiveResult> {
  const auth = loadAuth()
  if (!auth || auth.expiresAt * 1000 <= Date.now()) {
    throw new Error('witnessed-receiver-auth-required')
  }
  const accountId = auth.user.userId
  const token = auth.token
  const registry = await workspaceRegistryPort.read()
  if (registry.pending || registry.active.kind !== 'account' || registry.active.accountId !== accountId || registry.generation === 0) {
    throw new Error('witnessed-receiver-account-not-mounted')
  }
  const generation = registry.generation
  const assertOwner = async (): Promise<void> => {
    const [now, current] = await Promise.all([workspaceRegistryPort.read(), Promise.resolve(loadAuth())])
    if (
      now.generation !== generation ||
      now.pending ||
      now.active.kind !== 'account' ||
      now.active.accountId !== accountId ||
      current?.user.userId !== accountId ||
      current.token !== token ||
      current.expiresAt * 1000 <= Date.now()
    ) {
      throw new Error('verification-owner-changed')
    }
  }
  await assertOwner()
  const rows = await db.wordRecords.toCollection().raw().toArray()
  await assertOwner()
  return inspectWitnessedDeviceConvergence({
    accountId,
    heads,
    localRecords: rows,
    allowUnchanged: options.allowUnchanged,
    port: await createHistoryContinuation({
      accountId,
      generation,
      heads,
      cache: historyCache,
      assertOwner,
      canContinue: startupSyncTimeRemaining,
      verify: (cursor) => verifyWitnessedChainedEventHeads(token, heads, { cursor }),
      read: (requested) => readChainedEventBatch(token, requested),
      progress: (completed, total) => {
        recordLearningSyncDiagnostic({
          stage: 'm3-witness',
          status: completed < total ? 'pending' : 'ready',
          code: completed < total ? 'verification-in-progress' : 'none',
          completed,
          total,
        })
        options.onProgress?.(completed, total)
      },
    }),
  })
}
