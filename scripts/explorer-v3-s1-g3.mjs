/*
 * G3 independent heldout: mutation in a disposable .mutation-audit copy of
 * each production source, with original cloud test assertions unchanged.
 * The test harness is relocated only to make its esbuild entrypoint reference
 * that disposable copy. No mutation touches checkout src/ or production.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
const root = process.cwd()
const manifest = JSON.parse(readFileSync(resolve('tests/simulation/explorer-v3-s1-g3-manifest.json'), 'utf8'))
const out = resolve('.mutation-audit/g3')
mkdirSync(out, { recursive: true })
const requiredDomains = ['transition', 'snapshot']
const results = []
const baseline = []

function editNth(source, needle, change) {
  const count = source.split(needle).length - 1
  if (count !== 1) throw new Error('mutation target must be unique: ' + count)
  return source.replace(needle, change)
}
function locationFor(source) { return resolve(source) }
async function execute(domain, mutant, index) {
  const config = manifest.detectors[domain]
  if (!config) return { id: mutant?.id ?? 'baseline', domain, status: 'invalid-domain' }
  let targetFile = locationFor(config.source)
  if (mutant) {
    try {
      const original = readFileSync(targetFile, 'utf8')
      const content = editNth(original, mutant.from, mutant.to)
      targetFile = join(out, 'mutant-' + index + '.ts')
      writeFileSync(targetFile, content)
      // A syntax or dependency error is INVALID, not a mutant killed by tests.
      await build({
        entryPoints: [targetFile],
        outfile: join(out, 'preflight-' + index + '.mjs'),
        bundle: true, platform: 'node', format: 'esm', target: 'node20',
        logLevel: 'silent',
      })
    } catch (err) {
      return { id: mutant.id, domain, status: 'invalid-build',
        error: String(err).slice(0, 300) }
    }
  }
  const originalTest = readFileSync(resolve(config.test), 'utf8')
  const moduleSelector = "resolve(root, '" + config.source + "')"
  if (originalTest.split(moduleSelector).length !== 2) {
    return { id: mutant?.id ?? 'baseline', domain, status: 'invalid-harness-selector' }
  }
  // This changes *only* the nested test's esbuild entrypoint (the module
  // under test); it leaves all source assertions and fixtures intact.
  const harness = originalTest.replace(moduleSelector, JSON.stringify(targetFile))
  const patchedTest = join(out, 'harness-' + (mutant ? index : 'base-' + domain) + '.test.mjs')
  writeFileSync(patchedTest, harness)
  const r = spawnSync(process.execPath, ['--test', patchedTest], {
    cwd: root, encoding: 'utf8', timeout: 60000,
    maxBuffer: 5 * 1024 * 1024,
  })
  const stdout = r.stdout ?? ''
  const namedFailures = [...stdout.matchAll(/^not ok \d+ - (.*)$/gm)]
    .map(m => m[1])
  const passed = [...stdout.matchAll(/^ok \d+ - /gm)].length
  // The harness itself failing to load is not a semantic detection.
  const harnessBroke = namedFailures.some(n => n.includes('harness-') && n.includes('.test.mjs'))
  const status = r.error || harnessBroke ? 'invalid-runtime'
    : r.status === 0 ? 'survived'
    : namedFailures.length > 0 ? 'killed' : 'invalid-runtime'
  return {
    id: mutant?.id ?? 'baseline', domain, status,
    passed, failedTests: namedFailures.slice(0, 6),
    exitCode: r.status,
    ...(status.startsWith('invalid') ? {
      evidence: (r.stderr || stdout).slice(-650),
    } : {}),
  }
}
let exitCode = 0
try {
  for (const domain of requiredDomains) {
    baseline.push(await execute(domain, null, 0))
  }
  const clean = baseline.every(r => r.status === 'survived')
  if (clean) {
    for (const [i, mutant] of manifest.mutations.entries()) {
      results.push(await execute(mutant.domain, mutant, i + 1))
    }
  }
  const killed = results.filter(r => r.status === 'killed')
  const survived = results.filter(r => r.status === 'survived')
  const invalid = results.filter(r => r.status.startsWith('invalid'))
  const byDomain = Object.fromEntries(requiredDomains.map(domain => {
    const subset = results.filter(r => r.domain === domain)
    const detected = subset.filter(r => r.status === 'killed').length
    const valid = subset.filter(r => r.status === 'killed' || r.status === 'survived').length
    return [domain, { killed: detected, valid, killRate: valid ? detected / valid : null }]
  }))
  const scorecard = {
    schema: manifest.schema,
    frozenAt: manifest.frozenAt,
    scope: 'S1 workspace protocol + Backup V4 source-injection; not live browser or cloud',
    cleanBaselinePassed: clean, baseline, total: manifest.mutations.length,
    killed: killed.length, survived: survived.length, invalid: invalid.length,
    killRate: killed.length + survived.length ?
      Number((killed.length / (killed.length + survived.length)).toFixed(4)) : null,
    byDomain, results,
  }
  writeFileSync(resolve('.mutation-audit/g3-s1-scorecard.json'), JSON.stringify(scorecard, null, 2))
  console.log('EXPLORER_V3_G3_INDEPENDENT_SCORECARD ' + JSON.stringify(scorecard))
  // Green means valid honest measurement, NEVER a hidden kill-rate target.
  if (!clean || invalid.length || results.length !== manifest.mutations.length) exitCode = 1
} finally {
  rmSync(out, { recursive: true, force: true })
}
process.exitCode = exitCode
