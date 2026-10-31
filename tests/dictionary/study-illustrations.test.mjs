import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'

const catalog = JSON.parse(readFileSync('src/resources/study-illustrations.json', 'utf8'))
const dictionary = JSON.parse(readFileSync('public/dicts/ShanghaiZhongkao2027.json', 'utf8'))
const audit = JSON.parse(readFileSync('docs/data/shanghai-2027-image-audit.json', 'utf8'))
const exclusions = JSON.parse(readFileSync('scripts/data/study-illustration-exclusions.json', 'utf8'))
const bundled = await build({ entryPoints: ['src/resources/studyIllustrations.ts'], bundle: true, target: 'node20', platform: 'node', format: 'esm', write: false })
const { getStudyIllustration } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))

test('every image matches an authoritative entry, pinned meaning and original bytes', () => {
  assert.equal(catalog.length, 2208)
  assert.equal(new Set(catalog.map(entry => JSON.stringify([entry.word, entry.sourceMeaning]))).size, catalog.length)
  const ids = new Set(catalog.map(entry => entry.sourceId))
  assert.equal(ids.size, 2207)
  assert.deepEqual(new Set(readdirSync('public/images/word-atlas').filter(name => name.endsWith('.webp'))), new Set([...ids].map(id => id + '.webp')))
  for (const entry of catalog) {
    const word = dictionary.find(word => word.name === entry.word && word.trans[0] === entry.sourceMeaning)
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

test('missing or incompatible senses, foreign dictionaries and changed meanings cannot inherit an image', () => {
  const word = dictionary.find(word => word.name === 'ability')
  const original = JSON.stringify(word)
  assert.equal(getStudyIllustration('cet4', word), undefined)
  assert.equal(getStudyIllustration('shanghai-zhongkao-2027', { ...word, name: 'ABILITY' }), undefined)
  assert.equal(getStudyIllustration('shanghai-zhongkao-2027', { ...word, trans: ['different sense'] }), undefined)
  assert.equal(getStudyIllustration('shanghai-zhongkao-2027', { ...word, trans: [] }), undefined)
  for (const name of [...Object.keys(exclusions), 'amusement', 'check out']) {
    assert.equal(getStudyIllustration('shanghai-zhongkao-2027', dictionary.find(word => word.name === name)), undefined, name)
  }
  assert.equal(JSON.stringify(word), original)
})

test('coverage accounts for every unchanged syllabus entry and respects case and duplicate senses', () => {
  assert.equal(audit.entries.length, dictionary.length)
  assert.deepEqual(audit.statistics, { dictionaryEntries: 2872, enabledEntries: 2209, enabledWords: 2207, guardedMappings: 2208, uniqueImages: 2207, excludedEntries: 47, missingEntries: 616, imageBytes: 58908608 })
  assert.equal(createHash('sha256').update(readFileSync('public/dicts/ShanghaiZhongkao2027.json')).digest('hex'), audit.dictionarySha256)
  assert.equal(audit.sourceCommit, '99c007673d38f02c418d8e4cd2e9ec90b5d40be5')
  for (const [index, word] of dictionary.entries()) {
    const entry = audit.entries[index]
    assert.equal(entry.index, index)
    assert.equal(entry.word, word.name)
    assert.equal(Boolean(getStudyIllustration('shanghai-zhongkao-2027', word)), entry.status === 'enabled', word.name)
  }
  for (const name of ['China', 'it', 'poster', 'less', 'apple', 'device', 'whoever']) {
    for (const word of dictionary.filter(word => word.name === name)) assert.ok(getStudyIllustration('shanghai-zhongkao-2027', word), name)
  }
  for (const name of ['china', 'IT', 'March', 'Miss', 'Pacific', 'bear', 'court', 'trunk']) {
    assert.equal(getStudyIllustration('shanghai-zhongkao-2027', dictionary.find(word => word.name === name)), undefined, name)
  }
})
