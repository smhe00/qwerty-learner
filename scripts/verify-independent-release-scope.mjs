/* eslint-env node */
// Run for the independent release candidate only, before its staging promotion.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const scope = JSON.parse(readFileSync('interactive/tasks/COMMIT-OUTCOME-RELEASE-SCOPE.json', 'utf8'))
for (const [path, expected] of Object.entries(scope.unchangedProductionUi)) {
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), expected, path + ' differs from production UI')
}
const entry = readFileSync('src/index.tsx', 'utf8')
assert(!entry.includes('quick-sync-entry'), 'New quick-sync entry must remain outside production')
assert(entry.includes('flushDeferredM3Checkout'), 'Startup repair must remain connected after UI exclusion')
console.log(JSON.stringify({ independentUiScope: 'PASS', productionBase: scope.productionBase,
  stagingUiRestoreSource: scope.uiRestoreSource, entrypointsChecked: Object.keys(scope.unchangedProductionUi).length + 1 }))
