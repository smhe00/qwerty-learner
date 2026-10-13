/**
 * M3.7 explicit S1-owned rescan for previously missed/unfinished local
 * evidence. NOT scheduled from React. Caller holds mounted S1 writer lease.
 * Two databases cannot participate in one IDB transaction, so repeated
 * scans compensate for crashes between WordRecord and Outbox commits.
 */
import { db } from '@/utils/db/core'
import { loadAuth } from './auth'
import { browserDeviceId } from './device-id'
import { stageDurableAttempts } from './multi-device-outbox-idb'
import { planOutboxRecovery } from './multi-device-recovery'
import { workspaceRegistryPort } from './workspace-vault'

const CHUNK_SIZE = 64

/**
 * Never take the local WordRecord database from a different account or an
 * in-progress workspace transition. A stopped/crashed scan changes neither
 * the cloud nor the six-table V4 snapshot.
 */
export async function recoverOwnedLearningEvents(): Promise<{
  accountId: string
  deviceId: string
  scanned: number
  pending: number
}> {
  const auth = loadAuth()
  if (!auth || auth.expiresAt * 1000 <= Date.now()) {
    throw new Error('outbox-recovery-requires-active-auth')
  }
  const accountId = auth.user.userId
  const token = auth.token
  const initial = await workspaceRegistryPort.read()
  if (initial.pending || initial.active.kind !== 'account' ||
      initial.active.accountId !== accountId) {
    throw new Error('outbox-recovery-workspace-owner-mismatch')
  }
  const deviceId = browserDeviceId()
  const records = await db.wordRecords.toArray()
  const plan = planOutboxRecovery(records)
  if (plan.status !== 'ready') {
    throw new Error('outbox-recovery-' + plan.reason)
  }
  let last = null as Awaited<ReturnType<typeof stageDurableAttempts>> | null
  for (let index = 0; index < plan.events.length; index += CHUNK_SIZE) {
    const current = await workspaceRegistryPort.read()
    const still = loadAuth()
    if (current.generation !== initial.generation || current.pending ||
        current.active.kind !== 'account' ||
        current.active.accountId !== accountId ||
        !still || still.token !== token ||
        still.expiresAt * 1000 <= Date.now()) {
      throw new Error('outbox-recovery-owner-changed')
    }
    last = await stageDurableAttempts(
      accountId, deviceId, plan.events.slice(index, index + CHUNK_SIZE))
  }
  // Caller must scan again after new Learn attempts: an in-progress working
  // DB transaction can commit after this read snapshot.
  return { accountId, deviceId, scanned: plan.count,
    pending: last?.pending.length ?? 0 }
}
