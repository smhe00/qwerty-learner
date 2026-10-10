/**
 * Frozen independent mutation holdout, separate from Explorer V3's
 * optimized 14-mutant training suite. Existing production tests are the
 * detectors. Do not amend the manifest or assertions after inspecting
 * this run's score; survivors are primary findings.
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const manifestPath = resolve('tests/simulation/explorer-v3-heldout-manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const root = mkdtempSync(join(tmpdir(), 'qwerty-heldout-mutants-'))
const reportDir = resolve('.mutation-audit')
mkdirSync(reportDir, { recursive: true })

function replaceNth(source, find, replace, occurrence) {
  const n = source.split(find).length - 1
  if (n !== (occurrence ?? 1)) {
    // n=2 is legitimate when occurrence=2, but a manifest may have one
    // target and should never accidentally mutate every matching line.
    if (!(n >= (occurrence ?? 1) && occurrence !== undefined)) {
      throw new Error('target occurrence mismatch, found ' + n)
    }
  }
  const index = source.split(find).slice(0, occurrence ?? 1).join(find).length
  if (occurrence === undefined) return source.replace(find, replace)
  const prefix = source.split(find).slice(0, occurrence).join(find)
  // prefix is the string preceding the Nth exact match.
  return prefix + replace + source.slice(prefix.length + find.length)
}

async function evaluate(category, mutation, ordinal) {
  const relativePath = manifest.detectorSuites[category]
  const entryPoint = resolve(relativePath)
  const output = join(root, 'audit-' + ordinal + '.mjs')
  let substitutionCount = 0
  const requested = mutation ? resolve(mutation.source) : null

  try {
    await build({
      entryPoints: [entryPoint],
      outfile: output,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      bundle: true,
      logLevel: 'silent',
      plugins: !mutation ? [] : [{
        name: 'heldout-in-memory-product-source-mutation',
        setup(runner) {
          runner.onLoad({ filter: /\.(ts|tsx)$/ }, args => {
            if (resolve(args.path) !== requested) return undefined
            const original = readFileSync(args.path, 'utf8')
            const count = original.split(mutation.from).length - 1
            if (count !== (mutation.occurrence ?? 1) &&
                !(mutation.occurrence && count >= mutation.occurrence)) {
              throw new Error('Ambiguous manifest locator: ' + mutation.id +
                ' occurrences=' + count)
            }
            substitutionCount++
            return {
              contents: replaceNth(original, mutation.from, mutation.to, mutation.occurrence),
              loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
            }
          })
        },
      }],
    })
    if (mutation && substitutionCount !== 1) {
      return { id: mutation.id, category, status: 'invalid-not-applied', buildCount: substitutionCount }
    }
  } catch (err) {
    return { id: mutation?.id ?? category + '-baseline',
      category, status: 'invalid-build', message: String(err).slice(0, 600) }
  }

  const result = spawnSync(process.execPath, ['--test', output], {
    encoding: 'utf8', timeout: 25_000, maxBuffer: 3 * 1024 * 1024,
  })
  const data = result.stdout || ''
  const failedTests = (data.match(/^not ok \d+ - .+$/gm) || [])
    .map(s => s.replace(/^not ok \d+ - /, '')).slice(0, 5)
  const passedTests = (data.match(/^ok \d+ - /gm) || []).length
  const status =
    result.error ? 'invalid-timeout-or-spawn' :
    result.status === 0 ? 'survived' :
    failedTests.length > 0 ? 'killed' : 'invalid-runtime-without-assertion'
  return {
    id: mutation?.id ?? category + '-baseline',
    category, status, passedTests, failedTests,
    exitCode: result.status,
  }
}

let exitCode = 0
try {
  const frozenNames = Object.keys(manifest.detectorSuites)
  const baselines = []
  for (const [index, category] of frozenNames.entries()) {
    baselines.push(await evaluate(category, null, 'base-' + index))
  }
  if (baselines.some(b => b.status !== 'survived')) {
    console.error('EXPLORER_V3_HELDOUT_BASELINE_FAILURE ' + JSON.stringify(baselines))
    exitCode = 1
  }

  const results = []
  if (!exitCode) {
    for (const [index, mutant] of manifest.mutations.entries()) {
      results.push(await evaluate(mutant.category, mutant, index))
    }
  }

  const counts = {
    killed: results.filter(x => x.status === 'killed').length,
    survived: results.filter(x => x.status === 'survived').length,
    invalid: results.filter(x => x.status.startsWith('invalid')).length,
  }
  const validCount = counts.killed + counts.survived
  const byDomain = Object.fromEntries(frozenNames.map(category => {
    const domain = results.filter(x => x.category === category)
    const caught = domain.filter(x => x.status === 'killed').length
    const valid = domain.filter(x => ['killed', 'survived'].includes(x.status)).length
    return [category, { killed: caught, valid, rate: valid ? caught / valid : null }]
  }))
  const scorecard = {
    schema: manifest.schema,
    manifestFrozenAt: manifest.frozenAt,
    baselinePassed: !exitCode,
    baselineSuites: baselines,
    totalMutations: manifest.mutations.length,
    ...counts, valid: validCount,
    killRate: validCount ? Number((counts.killed / validCount).toFixed(4)) : null,
    byDomain, results,
  }
  console.log('EXPLORER_V3_HELDOUT_SCORECARD ' + JSON.stringify(scorecard))
  writeFileSync(join(reportDir, 'heldout-scorecard.json'),
    JSON.stringify(scorecard, null, 2))

  // Do not enforce a positive kill-rate: a zero is a valid blind-test finding.
  if (counts.invalid > 0 || !scorecard.baselinePassed ||
      results.length !== manifest.mutations.length) exitCode = 1
} finally {
  rmSync(root, { recursive: true, force: true })
}
process.exitCode = exitCode
