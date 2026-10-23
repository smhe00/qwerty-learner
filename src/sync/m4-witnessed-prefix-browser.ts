/**
 * Etest M4.1 pre-mount bridge. The caller MUST already own the exclusive S1
 * writer lease; no React/typing/ReviewRecord writer may be mounted.
 *
 * M3 immutable receipts are only a non-authoritative, observed prefix. This
 * bridge NEVER claims all devices have published, and NEVER uploads a V4 to
 * cloud. Applying a monotonic, exactly witnessed subset is permitted only
 * because every local row and every untouched workspace component survives.
 * Interrupted full-V4 restore is recovered on the next guarded boot using
 * the immutable original/candidate M4 journal.
 */
import { loadAuth } from './auth'
import { db } from '@/utils/db/core'
import { browserDeviceId } from './device-id'
import { executeM4Merge } from './m4-merge-transaction'
import { m4MergeJournalPort } from './m4-merge-journal'
import { observeChainedLearningReceipts } from './api'
import { selectObservedChainedHeads } from './m3-observed-chained-heads'
import { inspectOwnedWitnessedHistory } from './m3-witnessed-browser'
import { etestM3PilotEnabled, runEtestM3Publication } from './m3-publication-browser'
import { previewMonotonicWitnessedM4 } from './m4-witnessed-prefix-candidate'
import { captureWorkingWorkspaceV4, restoreWorkingWorkspaceV4,
  materializeAuditedM4CandidateV4 } from './workspace-v4-browser'
import { workspaceFingerprintV4 } from './workspace-v4'
import { refreshWorkspaceMigrationWitness } from './workspace-storage-witness'
import { workspaceRegistryPort } from './workspace-vault'
import type { Registry } from './workspace-transition'

export type WitnessedM4BootResult =
  | { status: 'skipped' | 'blocked'; reason: string }
  | { status: 'adopted'; newAttempts: number; scope: 'verified-prefix-only' }

