import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const path = new URL('../public/dicts/ShanghaiZhongkao2027.json', import.meta.url)
const result = buildSync({ entryPoints: [fileURLToPath(new URL('../src/utils/dictionaryContent.ts', import.meta.url))],
  bundle: true, target: 'node20', platform: 'node', format: 'esm', write: false })
const { createDictionaryContent } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
const words = JSON.parse(readFileSync(path, 'utf8'))
const projected = words.map(word => ({ ...word, content: createDictionaryContent(word.trans) }))
const withoutContent = entries => entries.map(({ content, ...word }) => word)
assert.deepEqual(withoutContent(projected), withoutContent(words), 'source content must never change')
if (process.argv.includes('--write')) writeFileSync(path, JSON.stringify(projected, null, 2))
else assert.deepEqual(words, projected, 'Run node scripts/structure-shanghai-dictionary.mjs --write to regenerate presentation metadata')
console.log('Verified ' + words.length + ' entries: original content preserved; structure deterministic.')
