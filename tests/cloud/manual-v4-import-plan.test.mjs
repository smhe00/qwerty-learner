import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-portable-v4-import-'))
const out = join(tmp, 'portable-import.mjs')
await build({
  entryPoints: [resolve(root, 'src/sync/manual-v4-import-plan.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20',
})
after(() => rmSync(tmp, { recursive: true, force: true }))
const { preparePortableV4Import, rebindPortableV4Import } =
  await import(pathToFileURL(out).href)
const names = ['wordRecords', 'chapterRecords', 'reviewRecords',
  'reviewWordStates', 'achievementEvents', 'achievementStates']

function backup(originalId = 'old-account-id') {
  return JSON.stringify({
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-11T10:00:00.000Z',
      source: { kind: 'account', accountId: originalId } },
    workspaceData: {
      database: { formatName: 'dexie', formatVersion: 1, data: {
        databaseName: 'RecordDB', databaseVersion: 6,
        tables: names.map(name => ({ name, schema: '++id' })),
        data: names.map((name, i) => ({
          tableName: name, inbound: true,
          rows: [
            { id: i + 1, word: 'FSRS-学习记录-' + name,
              typingTelemetry: { attempts: [{ durationMs: 123, errorCount: 0 }] },
            },
          ],
        })),
      } },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: { memoryConfig: {
        dailyNewWordTarget: 20, blockSize: 1,
      }, pronunciation: { type: 'uk' } } },
      navigation: { currentDict: 'zhongkaohexin', currentChapter: 13 },
    },
  })
}
const target = { kind: 'account', accountId: 'new-account-id' }
const consent = {
  replaceCurrentLocal: true,
  acceptDifferentSourceOwner: true,
  destinationConfirmation: target.accountId,
}

test('Portable V4 old-account -> new-account changes only envelope, not learning payload', async () => {
  const original = backup()
  const plan = await preparePortableV4Import(original, target)
  assert.equal(plan.needsCrossOwnerConsent, true)
  assert.equal(plan.cloudEffect, 'none')
  assert.deepEqual(plan.originalOwner, { kind: 'account', accountId: 'old-account-id' })
  assert.deepEqual(plan.destinationOwner, target)
  const candidate = await rebindPortableV4Import(original, plan, consent)
  assert.deepEqual(candidate.metadata.source, target)
  assert.deepEqual(candidate.workspaceData, JSON.parse(original).workspaceData)
  assert.deepEqual(JSON.parse(original).metadata.source,
    { kind: 'account', accountId: 'old-account-id' })
  assert.equal(candidate.workspaceData.database.data.data.length, 6)
})

test('No takeover by typing OLD account ID or merely checking replace confirmation', async () => {
  const json = backup()
  const plan = await preparePortableV4Import(json, target)
  await assert.rejects(
    () => rebindPortableV4Import(json, plan, {
      ...consent, destinationConfirmation: 'old-account-id',
    }), /replacement confirmation/,
  )
  await assert.rejects(
    () => rebindPortableV4Import(json, plan, {
      ...consent, acceptDifferentSourceOwner: false,
    }), /cross-account consent mismatch/,
  )
  await assert.rejects(
    () => rebindPortableV4Import(json, plan, {
      ...consent, replaceCurrentLocal: false,
    }), /replacement confirmation/,
  )
})

test('Current-account same-ID restore does not require cross-account consent', async () => {
  const json = backup('new-account-id')
  const plan = await preparePortableV4Import(json, target)
  assert.equal(plan.needsCrossOwnerConsent, false)
  const restored = await rebindPortableV4Import(json, plan,
    { ...consent, acceptDifferentSourceOwner: false })
  assert.equal(restored.metadata.source.accountId, 'new-account-id')
})

test('Anonymous backup can be imported to a newly created account after consent', async () => {
  const source = JSON.parse(backup())
  source.metadata.source = { kind: 'anonymous' }
  const json = JSON.stringify(source)
  const plan = await preparePortableV4Import(json, target)
  assert.equal(plan.needsCrossOwnerConsent, true)
  const candidate = await rebindPortableV4Import(json, plan, consent)
  assert.deepEqual(candidate.metadata.source, target)
  assert.deepEqual(candidate.workspaceData, source.workspaceData)
})

test('Plan refuses changed learning rows, changed provenance or incomplete V4', async () => {
  const original = backup()
  const plan = await preparePortableV4Import(original, target)
  const changed = JSON.parse(original)
  changed.workspaceData.database.data.data[0].rows[0].word = 'lost-progress'
  await assert.rejects(
    () => rebindPortableV4Import(JSON.stringify(changed), plan, consent),
    /changed after preview/,
  )
  changed.workspaceData.database.data.data[0].rows[0].word = 'FSRS-学习记录-wordRecords'
  changed.metadata.source.accountId = 'forged'
  await assert.rejects(
    () => rebindPortableV4Import(JSON.stringify(changed), plan, consent),
    /identity or cross-account consent mismatch/,
  )
  const partial = JSON.parse(original)
  partial.workspaceData.database.data.tables.pop()
  await assert.rejects(
    () => preparePortableV4Import(JSON.stringify(partial), target),
    /requires complete|missing|restore/i,
  )
})
