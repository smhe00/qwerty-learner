/**
 * M3 -> M2.12 opt-in declaration bridge (only evidence, never V4 writes).
 *
 * Invoke only after an exact-GET-confirmed M3 publication has no remaining
 * work. Durable outbox holds the verified device head; a stale/inflight
 * queue cannot create a checkout witness. No "synced" status exists here.
 */
import type { CheckoutDeclarationResult } from './m2-checkout-declaration'
import type { M3PublicationCycleResult } from './m3-publication-cycle'
import type { ChainedReceipt, EventOutboxState } from './multi-device-outbox'

export type M3CheckoutFollowup =
  | { status: 'skipped'; reason: string;
      publishReady: false; convergenceComplete: false }
  | { status: 'blocked'; reason: string;
      publishReady: false; convergenceComplete: false }
  | Extract<CheckoutDeclarationResult, { status: 'declared-checkout-only' }>

export type M3CheckoutFollowupPort = {
  assertOwner(): Promise<void>
  readOutbox(): Promise<EventOutboxState>
  declare(head: ChainedReceipt): Promise<CheckoutDeclarationResult>
}

export async function tryDeclareCheckoutAfterPublication(input: {
  accountId: string
  deviceId: string
  published: M3PublicationCycleResult
  port: M3CheckoutFollowupPort
}): Promise<M3CheckoutFollowup> {
  const blocked = (reason: string): M3CheckoutFollowup => ({
    status: 'blocked', reason, publishReady: false, convergenceComplete: false,
  })
  const skipped = (reason: string): M3CheckoutFollowup => ({
    status: 'skipped', reason, publishReady: false, convergenceComplete: false,
  })
  if (input.published.status !== 'uploaded-events-only' ||
      input.published.remaining !== 0 || input.published.batches < 1) {
    return skipped('no-complete-new-upload')
  }
  try {
    await input.port.assertOwner()
    const state = await input.port.readOutbox()
    await input.port.assertOwner()
    if (state.accountId !== input.accountId ||
        state.deviceId !== input.deviceId || state.version !== 1) {
      return blocked('checkout-outbox-owner-mismatch')
    }
    if (state.pending.length || state.inflight !== null) {
      return blocked('checkout-outbox-not-drained')
    }
    if (!state.confirmedHead ||
        state.confirmedHead.deviceId !== input.deviceId) {
      return blocked('checkout-no-verified-outbox-head')
    }
    // Do not equate a durable outbox head with server verified completion:
    // declare() must separately verify the exact chain, cloud revision,
    // pinned S2 ancestor and independent server readback.
    const outcome = await input.port.declare({ ...state.confirmedHead })
    await input.port.assertOwner()
    if (outcome.publishReady !== false ||
        outcome.convergenceComplete !== false) {
      return blocked('checkout-misleading-convergence-flag')
    }
    return outcome
  } catch (error) {
    return blocked('checkout-followup-error:' +
      (error instanceof Error ? error.message : 'unknown'))
  }
}
