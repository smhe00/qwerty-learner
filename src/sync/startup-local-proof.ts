/** Disposable evidence for skipping work, never authority to restore or write.
 * Read actual raw rows on each visit: counts, timestamps and app-only dirty
 * hooks miss same-count edits and writes from an older/native IDB client. */
import { sha256Hex } from './sha256-compat'
import type { RemoteSyncMeta } from './types'
import type { SyncV2Baseline } from './v2-policy'
import { stableWorkspaceJson } from './workspace-v4'

export type StartupLocalProof = {
  version: 1
  accountId: string
  generation: number
  localDigest: string
  revision: number
  logicalFingerprint: string
  checksum: string
}
const SHA = /^[a-f0-9]{64}$/

/** Type-tagged encoding. Unsupported graphs bypass the optimization entirely.
 * In particular JSON alone loses undefined, holes, -0, NaN and Date identity. */
export async function startupLocalDigest(value: unknown): Promise<string | null> {
  const seen = new WeakSet<object>()
  let visited = 0
  const encode = (item: unknown, depth: number): unknown => {
    if (++visited > 2_000_000 || depth > 100) throw Error('unsupported-local-proof')
    if (item === null) return ['null']
    if (item === undefined) return ['undefined']
    if (typeof item === 'string' || typeof item === 'boolean') return [typeof item, item]
    if (typeof item === 'number') return ['number', Object.is(item, -0) ? '-0' : String(item)]
    if (typeof item !== 'object' || seen.has(item)) throw Error('unsupported-local-proof')
    seen.add(item)
    if (item instanceof Date) {
      if (Object.keys(item).length) throw Error('unsupported-local-proof')
      return ['date', String(item.getTime())]
    }
    const array = Array.isArray(item)
    const prototype = Object.getPrototypeOf(item)
    if (!array && prototype !== Object.prototype && prototype !== null) throw Error('unsupported-local-proof')
    if (Object.getOwnPropertySymbols(item).length) throw Error('unsupported-local-proof')
    const entries = Object.keys(item).sort().map(key => {
      const property = Object.getOwnPropertyDescriptor(item, key)
      if (!property || !('value' in property)) throw Error('unsupported-local-proof')
      return [key, encode(property.value, depth + 1)]
    })
    return array ? ['array', item.length, entries] : ['object', prototype === null, entries]
  }
  try {
    return await sha256Hex(new TextEncoder().encode(JSON.stringify(encode(value, 0))))
  } catch {
    return null
  }
}

export async function sealStartupLocalProof(input: Omit<StartupLocalProof, 'version' | 'checksum'>): Promise<StartupLocalProof> {
  const body = { version: 1 as const, ...input }
  return { ...body, checksum: await sha256Hex(new TextEncoder().encode(stableWorkspaceJson(body))) }
}

export async function matchesStartupLocalProof(input: {
  proof: StartupLocalProof | null
  accountId: string
  generation: number
  localDigest: string | null
  baseline: SyncV2Baseline | null
  remote: RemoteSyncMeta
}): Promise<boolean> {
  const { proof, baseline, remote } = input
  if (!proof || typeof proof !== 'object' || Array.isArray(proof) || !baseline || proof.version !== 1 ||
      proof.accountId !== input.accountId || baseline.accountId !== input.accountId ||
      !Number.isSafeInteger(proof.generation) || proof.generation < 1 || proof.generation !== input.generation ||
      !input.localDigest || proof.localDigest !== input.localDigest || !SHA.test(proof.localDigest) ||
      !Number.isSafeInteger(proof.revision) || proof.revision < 1 ||
      proof.revision !== baseline.baseRevision || proof.revision !== remote.revision ||
      !SHA.test(proof.logicalFingerprint) || proof.logicalFingerprint !== baseline.logicalFingerprint ||
      proof.logicalFingerprint !== remote.logicalFingerprint || !SHA.test(proof.checksum) ||
      remote.hasData !== true || remote.clientFormatVersion !== 'qwerty-backup-v4' ||
      remote.storageEncoding !== 'binary' || !SHA.test(remote.payloadSha256 ?? '')) return false
  const { checksum, ...body } = proof
  return checksum === await sha256Hex(new TextEncoder().encode(stableWorkspaceJson(body)))
}
