/* eslint-env node */
/**
 * M2.10 authenticated, device-bound checkout DECLARATION receipt.
 *
 * No actual HTTP route or Blob provider is wired yet. A future adapter must
 * derive accountId and deviceId from the same authenticated session and must
 * verify exact V4 revision bytes + immutable event-head receipt.
 *
 * Scope: server-recorded acknowledgement that an authenticated device
 * declares checkout of a particular V4 revision. This is NOT attestation of
 * browser IndexedDB state, completeness of devices, or authorization to merge.
 * EdgeOne Blob has no atomic CAS: a fresh random immutable key is essential.
 */
import crypto from 'node:crypto'

const SHA = /^[0-9a-f]{64}$/
const DEVICE = /^qwerty-web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_SEQUENCE = 128

function canonical(value) {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw Error('checkout-non-json-value')
    return encoded
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return '{' + Object.keys(value).sort()
    .filter(key => value[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + canonical(value[key]))
    .join(',') + '}'
}
function sha(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex')
}
function assertSession(session) {
  if (!session || !session.accountId ||
      typeof session.accountId !== 'string' ||
      session.accountId.trim() !== session.accountId ||
      !DEVICE.test(session.deviceId)) {
    throw Error('checkout-authenticated-device-required')
  }
}
function validHead(head, deviceId) {
  return !!head && head.deviceId === deviceId &&
    Number.isSafeInteger(head.sequence) &&
    head.sequence >= 1 && head.sequence <= MAX_SEQUENCE &&
    UUID.test(head.batchId) && SHA.test(head.sha256)
}
function assertReceipt(value, selector) {
  if (!value || value.version !== 1 ||
      value.kind !== 'device-session-checkout-declaration' ||
      value.accountId !== selector.accountId ||
      value.deviceId !== selector.deviceId ||
      value.checkoutId !== selector.checkoutId ||
      !Number.isSafeInteger(value.cloudRevision) ||
      value.cloudRevision < 1 ||
      !SHA.test(value.cloudFingerprint) ||
      !validHead(value.eventHead, selector.deviceId) ||
      typeof value.confirmedAt !== 'string' ||
      Number.isNaN(Date.parse(value.confirmedAt))) {
    throw Error('checkout-receipt-identity-or-content-invalid')
  }
}

/**
 * Port must be supplied by server-only storage and authentication layers:
 * verifyExactCloudRevision: exact revision manifest + V4 canonical SHA;
 * verifyExactChainedHead: immutable Blob read, NOT eventual list lookup;
 * putImmutable/readExact: per-account, device, UUID, SHA content key.
 */
export async function issueDeviceCheckoutDeclaration(session, input, port) {
  assertSession(session)
  if (!input || !Number.isSafeInteger(input.cloudRevision) ||
      input.cloudRevision < 1 || !SHA.test(input.cloudFingerprint) ||
      !validHead(input.eventHead, session.deviceId)) {
    throw Error('checkout-request-invalid')
  }
  if (await port.verifyExactCloudRevision(
    session.accountId, input.cloudRevision, input.cloudFingerprint,
  ) !== true) {
    throw Error('checkout-cloud-revision-not-verified')
  }
  if (await port.verifyExactChainedHead(
    session.accountId, input.eventHead,
  ) !== true) {
    throw Error('checkout-event-head-not-verified')
  }
  const record = {
    version: 1,
    kind: 'device-session-checkout-declaration',
    accountId: session.accountId,
    deviceId: session.deviceId,
    checkoutId: crypto.randomUUID(),
    cloudRevision: input.cloudRevision,
    cloudFingerprint: input.cloudFingerprint,
    eventHead: { ...input.eventHead },
    confirmedAt: new Date().toISOString(),
  }
  const checksum = sha(record)
  // A missing/ambiguous write acknowledgement cannot stand as proof.
  // Read the exact immutable key again, even if the write returned false.
  await port.putImmutable(session.accountId, session.deviceId,
    record.checkoutId, checksum, record)
  const observed = await port.readExact(session.accountId, session.deviceId,
    record.checkoutId, checksum)
  assertReceipt(observed, record)
  if (sha(observed) !== checksum || canonical(observed) !== canonical(record)) {
    throw Error('checkout-immutable-readback-mismatch')
  }
  return { receipt: {
    deviceId: record.deviceId, checkoutId: record.checkoutId, sha256: checksum,
  }, verifiedExactReceipt: true, publishReady: false,
  convergenceComplete: false }
}

/** Exact GET of a server-stored declaration; do not discover via Blob.list.
 * A result means the claimed account-bound session submitted the statement,
 * not that an independent device's local DB actually contains those bytes. */
export async function readDeviceCheckoutDeclaration(session, selector, port) {
  assertSession(session)
  if (!selector || !DEVICE.test(selector.deviceId) ||
      !UUID.test(selector.checkoutId) || !SHA.test(selector.sha256)) {
    throw Error('checkout-receipt-selector-invalid')
  }
  const observed = await port.readExact(session.accountId,
    selector.deviceId, selector.checkoutId, selector.sha256)
  if (observed === null) return null
  assertReceipt(observed, {
    accountId: session.accountId,
    deviceId: selector.deviceId,
    checkoutId: selector.checkoutId,
  })
  if (sha(observed) !== selector.sha256) {
    throw Error('checkout-receipt-content-sha-mismatch')
  }
  return { accountId: observed.accountId, deviceId: observed.deviceId,
    cloudRevision: observed.cloudRevision,
    cloudFingerprint: observed.cloudFingerprint,
    eventHead: { ...observed.eventHead },
    scope: 'device-declared-checkout-only',
    verifiedExactReceipt: true, publishReady: false,
    convergenceComplete: false }
}
