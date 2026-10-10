/**
 * Source-level mutation audit for Explorer V3's domain-boundary contracts.
 *
 * All mutations are applied inside esbuild's onLoad hook in a disposable
 * Node bundle. No source file in the checkout is edited, and the actual
 * product/main or gh-pages/EdgeOne runtime is never mutated.
 *
 * Baseline MUST pass. A mutant is "killed" only if its altered source
 * bundles successfully and an existing executable test fails.
 * An invalid compilation is not counted as a kill. Survivors are reported,
 * not silently redefined as test success.
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

const entry = resolve('tests/simulation/system-explorer-v3-coverage.test.ts')
const mutants = [
  {
    id: 'assistance-deferred-returns-immediately',
    source: 'src/learn/acquisition.ts',
    from: 'resumeAfter:\n      now + MIN_ASSISTANCE_DEFERRED_DELAY_SECONDS,',
    to: 'resumeAfter:\n      now,',
  },
  {
    id: 'spacing-deferred-returns-immediately',
    source: 'src/learn/acquisition.ts',
    from: 'resumeAfter:\n      now + MIN_CROSS_SESSION_INDEPENDENT_DELAY_SECONDS,',
    to: 'resumeAfter:\n      now,',
  },
  {
    id: 'daily-completion-ignores-outstanding-words',
    source: 'src/learn/daily-session.ts',
    from: 'const remainingWords = Math.max(0, targetWords - completedWords)',
    to: 'const remainingWords = 0',
  },
  {
    id: 'daily-plan-always-zero-new-words',
    source: 'src/learn/daily-session.ts',
    from: 'const plannedNewWords = Math.min(dailyNewTarget, unseenCount)',
    to: 'const plannedNewWords = 0',
  },
  {
    id: 'daily-quota-counts-acquired-not-introduced',
    source: 'src/learn/quota.ts',
    from: 'targetDailyNewWords - stats.today.introducedWords,',
    to: 'targetDailyNewWords - stats.today.acquiredWords,',
  },
  {
    id: 'due-first-becomes-new-acquisition',
    source: 'src/learn/session.ts',
    from: "if (input.dueCount > 0 && input.unseenCount > 0) return 'mixed'",
    to: "if (input.dueCount > 0 && input.unseenCount > 0) return 'acquisition'",
  },
]

const temporary = mkdtempSync(join(tmpdir(), 'qwerty-source-mutation-v3-'))
async function run(mutation, ordinal) {
  const output = join(temporary, 'case-' + ordinal + '.mjs')
  let substituted = false
  const absolute = mutation ? resolve(mutation.source) : undefined
  try {
    await build({
      entryPoints: [entry],
      outfile: output,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      logLevel: 'silent',
      plugins: !mutation ? [] : [{
        name: 'disposable-in-memory-production-mutation',
        setup(bundle) {
          bundle.onLoad({ filter: /\.(ts|tsx)$/ }, args => {
            if (resolve(args.path) !== absolute) return undefined
            const original = readFileSync(args.path, 'utf8')
            const count = original.split(mutation.from).length - 1
            if (count !== 1) throw new Error(
              'mutation match must be unique: ' + mutation.id + ' got=' + count,
            )
            substituted = true
            return {
              contents: original.replace(mutation.from, mutation.to),
              loader: args.path.endsWith('tsx') ? 'tsx' : 'ts',
            }
          })
        },
      }],
    })
    if (mutation && !substituted) {
      return { id: mutation.id, result: 'invalid-not-applied', signal: 'mutation target was not bundled' }
    }
  } catch (e) {
    return { id: mutation?.id ?? 'baseline', result: 'invalid-build',
      signal: String(e).slice(0, 350) }
  }
  const runResult = spawnSync(process.execPath, ['--test', output], {
    encoding: 'utf8',
    timeout: 45_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const lines = (runResult.stdout || '').split('\n')
  const failingLine = lines.find(s => /not ok \d+ -|error:|Expected values to be/.test(s)) ?? ''
  return {
    id: mutation?.id ?? 'baseline',
    result: runResult.error ? 'invalid-runtime' :
      runResult.status === 0 ? 'survived' : 'killed',
    failedTest: failingLine.replace(/^\s*#?\s*/, '').slice(0, 180),
    passedTests: (runResult.stdout.match(/^ok \d+ -/gm) ?? []).length,
    failedTests: (runResult.stdout.match(/^not ok \d+ -/gm) ?? []).length,
  }
}

try {
  const baseline = await run(null, 0)
  if (baseline.result !== 'survived') {
    console.error('EXPLORER_V3_SOURCE_MUTATION_BASELINE_FAILURE ' + JSON.stringify(baseline))
    process.exitCode = 1
  } else {
    const results = []
    for (let i = 0; i < mutants.length; i++) {
      results.push(await run(mutants[i], i + 1))
    }
    const counts = {
      killed: results.filter(r => r.result === 'killed').length,
      survived: results.filter(r => r.result === 'survived').length,
      invalid: results.filter(r => r.result.startsWith('invalid')).length,
    }
    console.log('EXPLORER_V3_SOURCE_MUTATION_SCORECARD ' + JSON.stringify({
      schema: 'explorer-v3-in-memory-source-mutants-v1',
      baselinePassed: true,
      validMutants: counts.killed + counts.survived,
      ...counts,
      killRate: counts.killed + counts.survived ?
        Number((counts.killed / (counts.killed + counts.survived)).toFixed(4)) : null,
      results,
    }))
    if (counts.invalid) process.exitCode = 1
    if (counts.killed + counts.survived !== mutants.length ||
        counts.survived !== 0) process.exitCode = 1
  }
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
