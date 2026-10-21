/**
 * M2.11 read-only browser bridge: S1-local pull archive + exact remote
 * server-recorded checkout declaration + server-witnessed event prefix.
 *
 * No UI, Learn, cloud Sync, M4 stage or restore calls this module.
 * Caller supplies complete local/remote V4 snapshots already acquired
 * under its own guard. The remote archive is not downloaded by this helper.
 *
 * A checkout declaration is NOT proof of current browser IndexedDB state,
 * whole-account event completeness, or safe write/merge authorization.
 */
import { readChainedDeviceCheckout, verifyWitnessedChainedEventHeads } from './api'
import type { DeviceCheckoutSelector } from './api'
import { loadAuth } from './auth'
import { browserDeviceId } from './device-id'
import { loadPinnedLocalS2PullAncestor } from './m2-pinned-s2-ancestor'
import { inspectTwoDevicePinnedAncestor } from './m2-two-device-ancestor'
import type { TwoDeviceAncestorPreview } from './m2-two-device-ancestor'
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import { workspaceRegistryPort } from './workspace-vault'

export async function inspectOwnedTwoDeviceAncestor(input: {
  remoteCheckout: DeviceCheckoutSelector
  local: WorkspaceSnapshotV4
  remote: WorkspaceSnapshotV4
}): Promise<TwoDeviceAncestorPreview> {
  const auth = loadAuth()
  const currentDevice = browserDeviceId()
  if (!auth || !auth.token || auth.expiresAt * 1000 <= Date.now()) {
    throw new Error('two-witness-account-auth-required')
  }
  const token = auth.token
  const accountId = auth.user.userId
  const registry = await workspaceRegistryPort.read()
  const generation = registry.generation
  const assertOwner = async () => {
    const [active, session] = await Promise.all([
      workspaceRegistryPort.read(), Promise.resolve(loadAuth()),
    ])
    if (active.generation !== generation || active.pending ||
        active.active.kind !== 'account' ||
        active.active.accountId !== accountId ||
        session?.token !== token ||
        session.user.userId !== accountId ||
        session.expiresAt * 1000 <= Date.now() ||
        browserDeviceId() !== currentDevice) {
      throw new Error('two-witness-account-changed')
    }
  }
  await assertOwner()
  const localPin = await loadPinnedLocalS2PullAncestor(accountId)
  await assertOwner()
  return inspectTwoDevicePinnedAncestor({
    accountId, localDeviceId: currentDevice,
    remoteDeviceId: input.remoteCheckout.deviceId,
    localPin, local: input.local, remote: input.remote,
    verifier: {
      assertOwner,
      verifyRemoteCheckout: async (deviceId) => {
        if (input.remoteCheckout.deviceId !== deviceId) return null
        const reply = await readChainedDeviceCheckout(token, input.remoteCheckout)
        if (reply.ok !== true || reply.verifiedExactReceipt !== true ||
            reply.scope !== 'device-declared-checkout-only' ||
            reply.convergenceComplete !== false ||
            reply.accountId !== accountId ||
            reply.deviceId !== deviceId ||
            !reply.eventHead || !reply.cloudFingerprint ||
            !Number.isSafeInteger(reply.cloudRevision)) return null
        return {
          accountId: reply.accountId, deviceId: reply.deviceId,
          cloudRevision: reply.cloudRevision!,
          cloudFingerprint: reply.cloudFingerprint,
          eventHead: reply.eventHead,
        }
      },
      verifyEventHead: async head => {
        const reply = await verifyWitnessedChainedEventHeads(token, [head])
        return reply.ok === true && reply.verified === true &&
          reply.publishReady === false &&
          reply.convergenceComplete === false &&
          reply.listingIsAuthoritative === false
      },
    },
  })
}
