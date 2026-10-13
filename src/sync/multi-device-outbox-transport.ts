/**
 * M3.8 opt-in browser adapter for one durable chained upload.
 * Never invoked by ordinary Learn, Typing, S1 restore or V4 Sync.
 */
import { publishChainedEventBatch, readChainedEventBatch } from './api'
import { loadAuth } from './auth'
import { browserDeviceId } from './device-id'
import { confirmDurableBatch, reserveDurableBatch } from './multi-device-outbox-idb'
import { publishOneImmutableBatch } from './multi-device-outbox-publisher'
import type { EventPublicationOutcome } from './multi-device-outbox-publisher'
import { newLearningAttemptId } from '@/utils/db/attempt-identity'
import { workspaceRegistryPort } from './workspace-vault'

/**
 * The caller already holds the mounted S1 cross-tab writer lease. We also
 * pin and recheck the immutable owner, current bearer and registry generation
 * around every await, including after a server accepted a network write.
 */
export async function flushOneWitnessedOutboxBatch(input: {
  accountId: string
  deviceId: string
  token: string
}): Promise<EventPublicationOutcome> {
  const { accountId, deviceId, token } = input
  if (!accountId || !token || !deviceId) {
    throw new Error('outbox-missing-owner')
  }
  const registry = await workspaceRegistryPort.read()
  const pinnedGeneration = registry.generation

  const assertOwner = async (): Promise<void> => {
    const [now, auth] = await Promise.all([
      workspaceRegistryPort.read(), Promise.resolve(loadAuth()),
    ])
    if (now.generation !== pinnedGeneration || now.pending ||
        now.active.kind !== 'account' ||
        now.active.accountId !== accountId ||
        auth?.user.userId !== accountId ||
        auth.token !== token || auth.expiresAt * 1000 <= Date.now() ||
        browserDeviceId() !== deviceId) {
      throw new Error('outbox-owner-changed-during-upload')
    }
  }
  return publishOneImmutableBatch(accountId, {
    assertOwner,
    reserve: () => reserveDurableBatch(accountId, deviceId, newLearningAttemptId()),
    publish: batch => publishChainedEventBatch(token, batch),
    read: receipt => readChainedEventBatch(token, receipt),
    confirm: receipt => confirmDurableBatch(accountId, deviceId, receipt),
  })
}
