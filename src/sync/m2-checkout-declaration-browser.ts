/**
 * M2.12 etest-only browser adapter for immutable checkout evidence.
 *
 * NOT called by mounted Learn, Typing, ordinary S2 Sync, M4 or production.
 * It writes only an independent device declaration object on the pilot
 * account server, not a V4 snapshot. The returned flag is NEVER sync success.
 */
import {
  declareChainedDeviceCheckout, getSyncV2Meta,
  readChainedDeviceCheckout, verifyWitnessedChainedEventHeads,
} from './api'
import { loadAuth } from './auth'
import { browserDeviceId } from './device-id'
import { declarePinnedDeviceCheckout } from './m2-checkout-declaration'
import type { CheckoutDeclarationResult } from './m2-checkout-declaration'
import { loadPinnedLocalS2PullAncestor } from './m2-pinned-s2-ancestor'
import { etestM3PilotEnabled } from './m3-publication-browser'
import type { ChainedReceipt } from './multi-device-outbox'
import { workspaceRegistryPort } from './workspace-vault'

export async function declareOwnedEtestCheckout(
  eventHead: ChainedReceipt,
): Promise<CheckoutDeclarationResult> {
  const denied = (reason: string): CheckoutDeclarationResult => ({
    status: 'blocked', reason, publishReady: false,
    convergenceComplete: false,
  })
  if (!etestM3PilotEnabled()) return denied('checkout-etest-pilot-disabled')
  const auth = loadAuth()
  if (!auth || !auth.token || auth.expiresAt * 1000 <= Date.now()) {
    return denied('checkout-account-auth-required')
  }
  const accountId = auth.user.userId
  const token = auth.token
  const deviceId = browserDeviceId()
  const registry = await workspaceRegistryPort.read()
  const generation = registry.generation
  if (registry.pending || generation < 1 ||
      registry.active.kind !== 'account' ||
      registry.active.accountId !== accountId) {
    return denied('checkout-account-not-mounted')
  }
  const assertOwner = async (): Promise<void> => {
    const [now, session] = await Promise.all([
      workspaceRegistryPort.read(), Promise.resolve(loadAuth()),
    ])
    if (now.pending || now.generation !== generation ||
        now.active.kind !== 'account' ||
        now.active.accountId !== accountId ||
        session?.user.userId !== accountId ||
        session.token !== token ||
        session.expiresAt * 1000 <= Date.now() ||
        browserDeviceId() !== deviceId || !etestM3PilotEnabled()) {
      throw new Error('checkout-account-or-device-changed')
    }
  }
  return declarePinnedDeviceCheckout({
    accountId, deviceId, eventHead,
    port: {
      assertOwner,
      readPinnedAncestor: () => loadPinnedLocalS2PullAncestor(accountId),
      readCloudMeta: () => getSyncV2Meta(token),
      verifyEventHead: head => verifyWitnessedChainedEventHeads(token, [head]),
      declare: input => declareChainedDeviceCheckout(token, input),
      readExact: selector => readChainedDeviceCheckout(token, selector),
    },
  })
}
