import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const dictionaryPath = new URL(
  '../../public/dicts/hujiaoxin2027.json',
  import.meta.url,
)
const resourcePath = new URL('../../src/resources/dictionary.ts', import.meta.url)
const words = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'))

test('沪教新初2027 dictionary has the supported core schema', () => {
  assert.equal(Array.isArray(words), true)
  assert.equal(words.length, 1751)

  const serializedEntries = new Set()

  for (const [index, word] of words.entries()) {
    assert.equal(typeof word, 'object', `entry ${index} must be an object`)
    assert.equal(typeof word.name, 'string', `entry ${index} name`)
    assert.ok(word.name.trim().length > 0, `entry ${index} name must not be empty`)
    assert.equal(typeof word.usphone, 'string', `entry ${index} usphone`)
    assert.equal(typeof word.ukphone, 'string', `entry ${index} ukphone`)
    assert.ok(Array.isArray(word.trans), `entry ${index} trans must be an array`)
    assert.ok(word.trans.length > 0, `entry ${index} trans must not be empty`)
    assert.ok(
      word.trans.every(
        (item) => typeof item === 'string' && item.trim().length > 0,
      ),
      `entry ${index} trans must contain non-empty strings`,
    )

    for (const value of [word.name, word.usphone, word.ukphone, ...word.trans]) {
      assert.equal(
        /[\u0000-\u001f]/.test(value),
        false,
        `entry ${index} contains a control character`,
      )
    }

    const serialized = JSON.stringify(word)
    assert.equal(
      serializedEntries.has(serialized),
      false,
      `entry ${index} is an exact duplicate`,
    )
    serializedEntries.add(serialized)
  }
})

test('known source-data regressions remain corrected', () => {
  const byName = new Map(words.map((word) => [word.name, word]))

  assert.equal(byName.get('title')?.usphone, 'ˈtaɪtəl')
  assert.equal(byName.get('theory')?.usphone, 'ˈθɪri')
  assert.equal(byName.get('respond')?.usphone, 'rɪˈspɑːnd')
  assert.equal(byName.get('diet')?.usphone, 'ˈdaɪət')
  assert.equal(byName.get('goods')?.usphone, 'ɡʊdz')
  assert.deepEqual(byName.get('homework')?.trans, ['n.（学生的）家庭作业'])
  assert.deepEqual(byName.get('born')?.trans, [
    'v.（仅用于被动语态 be born）出生',
  ])

  for (const name of [
    'chopsticks',
    'jeans',
    'regards',
    'lyrics',
    'scissors',
    'goods',
    'trainers',
  ]) {
    const translation = byName.get(name)?.trans?.join('') ?? ''
    assert.equal(
      translation.includes('(pl.') && !translation.includes('(pl.)'),
      false,
      `${name} has a malformed plural marker`,
    )
  }
})

test('沪教新初2027 remains registered as a built-in dictionary', () => {
  const resources = fs.readFileSync(resourcePath, 'utf8')

  assert.match(resources, /id: 'hujiaoxin2027'/)
  assert.match(resources, /name: '沪教新初2027'/)
  assert.match(resources, /url: '\/dicts\/hujiaoxin2027\.json'/)
  assert.match(resources, /length: 1751/)
})

test('沪教新初2027 examples satisfy the runtime mask contract', () => {
  let exampleCount = 0
  let noExampleCount = 0

  for (const [index, word] of words.entries()) {
    assert.ok(Array.isArray(word.example), `entry ${index} example must be an array`)
    assert.ok(Array.isArray(word.tags), `entry ${index} tags must be an array`)

    if (word.example.length === 0) {
      noExampleCount += 1
    }

    for (const [exampleIndex, example] of word.example.entries()) {
      exampleCount += 1
      assert.equal(typeof example.en, 'string', `entry ${index} example ${exampleIndex} en`)
      assert.equal(typeof example.cn, 'string', `entry ${index} example ${exampleIndex} cn`)
      assert.equal(Number.isInteger(example.start), true, `entry ${index} example ${exampleIndex} start`)
      assert.equal(Number.isInteger(example.end), true, `entry ${index} example ${exampleIndex} end`)
      assert.ok(example.start >= 0, `entry ${index} example ${exampleIndex} start must be >= 0`)
      assert.ok(example.end > example.start, `entry ${index} example ${exampleIndex} range must be non-empty`)
      assert.ok(example.end <= example.en.length, `entry ${index} example ${exampleIndex} end must fit en`)
      assert.ok(
        example.en.slice(example.start, example.end).length > 0,
        `entry ${index} example ${exampleIndex} mask surface must be non-empty`,
      )
    }
  }

  assert.equal(exampleCount, 1616)
  assert.equal(noExampleCount, 135)
})

test('沪教新初2027 includes real data for new example and fallback flows', () => {
  const byName = new Map()
  for (const word of words) {
    if (!byName.has(word.name)) byName.set(word.name, word)
  }

  const phrase = byName.get('living room')
  assert.ok(phrase?.example?.length)
  const phraseExample = phrase.example[0]
  assert.equal(
    phraseExample.en.slice(phraseExample.start, phraseExample.end),
    'living room',
  )

  const inflected = byName.get('shoot')
  assert.ok(inflected?.example?.length)
  const inflectedExample = inflected.example[0]
  assert.equal(
    inflectedExample.en.slice(inflectedExample.start, inflectedExample.end),
    'shot',
  )
  assert.notEqual('shot', inflected.name)

  assert.deepEqual(byName.get('everyone')?.example, [])
  assert.deepEqual(byName.get('p.m.')?.example, [])
})
