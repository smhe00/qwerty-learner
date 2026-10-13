import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateEdgeClock } from '../../src/sync/v4-clock-gate'

const sample = (offset: number, rtt = 100, start = 1_800_000_000_000) => ({
  sentWallMs: start, receivedWallMs: start + rtt, roundTripMs: rtt,
  serverTimeMs: Math.round(start + rtt / 2 + offset),
})

test('EdgeOne + local clocks within five seconds may pass merge clock preflight', () => {
  const result = evaluateEdgeClock([
    sample(200, 70), sample(240, 90), sample(180, 100),
  ])
  assert.equal(result.trusted, true)
  assert.equal(result.reason, 'within-tolerance')
  assert.equal(result.offsetMs, 200)
})

test('large clock skew blocks automatic merge even with healthy network', () => {
  for (const offset of [-12_000, 12_000]) {
    const result = evaluateEdgeClock([sample(offset), sample(offset + 40)])
    assert.equal(result.trusted, false)
    assert.equal(result.reason, 'clock-skew')
  }
})

test('slow probes, absent capability or single probe fail closed', () => {
  assert.equal(evaluateEdgeClock([]).trusted, false)
  assert.equal(evaluateEdgeClock([sample(0)]).reason, 'insufficient-samples')
  assert.equal(evaluateEdgeClock([
    sample(0, 2_000), sample(0, 1_800),
  ]).reason, 'slow-network')
  assert.equal(evaluateEdgeClock([
    sample(0), { ...sample(0), serverTimeMs: NaN },
  ]).trusted, false)
})

test('unstable origin samples block rather than choosing an arbitrary server', () => {
  const result = evaluateEdgeClock([
    sample(0, 30), sample(4_000, 40), sample(100, 50),
  ])
  assert.equal(result.trusted, false)
  assert.equal(result.reason, 'unstable-clock')
})

test('wall clock jumping during request invalidates the probe', () => {
  const invalid = { ...sample(0), receivedWallMs: 1_800_000_005_000 }
  assert.equal(evaluateEdgeClock([invalid, sample(0)]).trusted, false)
})

test('server time uncertainty is included in skew tolerance', () => {
  // Offset is technically less than five seconds but RTT uncertainty
  // crosses the tolerance edge: fail closed.
  const result = evaluateEdgeClock([sample(4_700, 1_000), sample(4_710, 1_200)])
  assert.equal(result.trusted, false)
  assert.equal(result.reason, 'clock-skew')
})
