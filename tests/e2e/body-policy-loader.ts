import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type Policy = typeof import('../../cloud-functions/_shared/safe-body-retry.js')
// Playwright 1.40 rewrites even TS dynamic import() into require(). Keep the
// native import in a fixed, trusted string so Node20 loads this ESM module.
const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<Policy>
let loaded: Promise<Policy> | undefined
export function loadBodyPolicy(): Promise<Policy> {
  return loaded ??= nativeImport(pathToFileURL(resolve(__dirname, '../../cloud-functions/_shared/safe-body-retry.js')).href)
}
