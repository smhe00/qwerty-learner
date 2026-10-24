/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const built = await build({ entryPoints: ['src/sync/idle-maintenance-trigger.ts'], bundle: true,
  platform: 'node', format: 'esm', target: 'node20', write: false })
const source = 'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

test('login activity never starts maintenance before app mount and does not await slow cleanup', async t => {
  const trigger = await import(source + '#mount')
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-24T12:00:00Z') })
  let calls = 0
  let finish
  const send = () => { calls++; return new Promise(resolve => { finish = resolve }) }
  trigger.noteCloudActivity('login-token')
  t.mock.timers.tick(10000)
  assert.equal(calls, 0)
  assert.equal(trigger.startIdleMaintenance(send), undefined)
  t.mock.timers.tick(2499)
  assert.equal(calls, 0)
  t.mock.timers.tick(1)
  assert.equal(calls, 1)
  // A never-yet-resolved cleanup does not block further app activity.
  trigger.noteCloudActivity('login-token')
  t.mock.timers.tick(10000)
  assert.equal(calls, 1)
  finish({ status: 'complete' })
  await flush()
  trigger.noteCloudActivity('login-token')
  t.mock.timers.tick(10000)
  assert.equal(calls, 1)
  t.mock.timers.tick(86400000)
  trigger.noteCloudActivity('login-token')
  t.mock.timers.tick(2500)
  assert.equal(calls, 2)
  finish({ status: 'already_ran' })
  await flush()
})

test('maintenance failure is contained and retries only after later activity, not an autonomous timer', async t => {
  const trigger = await import(source + '#failure')
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-24T12:00:00Z') })
  let calls = 0
  trigger.startIdleMaintenance(async () => { calls++; throw new Error('offline') }, 'token')
  t.mock.timers.tick(2500)
  await flush()
  assert.equal(calls, 1)
  t.mock.timers.tick(3600000)
  await flush()
  assert.equal(calls, 1)
  trigger.noteCloudActivity('token')
  t.mock.timers.tick(2500)
  await flush()
  assert.equal(calls, 2)
})
