/**
 * M2/M3 read-only, account-pinned browser inspector.
 * Not invoked by React Learn, S1 transitions, V4 auto-sync or settings.
 * Pilot endpoints are OFF by default; no data mutation here.
 */
import { db } from '@/utils/db/core'
import { readChainedEventBatch, verifyWitnessedChainedEventHeads } from './api'
import { loadAuth } from './auth'
import { inspectWitnessedDeviceConvergence } from './m3-witnessed-receiver'
import type { WitnessedReceiveResult } from './m3-witnessed-receiver'
import type { ChainedReceipt } from './multi-device-outbox'
import { workspaceRegistryPort } from './workspace-vault'

export async function inspectOwnedWitnessedHistory(
  heads: ChainedReceipt[],
): Promise<WitnessedReceiveResult> {
  const auth = loadAuth()
  if (!auth || auth.expiresAt * 1000 <= Date.now()) {
    throw new Error('witnessed-receiver-auth-required')
  }
  const accountId = auth.user.userId
  const token = auth.token
  const registry = await workspaceRegistryPort.read()
  if (registry.pending || registry.active.kind !== 'account' ||
      registry.active.accountId !== accountId || registry.generation === 0) {
    throw new Error('witnessed-receiver-account-not-mounted')
  }
  const generation = registry.generation
  const assertOwner = async (): Promise<void> => {
    const [now, current] = await Promise.all([
      workspaceRegistryPort.read(), Promise.resolve(loadAuth()),
    ])
    if (now.generation !== generation || now.pending ||
        now.active.kind !== 'account' || now.active.accountId !== accountId ||
        current?.user.userId !== accountId || current.token !== token ||
        current.expiresAt * 1000 <= Date.now()) {
      throw new Error('witnessed-receiver-account-changed')
    }
  }
  await assertOwner()
  const rows = await db.wordRecords.toArray()
  await assertOwner()
  return inspectWitnessedDeviceConvergence({
    accountId, heads, localRecords: rows,
    port: {
      assertOwner,
      verifyHeads: requested => verifyWitnessedChainedEventHeads(token, requested),
      read: requested => readChainedEventBatch(token, requested),
    },
  })
}
