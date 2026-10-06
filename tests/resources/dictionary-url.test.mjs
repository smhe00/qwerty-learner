import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)
const source = readFileSync(
  path.join(repoRoot, 'src/resources/dictionary.ts'),
  'utf8',
)

test('dictionary resources never use document-relative ./dicts paths', () => {
  const relative = source.match(/url:\s*['"]\.\/dicts\//g)
  assert.equal(
    relative,
    null,
    'found document-relative dictionary URL; nested Learn routes would resolve ./dicts against /learn/session and 404',
  )
})

test('known nested-route-sensitive dictionaries are app-root absolute', () => {
  for (const file of [
    'ket2021.json',
    'YiLin_1.json',
    'YiLin_2.json',
    'YiLin_3.json',
  ]) {
    assert.match(
      source,
      new RegExp(
        "url:\\s*['\\\"]\\/dicts\\/" +
          file.replace('.', '\\.') +
          "['\\\"]",
      ),
      file + ' must use /dicts/ absolute path',
    )
  }
})
