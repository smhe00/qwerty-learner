/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { isCurrentStagingProject } from '../../scripts/idle-project-binding.mjs'
const current = { RepoBranch: 'edgeone-test', CustomDomains: [{ Domain: 't.smhe.cn', Status: 'Pass' }] }
test('exact passed current domain plus staging branch identifies the target', () => {
  assert.equal(isCurrentStagingProject(current), true)
})
test('old preset and expected branch without current domain cannot authorize writes', () => {
  assert.equal(isCurrentStagingProject({ RepoBranch: 'edgeone-test', PresetDomain: 'etest.edgeone.dev', CustomDomains: [] }), false)
})
test('pending, lookalike and production domain or branch cannot authorize writes', () => {
  for (const Domain of ['t.smhe.cn.attacker.invalid', 'not-t.smhe.cn', 'q.smhe.cn', '']) {
    assert.equal(isCurrentStagingProject({ ...current, CustomDomains: [{ Domain, Status: 'Pass' }] }), false)
  }
  assert.equal(isCurrentStagingProject({ ...current, RepoBranch: 'master' }), false)
  assert.equal(isCurrentStagingProject({ ...current, CustomDomains: [{ Domain: 't.smhe.cn', Status: 'Pending' }] }), false)
  assert.equal(isCurrentStagingProject({ ...current, CustomDomains: [...current.CustomDomains, { Domain: 'q.smhe.cn', Status: 'Pass' }] }), false)
})
test('missing raw bindings never fall back to normalized SDK fields', () => {
  for (const row of [null, undefined, {}, { ...current, CustomDomains: undefined }, { presetDomain: 'etest.edgeone.dev' }]) {
    assert.equal(isCurrentStagingProject(row), false)
  }
})
