import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const temp = mkdtempSync(join(tmpdir(), 'qwerty-default-dict-'))
after(() => rmSync(temp, { recursive: true, force: true }))

async function load(source, name) {
  const outfile = join(temp, name + '.mjs')
  await build({ entryPoints: [resolve(root, source)], outfile,
    bundle: true, platform: 'node', format: 'esm', target: 'node20' })
  return import(pathToFileURL(outfile).href)
}

const { DEFAULT_DICTIONARY_ID } = await load('src/resources/defaultDictionary.ts', 'default')
const { createWorkspaceV4, parseWorkspaceV4 } =
  await load('src/sync/workspace-v4.ts', 'v4')

const database = {
  formatName: 'dexie', formatVersion: 1,
  data: { databaseName: 'RecordDB', databaseVersion: 5,
    tables: [{ name: 'wordRecords', schema: '++id' }],
    data: [{ tableName: 'wordRecords', inbound: true,
      rows: [{ id: 1, word: 'retained-progress' }] }] },
}

function registeredCopy(dict) {
  return createWorkspaceV4({
    database,
    settings: { version: 1, values: { memoryConfig: { dailyNewWordTarget: 32 } } },
    learnRuntime: { dailySessions: {} },
    navigation: { currentDict: dict, currentChapter: 3 },
  }, { source: { kind: 'account', accountId: 'new-immutable-account' },
    createdAt: '2026-10-16T00:00:00.000Z' })
}

test('unselected fresh accounts use the single Shanghai Zhongkao 2027 fallback', () => {
  assert.equal(DEFAULT_DICTIONARY_ID, 'shanghai-zhongkao-2027')
})

test('explicit anonymous V4 copy preserves selected dictionary and progress, not system fallback', () => {
  const snapshot = parseWorkspaceV4(JSON.stringify(registeredCopy('CET4')))
  assert.equal(snapshot.workspaceData.navigation.currentDict, 'CET4')
  assert.equal(snapshot.workspaceData.navigation.currentChapter, 3)
  assert.equal(snapshot.workspaceData.database.data.data[0].rows[0].word, 'retained-progress')
})

test('anonymous workspace with default dictionary retains Shanghai Zhongkao selection', () => {
  const snapshot = parseWorkspaceV4(JSON.stringify(registeredCopy(DEFAULT_DICTIONARY_ID)))
  assert.equal(snapshot.workspaceData.navigation.currentDict, 'shanghai-zhongkao-2027')
})

test('registration copies V4 before S1 account switch, empty account does not copy', () => {
  const coordinator = readFileSync(resolve(root, 'src/sync/workspace-coordinator.ts'), 'utf8')
  const ui = readFileSync(resolve(root, 'src/sync/workspace-account-ui.ts'), 'utf8')
  assert.match(coordinator, /captureWorkingWorkspaceV4\(target\)/)
  assert.match(coordinator, /saveWorkspaceToVault\(target, snapshot\)/)
  assert.match(ui, /if \(copy\)\s*\{[\s\S]*?copyAnonymousWorkspaceForNewRegistration/)
  assert.match(ui, /await switchAuthenticatedWorkspace/)
})
