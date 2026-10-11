import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLearnBlockSize } from '../../src/learn/block-size'
import { planLearnAcquisitionCandidates, selectLearnMixedSessionItems, shouldRotateOversizedLearnSession } from '../../src/learn/session'

const words = Array.from({ length: 70 }, (_, i) => ({ name: `word-${i}`, trans: [], usphone: '', ukphone: '' }))

test('block size defaults to 20 and accepts only integer sizes 5–50', () => {
  for (const value of [undefined, null, NaN, Infinity, '50']) assert.equal(normalizeLearnBlockSize(value), 20)
  assert.equal(normalizeLearnBlockSize(4), 5)
  assert.equal(normalizeLearnBlockSize(51), 50)
  assert.equal(normalizeLearnBlockSize(23.9), 23)
})

for (const blockSize of [5, 20, 50]) {
  test(`block size ${blockSize} limits fresh, pending, Review and mixed cohorts`, () => {
    const base = { words, states: [], pendingStates: new Map(), introducedWords: [], freshLimit: 70, now: 1800000000, blockSize }
    assert.equal(planLearnAcquisitionCandidates(base).freshWords.length, blockSize)
    assert.equal(planLearnAcquisitionCandidates({ ...base, freshLimit: 3 }).freshWords.length, 3)
    const pendingStates = new Map(words.map(word => [word.name, { version: 1 as const, phase: 'supported' as const, assistedCycles: 0 }]))
    const pending = planLearnAcquisitionCandidates({ ...base, pendingStates, freshLimit: 0 })
    assert.equal(pending.resumed.length, blockSize)
    for (const dueWords of [[], words]) {
      const selection = selectLearnMixedSessionItems({ dueWords, acquisitionWords: words, blockSize })
      assert.equal(selection.selectedWords.length, blockSize)
      if (dueWords.length) assert.ok(selection.selectedReviewWords.length > 0, 'small blocks must retain due Review slots')
    }
    assert.equal(selectLearnMixedSessionItems({ dueWords: words, acquisitionWords: [], blockSize }).selectedWords.length, blockSize)
    assert.equal(shouldRotateOversizedLearnSession({ sessionKind: 'acquisition', words: words.slice(0, blockSize), blockSize }), false)
    assert.equal(shouldRotateOversizedLearnSession({ sessionKind: 'acquisition', words: words.slice(0, blockSize + 1), blockSize }), true)
  })
}

test('a saved 50-word block survives recovery independently of changed settings', () => {
  assert.equal(shouldRotateOversizedLearnSession({ sessionKind: 'acquisition', words: words.slice(0, 50), blockSize: 50 }), false)
  assert.equal(shouldRotateOversizedLearnSession({ sessionKind: 'acquisition', words: words.slice(0, 21) }), true, 'legacy checkpoint keeps default size guard')
})
