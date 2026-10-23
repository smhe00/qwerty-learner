import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-m4-idle-'))
const outfile = join(dir, 'policy.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/m4-idle-reconcile-policy.ts')],
  outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(dir, { recursive: true, force: true }))
const { shouldRequestIdleM4Adoption: eligible } =
  await import(pathToFileURL(outfile).href)
const ready = () => ({ missingLocalAttempts: 2, lastInteractionAgeMs: 26000,
  online: true, visible: true, pathname: '/learn', search: '',
  editingFieldFocused: false, temporarilyBlocked: false })
test('only confirmed missing witnessed attempts on an idle learning page may request pre-mount reconciliation', () => {
  assert.equal(eligible(ready()), true)
  for (const patch of [
    { missingLocalAttempts: undefined }, { missingLocalAttempts: 0 },
    { missingLocalAttempts: -1 }, { missingLocalAttempts: 1.5 },
    { lastInteractionAgeMs: 15000 }, { lastInteractionAgeMs: NaN },
    { online: false }, { visible: false }, { editingFieldFocused: true },
    { temporarilyBlocked: true }, { search: '?s1-account=manage' },
    { pathname: '/mobile/account' }, { pathname: '/settings' },
  ]) assert.equal(eligible({ ...ready(), ...patch }), false,
    'blocked signal: ' + Object.keys(patch).join(','))
})
