/**
 * S1 same-origin stale-tab containment.
 *
 * A V5 page does not run our Web Lock and can mutate shared localStorage even
 * after the last V6 writer page closes. Seal the V4-owned settings, daily
 * sessions, navigation and auth values inside the durable migration witness.
 * A pre-S1 tab will not update this witness when it changes those keys.
 *
 * This is an accidental-stale-client integrity check, not a cryptographic
 * signature against an attacker who can execute JavaScript on this origin.
 */
import {
  DAILY_SESSION_PREFIX,
  S1_MIGRATION_WITNESS_KEY,
  WORKSPACE_SETTING_KEYS,
} from './workspace-v4'

const PROTECTED = new Set<string>([
  ...WORKSPACE_SETTING_KEYS,
  'currentDict',
  'currentChapter',
  'reviewModeInfo',
  'qwerty.cloudAuth.v1',
])
const VERSION = 'v2:'
let guardInstalled = false

function protectedKey(key: string): boolean {
  return PROTECTED.has(key) || key.startsWith(DAILY_SESSION_PREFIX)
}

function integrityFingerprint(storage: Storage): string {
  const keys = [...PROTECTED]
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key?.startsWith(DAILY_SESSION_PREFIX)) keys.push(key)
  }
  keys.sort()
  // Independent 32-bit accumulators; no plaintext learning data is copied.
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (const key of keys) {
    const pair = JSON.stringify([key, storage.getItem(key)])
    for (let i = 0; i < pair.length; i++) {
      const ch = pair.charCodeAt(i)
      a = Math.imul(a ^ ch, 0x01000193)
      b = Math.imul((b ^ ch) + 0x7f4a7c15, 0x85ebca6b)
    }
  }
  return VERSION + (a >>> 0).toString(16).padStart(8, '0') +
    (b >>> 0).toString(16).padStart(8, '0')
}

export function assertWorkspaceMigrationWitness(): 'legacy' | 'sealed' {
  const actual = localStorage.getItem(S1_MIGRATION_WITNESS_KEY)
  if (actual === 'v1') return 'legacy' // Pre-existing S1 test profiles only.
  if (actual === null) {
    throw new Error('S1 workspace migration witness missing: writes blocked')
  }
  if (actual !== integrityFingerprint(localStorage)) {
    throw new Error('S1 workspace storage witness mismatch: possible stale-tab modification; writes blocked')
  }
  return 'sealed'
}

/** Write only the tiny digest, not a duplicate backup of private data. */
export function refreshWorkspaceMigrationWitness(): void {
  localStorage.setItem(S1_MIGRATION_WITNESS_KEY, integrityFingerprint(localStorage))
}

/** Install before importing React/any application writer and while holding the Web Lock. */
export function installWorkspaceStorageWriterGuard(): void {
  if (guardInstalled) return
  const originalSet = Storage.prototype.setItem
  const originalRemove = Storage.prototype.removeItem
  const originalClear = Storage.prototype.clear
  const refresh = () => originalSet.call(localStorage,
    S1_MIGRATION_WITNESS_KEY, integrityFingerprint(localStorage))

  Storage.prototype.setItem = function (key: string, value: string): void {
    if (this === localStorage && key === S1_MIGRATION_WITNESS_KEY) {
      throw new Error('S1 migration witness is managed by the guarded writer only')
    }
    originalSet.call(this, key, value)
    if (this === localStorage && protectedKey(key)) refresh()
  }
  Storage.prototype.removeItem = function (key: string): void {
    if (this === localStorage && key === S1_MIGRATION_WITNESS_KEY) {
      throw new Error('Cannot erase an active S1 migration witness')
    }
    originalRemove.call(this, key)
    if (this === localStorage && protectedKey(key)) refresh()
  }
  Storage.prototype.clear = function (): void {
    if (this === localStorage) {
      throw new Error('S1 blocks unjournaled localStorage.clear on an isolated workspace')
    }
    originalClear.call(this)
  }
  guardInstalled = true
}
