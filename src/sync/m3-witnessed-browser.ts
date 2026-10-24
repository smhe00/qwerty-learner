/**
 * M2/M3 read-only, account-pinned browser inspector.
 * Not invoked by React Learn, S1 transitions, V4 auto-sync or settings.
 * Pilot endpoints are OFF by default; no data mutation here.
 */
import { readChainedEventBatch, verifyWitnessedChainedEventHeads } from './api'
import { loadAuth } from './auth'
import { inspectWitnessedDeviceConvergence } from './m3-witnessed-receiver'
import type { WitnessedReceiveResult } from './m3-witnessed-receiver'
import type { ChainedReceipt } from './multi-device-outbox'
import { workspaceRegistryPort } from './workspace-vault'
import { db } from '@/utils/db/core'

export async function inspectOwnedWitnessedHistory(
  heads: ChainedReceipt[],
  options: { allowUnchanged?: boolean } = {},
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
      throw new Error('witnessed-receiver-account-changed')
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
    port: {
      assertOwner,
      verifyHeads: (requested) => verifyWitnessedChainedEventHeads(token, requested),
      read: (requested) => readChainedEventBatch(token, requested),
    },
  })
}
