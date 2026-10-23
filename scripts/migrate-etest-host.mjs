#!/usr/bin/env node
/* eslint-env node */
/**
 * One-time etest custom-domain migration. Tracked runtime sources, deployment
 * configuration and tests only. Never rewrite historical evidence, account
 * data, snapshots, public dictionaries or artifacts.
 *
 * Run: node scripts/migrate-etest-host.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const oldHostname = ['etest', 'edgeone', 'dev'].join('.')
const newHostname = ['t', 'smhe', 'cn'].join('.')
const roots = ['.github/', 'cloud-functions/', 'scripts/', 'src/', 'src-tauri/',
  'tests/', 'preview/', 'public/']
const topLevel = new Set(['README.md', '.env.example', '.env.production',
  'edgeone.json', 'index.html', 'package.json', 'playwright.config.ts',
  'vite.config.ts', 'vite.song-preview.config.ts'])
const skip = [
  /^public\/(assets|dicts|sound|phonetics)\//,
  /^src\/resources\//,
  /^tests\/fixtures\/binary\//,
  /^scripts\/migrate-etest-host\.mjs$/,
  /(?:^|\/)node_modules\//,
]
const codeExtension = /\.(?:ts|tsx|js|mjs|cjs|jsx|json|ya?ml|html|css|md|txt|sh|toml|xml)$/
const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean)
const edit = []
const skipped = []
for (const name of paths) {
  const data = fs.readFileSync(name)
  if (data.includes(0)) continue // no binary rewrite
  const source = data.toString('utf8')
  if (!source.includes(oldHostname)) continue
  const inRuntime = (roots.some(prefix => name.startsWith(prefix)) ||
    topLevel.has(name)) && codeExtension.test(name) ||
    ['.env.production', '.env.example'].includes(name)
  if (!inRuntime || skip.some(re => re.test(name)) ||
      /^(docs|interactive|formal)\//.test(name)) {
    skipped.push({ file: name, occurrences: source.split(oldHostname).length - 1 })
    continue
  }
  const count = source.split(oldHostname).length - 1
  edit.push({ file: name, occurrences: count })
  fs.writeFileSync(name, source.replaceAll(oldHostname, newHostname))
}
const required = [
  'src/sync/m3-publication-browser.ts',
  'src/index.tsx',
  '.github/workflows/etest-three-device-auto-fork.yml',
]
const actuallyChanged = new Set(edit.map(x => x.file))
const missing = required.filter(file => !actuallyChanged.has(file))
process.stdout.write(JSON.stringify({
  oldHostname, newHostname, changedFiles: edit.length,
  changedOccurrences: edit.reduce((n, x) => n + x.occurrences, 0),
  changes: edit, preservedHistoricalOrExcluded: skipped,
}, null, 2) + '\n')
if (missing.length) {
  throw Error('Domain migration must update all required runtime boundaries: ' +
    missing.join(', '))
}
if (edit.length < 8) throw Error('Unexpectedly small domain migration; inspect repository')
for (const { file } of edit) {
  if (fs.readFileSync(file, 'utf8').includes(oldHostname)) {
    throw Error('Old runtime host survived replacement: ' + file)
  }
}
