/**
 * Prevent legacy V1 entry points from bypassing the isolated S1 transaction
 * journal. Only workspaces with registry generation=0 retain V1 semantics.
 * S1 operations use the coordinator, never these compatibility functions.
 */
import { workspaceRegistryPort } from './workspace-vault'

export async function assertLegacyWorkspaceOperationAllowed(action: string): Promise<void> {
  const registry = await workspaceRegistryPort.read()
  if (registry.pending || registry.generation !== 0) {
    throw new Error(`工作区隔离已启用：旧版${action}已暂停，必须通过安全事务流程操作。`)
  }
}

export function assertLegacyAuthChangeAllowed(): Promise<void> {
  return assertLegacyWorkspaceOperationAllowed('账号操作')
}

export function assertLegacyCloudMutationAllowed(): Promise<void> {
  return assertLegacyWorkspaceOperationAllowed('云端上传或覆盖恢复')
}

export function assertLegacyLocalDestructiveOperationAllowed(): Promise<void> {
  return assertLegacyWorkspaceOperationAllowed('本地导入或清除')
}
