import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
const dictionary = read('public/dicts/ShanghaiZhongkao2027.json')
const catalog = read('src/resources/study-examples.json')
const sources = read('scripts/data/word-atlas-daily-source.json')
const reviews = read('scripts/data/study-example-reviews.json')
const audit = read('docs/data/shanghai-2027-example-audit.json')
const bundled = await build({ entryPoints: ['src/resources/studyExamples.ts'], bundle: true, target: 'node20', platform: 'node', format: 'esm', write: false })
const { getStudyPresentation } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const word = name => dictionary.find(entry => entry.name === name)

test('authoritative bytes, originals and source text remain unchanged; every supplement has an explicit review', () => {
  assert.equal(createHash('sha256').update(readFileSync('public/dicts/ShanghaiZhongkao2027.json')).digest('hex'), 'ffcbfcf7950f824c4d0666facd028171520ab9baf0b59e7fc91f5f9e7f3ab9b5')
  assert.equal(catalog.length, 216)
  assert.equal(new Set(catalog.map(entry => JSON.stringify([entry.word, entry.sourceMeaning]))).size, catalog.length)
  for (const entry of catalog) {
    const original = dictionary.find(word => word.name === entry.word && word.trans[0] === entry.sourceMeaning)
    assert.deepEqual(entry.syllabusExamples, original.example || [])
    const source = sources.entries.find(source => source.word === entry.word)
    assert.equal(entry.example.en, source.example.en)
    assert.equal(entry.example.cn, source.example.zh)
    assert.match(source.sourceEntryUrl, /99c007673d38f02c418d8e4cd2e9ec90b5d40be5/)
    const review = reviews.entries.find(review => review.word === entry.word)
    assert.equal(review.quality, 'accepted')
    assert.ok(review.qualityReason)
    if (entry.illustrationId) { assert.equal(review.image, 'matched'); assert.ok(review.imageReason) }
    const shown = getStudyPresentation('shanghai-zhongkao-2027', original)
    assert.equal(shown.source, 'daily')
    assert.deepEqual(shown.example, entry.example)
    assert.equal(Boolean(shown.illustration), Boolean(entry.illustrationId))
  }
})

test('daily targets are uniquely masked including reviewed inflections and have no second visible answer', () => {
  const inflections = { chicken: 'chickens', vegetable: 'vegetables', learn: 'learning', talk: 'talked', dance: 'danced', draw: 'drew', flower: 'flowers', star: 'stars', watch: 'watched', animal: 'animals', allow: 'allows', design: 'designed' }
  for (const { word, example } of catalog) {
    const surface = example.en.slice(example.start, example.end)
    assert.equal(surface.toLowerCase(), inflections[word] || word.toLowerCase())
    const outside = example.en.slice(0, example.start) + example.en.slice(example.end)
    assert.doesNotMatch(outside.toLowerCase(), new RegExp('\\b' + word.toLowerCase() + '\\b'), word)
  }
})

test('image matching is independent of sentence quality; incompatible scenes never accompany the new cue', () => {
  const before = JSON.stringify(dictionary)
  for (const name of ['ability', 'water', 'plane', 'bridge', 'healthy', 'device', 'remember', 'environment']) {
    const shown = getStudyPresentation('shanghai-zhongkao-2027', word(name))
    assert.equal(shown.source, 'daily', name)
    assert.equal(shown.illustration, undefined, name)
  }
  for (const name of ['able', 'bakery', 'borrow', 'nurse', 'panda']) assert.ok(getStudyPresentation('shanghai-zhongkao-2027', word(name)).illustration, name)
  for (const name of ['banana', 'milk', 'medicine', 'amusement']) {
    const shown = getStudyPresentation('shanghai-zhongkao-2027', word(name))
    assert.equal(shown.source, 'syllabus', name)
    assert.equal(shown.illustration, undefined, name)
  }
  assert.equal(JSON.stringify(dictionary), before)
})

test('mobile, foreign dictionary, changed meaning/case/original examples all retain authoritative fallback', () => {
  const original = word('able')
  const changed = [
    ['cet4', original, true],
    ['shanghai-zhongkao-2027', original, false],
    ['shanghai-zhongkao-2027', { ...original, name: 'ABLE' }, true],
    ['shanghai-zhongkao-2027', { ...original, trans: ['another meaning'] }, true],
    ['shanghai-zhongkao-2027', { ...original, example: original.example.slice(0, 0) }, true],
    ['shanghai-zhongkao-2027', { ...original, example: original.example.map(ex => ({ ...ex, cn: 'new translation' })) }, true],
  ]
  for (const [dict, entry, desktop] of changed) {
    const shown = getStudyPresentation(dict, entry, desktop)
    assert.equal(shown.source, 'syllabus')
    assert.equal(shown.illustration, undefined)
    assert.deepEqual(shown.example, entry.example[0])
  }
  assert.equal(getStudyPresentation('shanghai-zhongkao-2027', word('television')).source, 'daily')
})

test('complete accounting and deterministic regeneration distinguish unreviewed from accepted content', () => {
  assert.deepEqual(audit.statistics, { dictionaryEntries: 2872, reviewedHeadwords: 219, enabledMappings: 216, pairedImages: 92, deferredQuality: 3, unreviewedEntries: 2653 })
  assert.equal(audit.entries.length, dictionary.length)
  const paths = ['src/resources/study-examples.json', 'docs/data/shanghai-2027-example-audit.json']
  const before = paths.map(path => readFileSync(path, 'utf8'))
  execFileSync(process.execPath, ['scripts/import-study-examples.mjs'])
  assert.deepEqual(paths.map(path => readFileSync(path, 'utf8')), before)
})
