/**
 * Existing V1 auth actions operate in one shared RecordDB. After S1 registry
 * initialization they must fail CLOSED, until transactional account UI exists.
 * Registry reads happen while the current tab owns the app writer lease.
 */
import { workspaceRegistryPort } from './workspace-vault'

export async function assertLegacyAuthChangeAllowed(): Promise<void> {
  const registry = await workspaceRegistryPort.read()
  if (registry.pending || registry.generation !== 0) {
    throw new Error('工作区隔离已启用：旧版登录、退出及账号删除入口已暂停。请使用事务式账号切换流程。')
  }
}
