import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
const source = read('scripts/data/word-atlas-daily-source.json')
const review = read('scripts/data/study-example-reviews.json')
const dictionary = read('public/dicts/ShanghaiZhongkao2027.json')
const assets = read('src/resources/study-illustrations.json')
assert.equal(source.source.commit, '99c007673d38f02c418d8e4cd2e9ec90b5d40be5')
assert.equal(source.source.license, 'CC BY 4.0')
const sources = new Map(source.entries.map(entry => [entry.word, entry]))
const decisions = new Map(review.entries.map(entry => [JSON.stringify([entry.word, entry.sourceMeaning]), entry]))
assert.equal(sources.size, source.entries.length)
assert.equal(decisions.size, review.entries.length)
const surfaces = { chicken: 'chickens', vegetable: 'vegetables', learn: 'learning', talk: 'talked', dance: 'danced', draw: 'drew', flower: 'flowers', star: 'stars', watch: 'watched', animal: 'animals', allow: 'allows', design: 'designed' }
const catalog = []
const audit = []
const seen = new Set()
for (const [index, word] of dictionary.entries()) {
  const key = JSON.stringify([word.name, word.trans[0]])
  const decision = decisions.get(key)
  if (!decision) { audit.push({ index, word: word.name, status: 'not-reviewed' }); continue }
  const original = sources.get(word.name)
  assert.ok(original)
  if (decision.quality !== 'accepted') {
    audit.push({ index, word: word.name, status: 'deferred-quality', reason: decision.qualityReason })
    continue
  }
  const { en, zh: cn } = original.example
  assert.ok(en && cn)
  const surface = surfaces[word.name] || word.name
  const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...en.matchAll(new RegExp('\\b' + escaped + '\\b', 'gi'))]
  assert.equal(matches.length, 1, word.name + ': one unambiguous target required')
  const start = matches[0].index
  const example = { en, cn, start, end: start + matches[0][0].length }
  // Freeze the complete original example array too: an upstream content change
  // invalidates this review instead of silently carrying it to a changed card.
  const entry = { word: word.name, sourceMeaning: word.trans[0], syllabusExamples: word.example || [], example }
  const asset = assets.find(asset => asset.word === word.name && asset.sourceMeaning === word.trans[0] && asset.sourceId === original.sourceId)
  if (decision.image === 'matched' && asset) entry.illustrationId = asset.sourceId
  if (!seen.has(key)) { seen.add(key); catalog.push(entry) }
  audit.push({ index, word: word.name, status: 'enabled', imagePaired: Boolean(entry.illustrationId), sourceEntryUrl: original.sourceEntryUrl,
    qualityReason: decision.qualityReason, imageReason: decision.imageReason })
}
for (const decision of review.entries) assert.ok(dictionary.some(word => word.name === decision.word && word.trans[0] === decision.sourceMeaning))
const metadata = {
  source: source.source,
  dictionarySha256: createHash('sha256').update(readFileSync('public/dicts/ShanghaiZhongkao2027.json')).digest('hex'),
  scope: review.reviewSet,
  review: review.reviewer,
  imageCriterion: review.imageCriterion,
  statistics: { dictionaryEntries: dictionary.length, reviewedHeadwords: review.entries.length, enabledMappings: catalog.length,
    pairedImages: catalog.filter(entry => entry.illustrationId).length, deferredQuality: audit.filter(entry => entry.status === 'deferred-quality').length,
    unreviewedEntries: audit.filter(entry => entry.status === 'not-reviewed').length },
  entries: audit,
}
writeFileSync('src/resources/study-examples.json', JSON.stringify(catalog, null, 2) + '\n')
writeFileSync('docs/data/shanghai-2027-example-audit.json', JSON.stringify(metadata, null, 2) + '\n')
console.log(JSON.stringify(metadata.statistics))
