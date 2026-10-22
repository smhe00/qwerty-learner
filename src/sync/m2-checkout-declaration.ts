/**
 * M2.12: opt-in, isolated checkout receipt admission (NO V4 writes).
 *
 * Only after an S1-owned, fingerprint-verified S2 Pull and a known durable
 * M3 event-chain head may this adapter declare that THIS device checked out
 * a specific cloud revision. A declaration is not hardware attestation, proof
 * of complete account event discovery, or permission for M4/cloud merge.
 *
 * The port is deliberately separate from the Learn and S2 Sync pathways.
 * No consumer is allowed to treat "declared" as "all devices synced".
 */
import type { ChainedReceipt } from './multi-device-outbox'
import type { LocalS2PullAncestor } from './m2-pinned-s2-ancestor'
import type {
  DeviceCheckoutSelector, VerifiedDeviceCheckoutReply, WitnessedSetReply,
} from './api'
import { assertRestorableWorkspaceV4, workspaceFingerprintV4 } from './workspace-v4'

const SHA = /^[0-9a-f]{64}$/
const DEVICE = /^qwerty-web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type CloudMeta = {
  hasData: boolean
  revision: number
  logicalFingerprint?: string | null
  clientFormatVersion: string | null
}

type DeclaredReply = {
  ok: true
  verifiedExactReceipt: true
  receipt: DeviceCheckoutSelector
  publishReady: false
  convergenceComplete: false
}

export type CheckoutDeclarationPort = {
  /** Must include S1 registry generation, bearer token and device identity. */
  assertOwner(): Promise<void>
  readPinnedAncestor(): Promise<LocalS2PullAncestor | null>
  readCloudMeta(): Promise<CloudMeta>
  verifyEventHead(head: ChainedReceipt): Promise<WitnessedSetReply>
  declare(input: {
    cloudRevision: number
    cloudFingerprint: string
    eventHead: ChainedReceipt
  }): Promise<DeclaredReply>
  readExact(selector: DeviceCheckoutSelector): Promise<VerifiedDeviceCheckoutReply>
}

export type CheckoutDeclarationResult =
  | { status: 'blocked'; reason: string;
      publishReady: false; convergenceComplete: false }
  | { status: 'declared-checkout-only'; receipt: DeviceCheckoutSelector;
      cloudRevision: number; cloudFingerprint: string;
      publishReady: false; convergenceComplete: false }

function blocked(reason: string): CheckoutDeclarationResult {
  return { status: 'blocked', reason, publishReady: false,
    convergenceComplete: false }
}

function validHead(head: ChainedReceipt, deviceId: string): boolean {
  return !!head && head.deviceId === deviceId &&
    Number.isSafeInteger(head.sequence) &&
    head.sequence >= 1 && head.sequence <= 128 &&
    UUID.test(head.batchId) && SHA.test(head.sha256)
}

function validSelector(selector: DeviceCheckoutSelector, deviceId: string): boolean {
  return !!selector && selector.deviceId === deviceId &&
    UUID.test(selector.checkoutId) && SHA.test(selector.sha256)
}

/** Read-only account evidence, except for the independent immutable checkout
 * declaration POST. Does not mutate any local data, cloud V4 or FSRS state.
 * A network failure or identity switch blocks without guessing success.
 */
export async function declarePinnedDeviceCheckout(input: {
  accountId: string
  deviceId: string
  eventHead: ChainedReceipt
  port: CheckoutDeclarationPort
}): Promise<CheckoutDeclarationResult> {
  try {
    const { accountId, deviceId, eventHead, port } = input
    if (!accountId || accountId.trim() !== accountId ||
        !DEVICE.test(deviceId) || !validHead(eventHead, deviceId)) {
      return blocked('checkout-local-identity-or-head-invalid')
    }
    await port.assertOwner()
    const pin = await port.readPinnedAncestor()
    await port.assertOwner()
    if (!pin || pin.status !== 'pinned-local-s2-pull-only' ||
        pin.publishReady !== false || pin.convergenceComplete !== false ||
        pin.accountId !== accountId ||
        !Number.isSafeInteger(pin.revision) || pin.revision < 1 ||
        !SHA.test(pin.fingerprint)) {
      return blocked('checkout-no-verified-local-s2-pull')
    }
    assertRestorableWorkspaceV4(pin.snapshot)
    if (pin.snapshot.metadata.source.kind !== 'account' ||
        pin.snapshot.metadata.source.accountId !== accountId ||
        await workspaceFingerprintV4(pin.snapshot) !== pin.fingerprint) {
      return blocked('checkout-local-ancestor-corrupt')
    }
    await port.assertOwner()
    // A stale pin is NOT proof of today's cloud snapshot. Never declare
    // the old revision after another device has written a newer one.
    const cloud = await port.readCloudMeta()
    await port.assertOwner()
    if (!cloud.hasData || cloud.revision !== pin.revision ||
        cloud.logicalFingerprint !== pin.fingerprint ||
        cloud.clientFormatVersion !== 'qwerty-backup-v4') {
      return blocked('checkout-cloud-version-changed')
    }
    const witnessed = await port.verifyEventHead(eventHead)
    await port.assertOwner()
    if (witnessed.ok !== true || witnessed.verified !== true ||
        witnessed.publishReady !== false ||
        witnessed.convergenceComplete !== false ||
        witnessed.listingIsAuthoritative !== false) {
      return blocked('checkout-event-head-unverified')
    }
    const declared = await port.declare({
      cloudRevision: pin.revision,
      cloudFingerprint: pin.fingerprint,
      eventHead: { ...eventHead },
    })
    await port.assertOwner()
    if (declared.ok !== true || declared.verifiedExactReceipt !== true ||
        declared.publishReady !== false ||
        declared.convergenceComplete !== false ||
        !validSelector(declared.receipt, deviceId)) {
      return blocked('checkout-server-declaration-unverified')
    }
    const exact = await port.readExact(declared.receipt)
    await port.assertOwner()
    if (exact.ok !== true || exact.verifiedExactReceipt !== true ||
        exact.scope !== 'device-declared-checkout-only' ||
        exact.publishReady !== false ||
        exact.convergenceComplete !== false ||
        exact.accountId !== accountId || exact.deviceId !== deviceId ||
        exact.cloudRevision !== pin.revision ||
        exact.cloudFingerprint !== pin.fingerprint ||
        !exact.eventHead || !validHead(exact.eventHead, deviceId) ||
        exact.eventHead.sequence !== eventHead.sequence ||
        exact.eventHead.batchId !== eventHead.batchId ||
        exact.eventHead.sha256 !== eventHead.sha256) {
      return blocked('checkout-exact-readback-unverified')
    }
    return {
      status: 'declared-checkout-only',
      receipt: { ...declared.receipt },
      cloudRevision: pin.revision,
      cloudFingerprint: pin.fingerprint,
      publishReady: false, convergenceComplete: false,
    }
  } catch (error) {
    return blocked('checkout-verification-failed:' +
      (error instanceof Error ? error.message : 'unknown'))
  }
}
