import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const bundle = await build({ stdin: { contents: "export * from './src/resources/dictionaryCatalog'; export * from './src/resources/dictionary'; export * from './src/resources/defaultDictionary'", resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', target: 'node18', format: 'esm' })
const catalog = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const { dictionaries, catalogCategories, catalogDictionaries, catalogSections, getCatalogCategory, getCatalogSelection, idDictionaryMap, DEFAULT_DICTIONARY_ID } = catalog

test('two-level catalog covers every eligible resource exactly once and retains original objects', () => {
  assert.deepEqual(catalogSections.map((section) => section.id), ['en', 'code'])
  assert.equal(new Set(catalogCategories.map((category) => category.id)).size, catalogCategories.length)
  const expected = dictionaries.filter((dict) => ['en', 'code'].includes(dict.languageCategory))
  assert.deepEqual(catalogDictionaries, expected)
  for (const dict of dictionaries) {
    const category = getCatalogCategory(dict)
    if (!expected.includes(dict)) { assert.equal(category, undefined); assert.ok(idDictionaryMap[dict.id]); continue }
    assert.ok(catalogDictionaries.includes(dict))
    assert.equal(catalogCategories.filter((item) => item.id === category).length, 1, dict.id)
  }
  for (const category of catalogCategories) assert.ok(catalogDictionaries.some((dict) => getCatalogCategory(dict) === category.id), category.id)
  console.log('Catalog audit:', dictionaries.length, 'retained resources;', expected.length, 'visible;', dictionaries.length - expected.length, 'hidden')
})

test('default and legacy dictionary lookup remain intact; hidden courses only fall back for browsing', () => {
  assert.equal(DEFAULT_DICTIONARY_ID, 'shanghai-zhongkao-2027')
  assert.deepEqual(getCatalogSelection(idDictionaryMap[DEFAULT_DICTIONARY_ID]), { section: 'en', category: 'middle' })
  assert.equal(getCatalogCategory(idDictionaryMap.en2german), undefined)
  assert.deepEqual(getCatalogSelection(idDictionaryMap.en2german), { section: 'en', category: 'middle' })
  assert.equal(idDictionaryMap.en2german.languageCategory, 'de')
})

test('misleading original tags do not misplace professional, code, course and exam resources', () => {
  for (const [id, category] of Object.entries({ itVocabulary: 'computing', archVocabulary: 'professional', SoundSfxKey: 'media', SoundSfxKey2: 'media', childCode: 'beginner', 'python-builtin': 'python', jsArray: 'javascript', pets3: 'other-exams', 'pet-2024': 'cambridge', Oxford3000: 'general', 'raz-AA': 'reading', nce1: 'reading', gaokao3500: 'high', hujiaoxin2027: 'middle', 'zhuan-cha-ben-ying-yu': 'other-exams', Yilin1: 'high', jijiao9: 'middle', 'shanghai-6-2word': 'middle', san1: 'school' })) assert.equal(getCatalogCategory(idDictionaryMap[id]), category, id)
})

test('merged display categories have distinct React keys despite existing duplicate IDs', () => {
  const keys = catalogDictionaries.map((dict) => dict.id + ':' + dict.url + ':' + dict.category)
  assert.equal(new Set(keys).size, keys.length)
})
