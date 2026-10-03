import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const dictionaryPath = new URL(
  '../../public/dicts/hujiaoxin2027.json',
  import.meta.url,
)
const resourcePath = new URL('../../src/resources/dictionary.ts', import.meta.url)
const storePath = new URL('../../src/store/index.ts', import.meta.url)
const typingPath = new URL('../../src/pages/Typing/index.tsx', import.meta.url)

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

test('沪教新初2027 is the single application default dictionary', () => {
  const resources = fs.readFileSync(resourcePath, 'utf8')
  const store = fs.readFileSync(storePath, 'utf8')
  const typing = fs.readFileSync(typingPath, 'utf8')

  assert.match(
    resources,
    /export const DEFAULT_DICTIONARY_ID = 'hujiaoxin2027'/,
  )
  assert.match(resources, /id: 'hujiaoxin2027'/)
  assert.match(resources, /name: '沪教新初2027'/)
  assert.match(resources, /url: '\/dicts\/hujiaoxin2027\.json'/)
  assert.match(resources, /length: 1751/)

  assert.match(store, /readStoredValue\('currentDict', DEFAULT_DICTIONARY_ID\)/)
  assert.match(store, /idDictionaryMap\[DEFAULT_DICTIONARY_ID\]/)
  assert.match(typing, /setCurrentDictId\(DEFAULT_DICTIONARY_ID\)/)

  assert.equal(
    /setCurrentDictId\('zhongkaohexin'\)/.test(typing),
    false,
  )
})
