/**
 * M2.9: two-device checkout / ancestor verification gate (read-only).
 *
 * Event chain receipts alone prove which immutable attempts a device sent,
 * NOT which S2 Backup V4 revision that device checked out. A pair of
 * equal client-provided SHA-256 strings is equally insufficient.
 *
 * This gate requires a separate, independently account-authenticated
 * remote checkout verifier. The port contract MUST be implemented by a
 * server checking a persisted device-bound checkout receipt against the
 * actual account-scoped V4 revision and its digest. A caller-supplied
 * "verified" flag, claimed device ID or event head is NOT evidence.
 *
 * No such server authority is currently wired. Until then, this module is
 * a separately testable read-only boundary and grants no sync admission.
 */
import type { LocalS2PullAncestor } from './m2-pinned-s2-ancestor'
import type { ChainedReceipt } from './multi-device-outbox'
import { inspectPinnedV4FastForward } from './v4-fast-forward-preview'
import type { FullV4FastForwardPreview } from './v4-fast-forward-preview'
import { workspaceFingerprintV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'

const SHA = /^[0-9a-f]{64}$/
const DEVICE = /^qwerty-web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AuthenticatedDeviceCheckout = {
  accountId: string
  /** Device identity cryptographically bound by an authenticated verifier. */
  deviceId: string
  cloudRevision: number
  cloudFingerprint: string
  /** Exact immutable prefix witnessed by server; not proof of head completeness. */
  eventHead: ChainedReceipt
}

export type RemoteCheckoutVerifier = {
  /** Recheck account bearer, owner, S1 generation before and after every IO. */
  assertOwner(): Promise<void>
  /**
   * Server MUST check signed/receipt-bound remote checkout provenance and
   * return null when it cannot prove revision + digest + device identity.
   * No cached user-supplied "proof" is permitted.
   */
  verifyRemoteCheckout(deviceId: string): Promise<AuthenticatedDeviceCheckout | null>
  /**
   * Check this exact event head against account-owned immutable Blob bytes.
   * This proves an exact prefix, NOT all devices were enumerated.
   */
  verifyEventHead(head: ChainedReceipt): Promise<boolean>
}

export type TwoDeviceAncestorPreview =
  | { status: 'blocked'; reason: string;
      publishReady: false; convergenceComplete: false }
  | { status: 'projected';
      reason: 'two-witness-fast-forward-preview-only';
      publishReady: false; convergenceComplete: false;
      ancestorRevision: number; ancestorFingerprint: string;
      remoteDeviceId: string; remoteHead: ChainedReceipt;
      fastForward: Extract<FullV4FastForwardPreview, { status: 'projected' }> }

function blocked(reason: string): TwoDeviceAncestorPreview {
  return { status: 'blocked', reason, publishReady: false,
    convergenceComplete: false }
}
function validHead(head: ChainedReceipt, deviceId: string): boolean {
  return !!head && head.deviceId === deviceId &&
    Number.isSafeInteger(head.sequence) && head.sequence >= 1 &&
    UUID.test(head.batchId) && SHA.test(head.sha256)
}

/**
 * Proves ONLY two explicitly named devices have independently verified
 * checkouts of the same complete V4 revision, and previews safe fast-forward.
 *
 * This does not establish global head completeness, concurrent device
 * arbitration or authorization for M4 restore / cloud publication.
 */
export async function inspectTwoDevicePinnedAncestor(input: {
  accountId: string
  localDeviceId: string
  remoteDeviceId: string
  localPin: LocalS2PullAncestor | null
  local: WorkspaceSnapshotV4
  remote: WorkspaceSnapshotV4
  verifier: RemoteCheckoutVerifier
}): Promise<TwoDeviceAncestorPreview> {
  try {
    const { accountId, localDeviceId, remoteDeviceId, localPin, verifier } = input
    if (!accountId || accountId.trim() !== accountId ||
        !DEVICE.test(localDeviceId) || !DEVICE.test(remoteDeviceId) ||
        localDeviceId === remoteDeviceId) {
      return blocked('two-witness-invalid-owner-or-device')
    }
    if (!localPin || localPin.status !== 'pinned-local-s2-pull-only' ||
        localPin.accountId !== accountId ||
        localPin.publishReady !== false || localPin.convergenceComplete !== false ||
        !Number.isSafeInteger(localPin.revision) || localPin.revision < 1 ||
        !SHA.test(localPin.fingerprint)) {
      return blocked('two-witness-local-checkout-not-pinned')
    }
    await verifier.assertOwner()
    // Independently check local archive bytes; do not trust a pin's digest
    // field copied from mutable caller-owned memory.
    if (await workspaceFingerprintV4(localPin.snapshot) !== localPin.fingerprint ||
        localPin.snapshot.metadata.source.kind !== 'account' ||
        localPin.snapshot.metadata.source.accountId !== accountId) {
      return blocked('two-witness-local-archive-corrupt')
    }
    await verifier.assertOwner()
    const remoteWitness = await verifier.verifyRemoteCheckout(remoteDeviceId)
    await verifier.assertOwner()
    if (!remoteWitness ||
        remoteWitness.accountId !== accountId ||
        remoteWitness.deviceId !== remoteDeviceId ||
        !Number.isSafeInteger(remoteWitness.cloudRevision) ||
        remoteWitness.cloudRevision !== localPin.revision ||
        !SHA.test(remoteWitness.cloudFingerprint) ||
        remoteWitness.cloudFingerprint !== localPin.fingerprint ||
        !validHead(remoteWitness.eventHead, remoteDeviceId)) {
      return blocked('two-witness-independent-checkout-unverified')
    }
    const verifiedHead = await verifier.verifyEventHead(remoteWitness.eventHead)
    await verifier.assertOwner()
    if (verifiedHead !== true) {
      return blocked('two-witness-event-prefix-unverified')
    }
    const fastForward = await inspectPinnedV4FastForward({
      accountId, pinnedAncestorFingerprint: localPin.fingerprint,
      ancestor: localPin.snapshot, local: input.local, remote: input.remote,
    })
    await verifier.assertOwner()
    if (fastForward.status !== 'projected') {
      return blocked('two-witness-v4:' + fastForward.reason)
    }
    return {
      status: 'projected', reason: 'two-witness-fast-forward-preview-only',
      publishReady: false, convergenceComplete: false,
      ancestorRevision: localPin.revision,
      ancestorFingerprint: localPin.fingerprint,
      remoteDeviceId, remoteHead: { ...remoteWitness.eventHead },
      fastForward,
    }
  } catch (error) {
    return blocked('two-witness-verification-failed:' +
      (error instanceof Error ? error.message : 'unknown'))
  }
}
