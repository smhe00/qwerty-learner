import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<any>
export async function cleanupAccount(options: Record<string, unknown>): Promise<any> {
  const module = await nativeImport(pathToFileURL(resolve(__dirname, '../cloud/disposable-account-cleanup.mjs')).href)
  return module.cleanupDisposableAccount(options)
}
