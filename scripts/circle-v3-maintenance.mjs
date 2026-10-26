/* eslint-env node */
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { sweepCircleV3 } from '../cloud-functions/_shared/circle/maintenance.js'

export async function runMaintenance({ argv = process.argv.slice(2), env = process.env, getStore, output = console.log } = {}) {
  const execute = argv.includes('--execute')
  const stateIndex = argv.indexOf('--state')
  const stateFile = stateIndex < 0 ? null : argv[stateIndex + 1]
  const allowed = new Set(['--execute', '--state', ...(stateFile ? [stateFile] : [])])
  if (argv.some((v) => !allowed.has(v)) || (stateIndex >= 0 && (!stateFile || stateFile.startsWith('--')))) {
    throw new Error('Usage: node scripts/circle-v3-maintenance.mjs [--execute] [--state checkpoint.json]')
  }
  if (execute && !stateFile) throw new Error('--execute requires --state for resumable cleanup')
  if (!env.CIRCLE_PROJECT_ID || !env.CIRCLE_BLOB_TOKEN || !env.CIRCLE_BLOB_STORE) {
    throw new Error('CIRCLE_PROJECT_ID, CIRCLE_BLOB_TOKEN and CIRCLE_BLOB_STORE are required privately')
  }
  let checkpoint
  if (stateFile) {
    try {
      if ((await fs.stat(stateFile)).size > 8 * 1024 * 1024) throw new Error('Checkpoint too large')
      checkpoint = JSON.parse(await fs.readFile(stateFile, 'utf8'))
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const factory = getStore || (await import('@edgeone/pages-blob')).getStore
  const blob = factory({ name: env.CIRCLE_BLOB_STORE, projectId: env.CIRCLE_PROJECT_ID,
    token: env.CIRCLE_BLOB_TOKEN, consistency: 'strong' })
  const result = await sweepCircleV3(blob, { execute, checkpoint })
  if (stateFile) {
    // Atomic local replacement prevents a torn checkpoint; crashes before this
    // point simply repeat idempotent deletions on the next invocation.
    const temporary = stateFile + '.tmp'
    await fs.writeFile(temporary, JSON.stringify(result.checkpoint), { mode: 0o600 })
    await fs.rename(temporary, stateFile)
  }
  const { checkpoint: _checkpoint, ...summary } = result
  void _checkpoint
  output(JSON.stringify(summary))
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMaintenance().catch(() => {
    // SDK errors may contain endpoints/credentials: do not print them.
    console.error('Circle maintenance failed; checkpoint retained. Check private configuration and scoped inventory.')
    process.exitCode = 1
  })
}
