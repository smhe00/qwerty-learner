import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'

// Mutation is in the validator's read port only; no workspace file is edited.
function validate(extraImport = '', target = 'src/utils/db/review-record.ts') {
  const adapter = resolve(target)
  const source = fs.readFileSync('scripts/validate-architecture-boundaries.mjs', 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const nativeRequire = createRequire(import.meta.url)
  new Function('require', 'exports', 'console', output)((name) => name === 'node:fs' ? {
    ...fs,
    readFileSync: (file, ...args) => {
      const text = fs.readFileSync(file, ...args)
      return resolve(file) === adapter ? text + '\n' + extraImport : text
    },
  } : nativeRequire(name), {}, { log: () => {} })
}

test('current persistence and domain boundaries pass', () => validate())
test('reintroducing a utility barrel or store back-edge fails the architecture gate', () => {
  for (const path of ['@/utils', '..', '../index', '@/store', '@/store/reviewInfoAtom']) {
    assert.throws(() => validate(`import { unsafe } from '${path}'`), /persistence adapter must use leaf utilities/)
  }
})
test('Learn persistence has no remaining store import exception', () => {
  assert.throws(() => validate("import { flushReviewRecordWrites } from '@/store/reviewInfoAtom'", 'src/learn/persistence.ts'), /domain policy must not depend on it/)
})
