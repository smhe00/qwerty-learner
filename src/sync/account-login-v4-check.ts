import { SYNC_PENDING_NOTICE, recordLearningSyncDiagnostic } from './learning-sync-diagnostics'

/**
 * Same-account login/startup synchronization admission. This runs only from the S1
 * pre-mount account document, while its exclusive writer lease is held.
 *
 * S2 is a full six-table V4 CAS/pull protocol. M3/M4 independently handle
 * witnessed immutable attempts; neither is a substitute for cloud V4 history.
 * No conflict can be silently overwritten and no anonymous replica is read.
 */
import { learningEventSyncEnabled } from './learning-sync-policy'
import { timePerfStage } from './perf-diagnostics'
import { v4FailureCode } from './v4-failure-diagnostics'
import { workspaceRegistryPort } from './workspace-vault'

export type AccountLoginV4Result =
  | { status: 'noop' | 'pushed'; detail: string; canContinue: true }
  | { status: 'pull-staged'; detail: string; canContinue: false }
  | { status: 'pending'; detail: string; canContinue: boolean }

export async function checkAccountV4AfterAuthentication(): Promise<AccountLoginV4Result> {
  if (!learningEventSyncEnabled() || import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC !== 'true') {
    recordLearningSyncDiagnostic({ stage: 'v4-check', status: 'disabled' })
    return { status: 'pending', canContinue: true, detail: '此站点未启用云同步，学习记录保存在本机。' }
  }
  if (!navigator.onLine) {
    recordLearningSyncDiagnostic({ stage: 'v4-check', status: 'offline' })
    return { status: 'pending', canContinue: true, detail: '当前离线，学习记录已保存在本机。' }
  }
  const registry = await workspaceRegistryPort.read()
  if (registry.generation < 1 || registry.pending || registry.active.kind !== 'account') {
    return { status: 'pending', canContinue: false, detail: SYNC_PENDING_NOTICE }
  }
  try {
    // Do not initialize RecordDB/store modules when cloud admission is disabled.
    const { executePreMountManualSyncV2 } = await import('./v2-browser-executor')
    const outcome = await timePerfStage('sync', 'account-sync', () =>
      executePreMountManualSyncV2({
        mode: 'isolated',
        registry,
      }),
    )
    recordLearningSyncDiagnostic({ stage: 'v4-check', status: outcome.status, code: 'reason' in outcome ? outcome.reason : 'none' })
    if (outcome.status === 'noop') {
      return { status: 'noop', canContinue: true, detail: '' }
    }
    if (outcome.status === 'pushed') {
      return { status: 'pushed', canContinue: true, detail: '' }
    }
    if (outcome.status === 'pull-reload-required') {
      return { status: 'pull-staged', canContinue: false, detail: outcome.automaticMerge ? '学习记录已更新。' : '正在恢复学习记录。' }
    }
    // Valid same-account forks use automatic full-snapshot reconciliation.
    // Remaining blocked outcomes concern admission or unsupported evidence.
    // M3 can still prove/distribute valid immutable attempts independently,
    // but that must never be mistaken for COMPLETE cloud V4 convergence.
    return {
      status: 'pending',
      canContinue: true,
      detail: SYNC_PENDING_NOTICE,
    }
  } catch (error) {
    recordLearningSyncDiagnostic({ stage: 'v4-check', status: 'failed', code: v4FailureCode(error) })
    return { status: 'pending', canContinue: true, detail: SYNC_PENDING_NOTICE }
  }
}
