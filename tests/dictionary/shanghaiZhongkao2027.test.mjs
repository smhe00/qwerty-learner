import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const dictionaryPath = new URL(
  '../../public/dicts/ShanghaiZhongkao2027.json',
  import.meta.url,
)
const resourcePath = new URL('../../src/resources/dictionary.ts', import.meta.url)
const defaultDictionaryPath = new URL(
  '../../src/resources/defaultDictionary.ts',
  import.meta.url,
)
const storePath = new URL('../../src/store/index.ts', import.meta.url)

const words = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'))

test('上海中考2027 dictionary has the supported schema and runtime example contract', () => {
  assert.equal(Array.isArray(words), true)
  assert.equal(words.length, 2872)

  const serializedEntries = new Set()

  for (const [index, word] of words.entries()) {
    assert.equal(typeof word, 'object', `entry ${index} must be an object`)
    assert.equal(typeof word.name, 'string', `entry ${index} name`)
    assert.ok(word.name.trim().length > 0, `entry ${index} name must not be empty`)
    assert.equal(typeof word.usphone, 'string', `entry ${index} usphone`)
    assert.equal(typeof word.ukphone, 'string', `entry ${index} ukphone`)
    assert.ok(Array.isArray(word.trans), `entry ${index} trans must be an array`)
    assert.ok(word.trans.length > 0, `entry ${index} trans must not be empty`)
    assert.ok(Array.isArray(word.example), `entry ${index} example must be an array`)
    assert.ok(Array.isArray(word.tags), `entry ${index} tags must be an array`)

    const serialized = JSON.stringify(word)
    assert.equal(
      serializedEntries.has(serialized),
      false,
      `entry ${index} is an exact duplicate`,
    )
    serializedEntries.add(serialized)

    for (const [exampleIndex, example] of word.example.entries()) {
      assert.equal(typeof example.en, 'string', `entry ${index} example ${exampleIndex} en`)
      assert.equal(typeof example.cn, 'string', `entry ${index} example ${exampleIndex} cn`)
      assert.equal(Number.isInteger(example.start), true, `entry ${index} example ${exampleIndex} start`)
      assert.equal(Number.isInteger(example.end), true, `entry ${index} example ${exampleIndex} end`)
      assert.ok(example.start >= 0, `entry ${index} example ${exampleIndex} start must be >= 0`)
      assert.ok(example.end > example.start, `entry ${index} example ${exampleIndex} range must be non-empty`)
      assert.ok(example.end <= example.en.length, `entry ${index} example ${exampleIndex} end must fit en`)
    }
  }
})

test('上海中考2027 is the new-user default and 中考 is the first English library tag', () => {
  const resources = fs.readFileSync(resourcePath, 'utf8')
  const defaults = fs.readFileSync(defaultDictionaryPath, 'utf8')
  const store = fs.readFileSync(storePath, 'utf8')

  assert.match(
    defaults,
    /export const DEFAULT_DICTIONARY_ID = 'shanghai-zhongkao-2027'/,
  )

  const chinaExamStart = resources.indexOf('const chinaExam: DictionaryResource[] = [')
  const shanghaiPos = resources.indexOf("id: 'shanghai-zhongkao-2027'")
  const cet4Pos = resources.indexOf("id: 'cet4'")
  assert.ok(chinaExamStart >= 0)
  assert.ok(shanghaiPos > chinaExamStart)
  assert.ok(shanghaiPos < cet4Pos)

  assert.match(resources, /name: '上海中考2027'/)
  assert.match(resources, /description: '上海中考2027词汇表'/)
  assert.match(resources, /category: '中国考试'/)
  assert.match(resources, /tags: \['中考'\]/)
  assert.match(resources, /url: '\/dicts\/ShanghaiZhongkao2027\.json'/)
  assert.match(resources, /length: 2872/)

  assert.equal((resources.match(/id: 'zhongkaohexin'/g) ?? []).length, 1)
  const zhongkaoCorePos = resources.indexOf("id: 'zhongkaohexin'")
  assert.ok(zhongkaoCorePos > shanghaiPos)
  assert.ok(zhongkaoCorePos < cet4Pos)

  assert.match(store, /readStoredValue\('currentDict', DEFAULT_DICTIONARY_ID\)/)
  assert.match(store, /idDictionaryMap\[DEFAULT_DICTIONARY_ID\]/)
})
