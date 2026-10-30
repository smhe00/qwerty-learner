import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'

const catalog = JSON.parse(readFileSync('src/resources/study-illustrations.json', 'utf8'))
const dictionary = JSON.parse(readFileSync('public/dicts/ShanghaiZhongkao2027.json', 'utf8'))
const bundled = await build({ entryPoints: ['src/resources/studyIllustrations.ts'], bundle: true, target: 'node20', platform: 'node', format: 'esm', write: false })
const { getStudyIllustration } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))

test('every pilot image matches the authoritative word, pinned meaning and original bytes', () => {
  assert.equal(catalog.length, 50)
  assert.equal(new Set(catalog.map(entry => entry.word)).size, catalog.length)
  assert.equal(readdirSync('public/images/word-atlas').filter(name => name.endsWith('.webp')).length, catalog.length)
  for (const entry of catalog) {
    const word = dictionary.find(word => word.name === entry.word)
    assert.equal(word?.trans[0], entry.sourceMeaning)
    const image = readFileSync('public/images/word-atlas/' + entry.sourceId + '.webp')
    assert.equal(image.toString('ascii', 0, 4), 'RIFF')
    assert.equal(image.toString('ascii', 8, 12), 'WEBP')
    assert.equal(createHash('sha256').update(image).digest('hex'), entry.sha256)
    assert.equal(getStudyIllustration('shanghai-zhongkao-2027', word).path, '/images/word-atlas/' + entry.sourceId + '.webp')
  }
  assert.match(readFileSync('public/images/word-atlas/ATTRIBUTION.md', 'utf8'), /Word Atlas contributors/)
  assert.match(readFileSync('public/images/word-atlas/LICENSE.md', 'utf8'), /4\.0/)
})

test('unreviewed words, foreign dictionaries and changed meanings cannot inherit an image', () => {
  const word = dictionary.find(word => word.name === 'ability')
  const original = JSON.stringify(word)
  assert.equal(getStudyIllustration('cet4', word), undefined)
  assert.equal(getStudyIllustration('shanghai-zhongkao-2027', { ...word, name: 'ABILITY' }), undefined)
  assert.equal(getStudyIllustration('shanghai-zhongkao-2027', { ...word, trans: ['different sense'] }), undefined)
  assert.equal(getStudyIllustration('shanghai-zhongkao-2027', { ...word, trans: [] }), undefined)
  assert.equal(getStudyIllustration('shanghai-zhongkao-2027', dictionary.find(word => word.name === 'about')), undefined)
  assert.equal(JSON.stringify(word), original)
})
