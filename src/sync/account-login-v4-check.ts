/**
 * Same-account login/startup synchronization admission. This runs only from the S1
 * pre-mount account document, while its exclusive writer lease is held.
 *
 * S2 is a full six-table V4 CAS/pull protocol. M3/M4 independently handle
 * witnessed immutable attempts; neither is a substitute for cloud V4 history.
 * No conflict can be silently overwritten and no anonymous replica is read.
 */
import { learningEventSyncEnabled } from './learning-sync-policy'
import { workspaceRegistryPort } from './workspace-vault'

export type AccountLoginV4Result =
  | { status: 'noop' | 'pushed'; detail: string; canContinue: true }
  | { status: 'pull-staged'; detail: string; canContinue: false }
  | { status: 'pending'; detail: string; canContinue: boolean }

export async function checkAccountV4AfterAuthentication(): Promise<AccountLoginV4Result> {
  if (!learningEventSyncEnabled() || import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC !== 'true') {
    return { status: 'pending', canContinue: true, detail: '此站点未启用云端学习数据同步；本机记录仍保留。' }
  }
  if (!navigator.onLine) {
    return { status: 'pending', canContinue: true, detail: '当前处于离线状态，云端完整 V4 检查尚未执行；联网后需要重试。' }
  }
  const registry = await workspaceRegistryPort.read()
  if (registry.generation < 1 || registry.pending || registry.active.kind !== 'account') {
    return { status: 'pending', canContinue: false, detail: '账号工作区尚未准备好，云端完整 V4 检查已暂停以保护本机记录。' }
  }
  try {
    // Do not initialize RecordDB/store modules when cloud admission is disabled.
    const { executePreMountManualSyncV2 } = await import('./v2-browser-executor')
    const outcome = await executePreMountManualSyncV2({
      mode: 'isolated',
      registry,
    })
    if (outcome.status === 'noop') {
      return { status: 'noop', canContinue: true, detail: '云端完整 V4 已检查：本机与云端相同，或双方均无待同步学习记录。' }
    }
    if (outcome.status === 'pushed') {
      return { status: 'pushed', canContinue: true, detail: '云端完整 V4 已通过版本及指纹检查，单边更新已安全上传。' }
    }
    if (outcome.status === 'pull-reload-required') {
      return { status: 'pull-staged', canContinue: false, detail: outcome.automaticMerge
        ? '两端学习记录已自动融合并保存。'
        : '云端完整 V4 已校验，正在通过持久化恢复事务恢复本机账号记录。' }
    }
    // Valid same-account forks use automatic full-snapshot reconciliation.
    // Remaining blocked outcomes concern admission or unsupported evidence.
    // M3 can still prove/distribute valid immutable attempts independently,
    // but that must never be mistaken for COMPLETE cloud V4 convergence.
    return {
      status: 'pending',
      canContinue: true,
      detail:
        outcome.status === 'conflict'
          ? '已检查云端完整 V4，但同一账号两端历史记录存在分歧；尚未完成完整融合，本机和云端数据均未覆盖。'
          : '已检查云端完整 V4，但安全前置条件未满足；尚未完成完整融合，本机记录保留。',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const localAuditFailed = message.includes('Backup V4 source/export') || message.includes('Backup V4 independent roundtrip')
    return {
      status: 'pending',
      canContinue: true,
      detail: localAuditFailed
        ? '本机完整 V4 无损校验未通过，已阻止云端历史覆盖；请保留浏览器数据以供安全恢复。'
        : '云端完整 V4 检查或传输失败，尚未完成完整融合；本机学习记录不受此检查影响。',
    }
  }
}
