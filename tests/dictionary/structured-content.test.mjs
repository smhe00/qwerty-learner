import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const source = new URL('../../src/utils/dictionaryContent.ts', import.meta.url)
const bundled = buildSync({ entryPoints: [fileURLToPath(source)], bundle: true, platform: 'node', format: 'esm', write: false })
const { createDictionaryContent, getDictionaryContent, getDictionaryMeaning, dictionaryContentKinds } =
  await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const words = JSON.parse(readFileSync(new URL('../../public/dicts/ShanghaiZhongkao2027.json', import.meta.url), 'utf8'))

test('all authoritative fields, word order, duplicate names and example mask ranges are unchanged', () => {
  const original = words.map(({ content, ...word }) => word)
  const payload = JSON.stringify(original, null, 2)
  const originalBlob = createHash('sha1').update('blob ' + Buffer.byteLength(payload) + '\0').update(payload).digest('hex')
  assert.equal(originalBlob, 'b5965a065232cee4658f2a380b26c09ad0858ed0')
  assert.equal(words.length, 2872)
})

test('every original source line occurs exactly once in the structured content', () => {
  for (const [index, word] of words.entries()) {
    assert.ok(getDictionaryContent(word), index + ': ' + word.name)
    const entries = dictionaryContentKinds.flatMap(kind => word.content[kind])
    assert.equal(entries.length, word.trans.length, index + ': source count')
    assert.deepEqual([...entries].sort((a, b) => a.sourceIndex - b.sourceIndex).map(entry => entry.text), word.trans)
    assert.deepEqual(word.content, createDictionaryContent(word.trans), index + ': deterministic classification')
    assert.ok(word.content.senses.length > 0)
  }
})

test('classification retains source text, repeated lines, phrase definitions and unknown annotations', () => {
  const trans = ['一种；一类', '词组 a kind of 一种', 'kindness n.善良', '近义 sort', '反义 unkind',
    '点拨 不改写任何标点、空格。', '无法明确分类的原文', '词组 a kind of 一种']
  const before = JSON.stringify(trans)
  const content = createDictionaryContent(trans)
  assert.deepEqual(content.senses, [{ sourceIndex: 0, text: trans[0] }])
  assert.equal(content.collocations.length, 2)
  assert.equal(content.relatedWords.length, 1)
  assert.equal(content.synonyms.length, 1)
  assert.equal(content.antonyms.length, 1)
  assert.equal(content.notes.length, 1)
  assert.equal(content.extra.length, 1)
  assert.equal(JSON.stringify(trans), before)
})

test('old, malformed, partial, duplicated and stale structures fall back to complete original definitions', () => {
  const trans = ['n. 能力，才能，本领', '词组 have the ability to do sth.具备做某事的能力']
  const valid = createDictionaryContent(trans)
  assert.equal(getDictionaryMeaning({ trans, content: valid }), trans[0])
  const invalid = [
    undefined, null, {}, { ...valid, version: 2 },
    { ...valid, notes: undefined },
    { ...valid, collocations: [] },
    { ...valid, collocations: [{ sourceIndex: 0, text: trans[0] }] },
    { ...valid, collocations: [{ sourceIndex: 1, text: 'changed meaning' }] },
    { ...valid, collocations: [{ sourceIndex: -1, text: trans[1] }] },
    { ...valid, senses: [] },
  ]
  for (const content of invalid) {
    assert.equal(getDictionaryContent({ trans, content }), null)
    assert.equal(getDictionaryMeaning({ trans, content }), trans.join('；'))
  }
})

test('unrevealed meaning cannot contain collocations, word-family answers or usage notes', () => {
  for (const name of ['ability', 'remember', 'borrow']) {
    const word = words.find(word => word.name === name)
    assert.equal(getDictionaryMeaning(word), word.content.senses.map(entry => entry.text).join('；'))
    assert.ok(word.content.notes.length || word.content.collocations.length)
    assert.ok(getDictionaryMeaning(word).length < word.trans.join('；').length)
  }
})