export async function adoptWitnessedM3AtGuardedBoot(
  registry: Registry,
  options: { preMountAccountManagement?: boolean } = {},
): Promise<WitnessedM4BootResult> {
  // Production Vite intentionally drops ALL console calls. Persist bounded,
  // anonymized diagnostics in this etest tab's sessionStorage instead.
  // Never store bearer tokens, account/device IDs, UUIDs, words, raw errors,
  // or server payloads. An observer must NEVER alter a sync outcome.
  const trace = (phase: string, counters: Record<string, string | number | boolean> = {}) => {
    if (!etestM3PilotEnabled()) return
    try {
      const key = 'qwerty.etest.m4.stageTrace.v1'
      const allowed = /^[a-z][a-z0-9-]{0,63}$/
      const clean: Record<string, string | number | boolean> = { phase }
      for (const [name, value] of Object.entries(counters)) {
        if (!allowed.test(name)) continue
        if (typeof value === 'number' && Number.isSafeInteger(value) &&
            value >= 0 && value <= 100000) clean[name] = value
        else if (typeof value === 'boolean') clean[name] = value
        else if (typeof value === 'string' && value.length <= 96 &&
          value.split(':').length <= 2 &&
          value.split(':').every(part => allowed.test(part))) clean[name] = value
      }
      const previous = sessionStorage.getItem(key)
      const parsed: unknown = previous ? JSON.parse(previous) : []
      const items = Array.isArray(parsed) ? parsed.slice(-47) : []
      items.push(clean)
      sessionStorage.setItem(key, JSON.stringify(items))
    } catch { /* No diagnostic observer can interrupt M4 or login */ }
  }
  const skip = (reason: string): WitnessedM4BootResult => {
    trace('skipped', { reason })
    return { status: 'skipped', reason }
  }
  const blocked = (reason: string): WitnessedM4BootResult => {
    trace('blocked', { reason })
    return { status: 'blocked', reason }
  }
  trace('entered')
  if (!etestM3PilotEnabled() || registry.pending ||
      registry.generation < 1 || registry.active.kind !== 'account' ||
      !navigator.onLine) return skip('inactive-etest-account-or-offline')
  // Account management, imports and recovery must never be interrupted by a
  // background adoption or an unexpected in-between document reload.
  const pathname = window.location.pathname.replace(/\/$/, '') || '/'
  const accountManagement = options.preMountAccountManagement === true &&
    ((pathname === '/' &&
      new URLSearchParams(window.location.search).get('s1-account') === 'manage') ||
     (pathname === '/mobile/account' && window.location.search === ''))
  if (!accountManagement &&
      !['/', '/learn', '/mobile', '/mobile/study'].includes(pathname)) {
    return skip('non-learn-route')
  }
  const autoReconcile = pathname === '/' &&
    window.location.search === '?m4-reconcile=1'
  if (window.location.search && !accountManagement && !autoReconcile) {
    return skip('account-or-tool-query')
  }
  const auth = loadAuth()
  const accountId = registry.active.accountId
  if (!auth?.token || auth.user.userId !== accountId ||
      auth.expiresAt * 1000 <= Date.now()) return skip('auth-required')
  const token = auth.token
  const deviceId = browserDeviceId()
  const assertOwner = async () => {
    const now = await workspaceRegistryPort.read()
    const current = loadAuth()
    if (now.generation !== registry.generation || now.pending ||
        now.active.kind !== 'account' || now.active.accountId !== accountId ||
        current?.user.userId !== accountId || current.token !== token ||
        current.expiresAt * 1000 <= Date.now() ||
        browserDeviceId() !== deviceId || !etestM3PilotEnabled()) {
      throw new Error('m4-witnessed-owner-or-session-changed')
    }
  }
  try {
    await assertOwner()
    // Publish this device's outstanding offline attempts BEFORE inspecting
    // remote prefixes. Stale login tokens fail closed without any local loss.
    const sent = await runEtestM3Publication()
    await assertOwner()
    trace('published', { status: sent.status,
      ...('reason' in sent ? { reason: sent.reason } : {}),
      ...('remaining' in sent ?
      { remaining: sent.remaining } : {}), ...('scanned' in sent ?
      { scanned: sent.scanned } : {}) })
    if (sent.status === 'blocked') return blocked('m3-publication:' + sent.reason)
    const observation = await observeChainedLearningReceipts(token)
    await assertOwner()
    const heads = selectObservedChainedHeads(observation)
    trace('observed', { reportedReceipts: observation.observedCount,
      status: heads.status, ...('reason' in heads ? { reason: heads.reason } : {}),
      ...('heads' in heads ? { visibleDevices: heads.heads.length } : {}) })
    if (heads.status !== 'heads-observed-only') {
      return skip('no-complete-observed-prefix:' + heads.reason)
    }
    // This inspector independently verifies server account ownership, exact
    // chains, every raw immutable event and the canonical set digest.
    const proof = await inspectOwnedWitnessedHistory(heads.heads)
    await assertOwner()
    trace('witnessed', { status: proof.status, reason: proof.reason,
      ...(proof.status === 'witnessed' ?
        { verifiedAttempts: proof.remoteAttemptCount } : {}) })
    if (proof.status !== 'witnessed' || proof.reason !== 'verified-prefix-only' ||
        proof.publishReady !== false || proof.convergenceComplete !== false) {
      return blocked('M3-witness-evidence-unverified')
    }
    const original = await captureWorkingWorkspaceV4({ kind: 'account', accountId })
    await assertOwner()
    // captureWorkingWorkspaceV4 already audits its entire Dexie export
    // against independently read raw source data under this S1 lease.
    // Use fresh RAW rows, not Typeson's export-only $types descriptors,
    // for immutable attempt identity comparisons and FSRS replay.
    const liveWordRecords = await db.wordRecords.toCollection().raw().toArray()
    await assertOwner()
    const projection = await previewMonotonicWitnessedM4({
      accountId, local: original, liveWordRecords,
      witnessedEvents: proof.remoteEvents,
    })
    await assertOwner()
    trace('candidate', { status: projection.status,
      ...(projection.status === 'blocked' ? {
        reason: projection.reason.split(':')[0],
        detail: projection.reason.split(':')[1] ?? 'none',
      } : {}),
      ...(projection.status === 'candidate' ?
        { added: projection.newlyAdoptedAttempts } : {}) })
    if (projection.status === 'blocked') {
      return blocked('M4-prefix-candidate:' + projection.reason)
    }
    if (projection.status === 'unchanged') return skip(projection.reason)
    // A scratch DB materializes the mixed M3/V4 candidate into a canonical
    // Dexie export and verifies all six source tables. Nothing is imported
    // into the real working DB until this independent audit passes.
    const candidate = await materializeAuditedM4CandidateV4(projection.candidate)
    await assertOwner()
    trace('materialized', { added: projection.newlyAdoptedAttempts })
    // Both V4 snapshots are archived atomically in the S1 vault BEFORE a
    // single working DB row or setting is overwritten.
    await executeM4Merge(m4MergeJournalPort, {
      capture: async scope => captureWorkingWorkspaceV4({ kind: 'account', accountId: scope }),
      restore: (snapshot, scope) => restoreWorkingWorkspaceV4(snapshot,
        { kind: 'account', accountId: scope }),
      seal: async () => { refreshWorkspaceMigrationWitness() },
    }, {
      accountId, registryGeneration: registry.generation,
      expectedOriginalFingerprint: await workspaceFingerprintV4(original),
      candidate,
    }, phase => trace('transaction', { step: phase }))
    // executeM4Merge validates post-restore full V4 fingerprint and keeps a
    // rollback archive. A fresh document is required to discard stale module
    // caches initialized during the unmounted restore.
    trace('adopted', { added: projection.newlyAdoptedAttempts })
    return { status: 'adopted', newAttempts: projection.newlyAdoptedAttempts,
      scope: 'verified-prefix-only' }
  } catch (error) {
    trace('blocked', { at: 'exception' })
    // Never interpret an unknown failure as a successful merge. If M4 staging
    // started, the durable journal remains and must recover next boot.
    if (error instanceof Error &&
        error.message.includes('m4-merge-interrupted-recovery-required')) {
      throw error
    }
    return blocked(error instanceof Error ? error.message : 'unknown')
  }
}
