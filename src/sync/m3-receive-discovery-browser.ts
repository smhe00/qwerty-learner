/**
 * Read-only observed-prefix proof on etest. Never apply FSRS/IDB/V4 changes.
 * No Blob listing, even a strong one, proves all devices are represented.
 */
import { observeChainedLearningReceipts } from './api'
import { loadAuth } from './auth'
import { etestM3PilotEnabled } from './m3-publication-browser'
import { selectObservedChainedHeads } from './m3-observed-chained-heads'
import { inspectOwnedWitnessedHistory } from './m3-witnessed-browser'
import { workspaceRegistryPort } from './workspace-vault'

export async function inspectEtestVisibleDeviceHeads(): Promise<{
  status: 'observed-only' | 'blocked'
  reason?: string
  observedDevices?: number
  publishReady: false
  convergenceComplete: false
}> {
  const denied = (reason: string) => ({
    status: 'blocked' as const, reason,
    publishReady: false as const, convergenceComplete: false as const,
  })
  if (!etestM3PilotEnabled()) return denied('etest-pilot-disabled')
  const auth = loadAuth()
  if (!auth || !auth.token || auth.expiresAt * 1000 <= Date.now()) {
    return denied('account-auth-required')
  }
  const accountId = auth.user.userId
  const token = auth.token
  const registry = await workspaceRegistryPort.read()
  if (registry.pending || registry.generation < 1 ||
      registry.active.kind !== 'account' ||
      registry.active.accountId !== accountId) {
    return denied('s1-account-not-mounted')
  }
  const assertOwner = async () => {
    const current = await workspaceRegistryPort.read()
    const now = loadAuth()
    if (current.generation !== registry.generation || current.pending ||
        current.active.kind !== 'account' ||
        current.active.accountId !== accountId ||
        now?.user.userId !== accountId || now.token !== token ||
        now.expiresAt * 1000 <= Date.now() ||
        !etestM3PilotEnabled()) {
      throw new Error('observed-prefix-account-changed')
    }
  }
  try {
    await assertOwner()
    const raw = await observeChainedLearningReceipts(token)
    await assertOwner()
    const selection = selectObservedChainedHeads(raw)
    if (selection.status !== 'heads-observed-only') {
      return denied('receipt-observation-' + selection.reason)
    }
    const proof = await inspectOwnedWitnessedHistory(selection.heads)
    await assertOwner()
    if (proof.status !== 'projected' ||
        proof.publishReady !== false ||
        proof.convergenceComplete !== false) {
      return denied('witnessed-event-prefix-not-verified')
    }
    // Merely observing more devices does not imply M4 adoption or convergence.
    return { status: 'observed-only', observedDevices: selection.heads.length,
      publishReady: false, convergenceComplete: false }
  } catch (error) {
    return denied('observed-prefix-error:' +
      (error instanceof Error ? error.message : 'unknown'))
  }
}
