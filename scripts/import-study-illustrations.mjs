import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Input is the original QWERTY_Plus_Shanghai2027_Image_Assets candidate package.
// Re-running from the same pinned package produces byte-identical metadata.
const assetRoot = resolve(process.argv[2] || '')
assert.ok(process.argv[2], 'Usage: node scripts/import-study-illustrations.mjs <candidate-package-directory>')
const source = JSON.parse(readFileSync(process.argv[3] || resolve(assetRoot, 'manifest.json'), 'utf8'))
const sourceCommit = '99c007673d38f02c418d8e4cd2e9ec90b5d40be5'
assert.equal(source.imageSourceCommit, sourceCommit)
assert.equal(source.license, 'CC BY 4.0')
const dictionary = JSON.parse(readFileSync('public/dicts/ShanghaiZhongkao2027.json', 'utf8'))
const exclusions = JSON.parse(readFileSync('scripts/data/study-illustration-exclusions.json', 'utf8'))
const candidates = new Map(source.mapping.map(entry => [entry.sourceEntryIndex, entry]))
const fileRecords = new Map(source.files.map(entry => [entry.path, entry]))
const registry = new Map()
const audit = []
const imageIds = new Set()
let totalBytes = 0
mkdirSync('public/images/word-atlas', { recursive: true })
mkdirSync('docs/data', { recursive: true })

for (const [index, word] of dictionary.entries()) {
  const candidate = candidates.get(index)
  const row = { index, word: word.name }
  if (!candidate) {
    audit.push({ ...row, status: 'no-source-image' })
    continue
  }
  assert.equal(candidate.word, word.name)
  assert.equal(candidate.syllabusMeaning, word.trans[0])
  assert.match(candidate.imageId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  const comparison = { atlasMeaning: candidate.atlasMeaning, sourceId: candidate.imageId }
  if (exclusions[word.name]) {
    audit.push({ ...row, ...comparison, status: 'excluded-sense', reason: exclusions[word.name] })
    continue
  }
  const file = fileRecords.get(candidate.image)
  assert.ok(file)
  assert.deepEqual(file.dimensions, [512, 512])
  const path = resolve(assetRoot, candidate.image)
  const bytes = readFileSync(path)
  assert.equal(bytes.length, file.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP')
  const entry = { word: word.name, sourceId: candidate.imageId, sourceMeaning: word.trans[0], sha256: file.sha256 }
  const key = JSON.stringify([word.name, word.trans[0]])
  if (registry.has(key)) assert.deepEqual(registry.get(key), entry)
  registry.set(key, entry)
  if (!imageIds.has(entry.sourceId)) {
    copyFileSync(path, 'public/images/word-atlas/' + entry.sourceId + '.webp')
    imageIds.add(entry.sourceId)
    totalBytes += bytes.length
  }
  audit.push({ ...row, ...comparison, status: 'enabled' })
}

const metadata = {
  sourceRepository: source.imageSourceRepository,
  sourceCommit,
  attribution: 'Word Atlas contributors',
  license: source.license,
  licenseUrl: source.licenseUrl,
  review: 'Syllabus/source sense comparison plus whole-catalog contact-sheet screening. Scenes support one existing sense, not necessarily every sense. Staging acceptance remains required.',
  dictionarySha256: createHash('sha256').update(readFileSync('public/dicts/ShanghaiZhongkao2027.json')).digest('hex'),
  statistics: {
    dictionaryEntries: dictionary.length,
    enabledEntries: audit.filter(entry => entry.status === 'enabled').length,
    enabledWords: new Set([...registry.values()].map(entry => entry.word)).size,
    guardedMappings: registry.size,
    uniqueImages: imageIds.size,
    excludedEntries: audit.filter(entry => entry.status === 'excluded-sense').length,
    missingEntries: audit.filter(entry => entry.status === 'no-source-image').length,
    imageBytes: totalBytes,
  },
  entries: audit,
}
writeFileSync('src/resources/study-illustrations.json', JSON.stringify([...registry.values()], null, 2) + '\n')
writeFileSync('docs/data/shanghai-2027-image-audit.json', JSON.stringify(metadata, null, 2) + '\n')
console.log(JSON.stringify(metadata.statistics))
