import { readAdministratorSession } from './session'

export const administrationEnabled = REACT_APP_DEPLOY_ENV !== 'pages' && import.meta.env.VITE_QWERTY_SYNC_DISABLED !== 'true'
export class AdministrationError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}
/** No learning API/device ID module is imported into the administration bundle. */
export async function administrationRequest<T>(
  path: string,
  options: { token?: string; body?: unknown; anonymous?: boolean } = {},
): Promise<T> {
  if (!administrationEnabled) throw new Error('当前为界面预览，不连接管理服务。')
  const session = readAdministratorSession()
  const token = options.token ?? session?.token
  if (!options.anonymous && (!token || token !== session?.token)) throw new AdministrationError('管理会话已结束，请重新登录。', 401)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 25000)
  try {
    const response = await fetch(path, {
      method: options.body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
    const result = await response.json()
    if (!response.ok || result?.ok !== true) {
      throw new AdministrationError(
        response.status === 401
          ? '管理登录已失效，请重新登录。'
          : response.status === 403
          ? '当前账号没有管理权限。'
          : result?.message || '管理服务暂时不可用，请稍后重试。',
        response.status,
      )
    }
    if (!options.anonymous && readAdministratorSession()?.token !== token)
      throw new AdministrationError('管理会话已改变，请重新打开页面。', 401)
    return result as T
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError')
      throw new Error(options.body === undefined ? '请求超时，请稍后重试。' : '操作结果尚未确认，请先刷新查询结果。')
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}
