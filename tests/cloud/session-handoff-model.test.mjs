/* eslint-env node */
import test from 'node:test'
import assert from 'node:assert/strict'

// Finite interleaving exploration of SINGLE-USE immutable ticket admission.
// Every participant publication, membership listing and individual ticket read
// is a separate schedulable transition. No read-modify-write or CAS primitive.
// This models mutual exclusion, not provider availability or a production proof.
function explore(n, weakListings = false) {
  // Per actor: pc, chosen-membership, scan-index, maximum, ticket, check-membership
  const initial = [0, 0, ...Array(n * 6).fill(0)] // intent, terminal, then actors
  const seen = new Set(), todo = [initial]
  let states = 0
  while (todo.length) {
    const state = todo.pop(), id = state.join(',')
    if (seen.has(id)) continue
    seen.add(id); states++
    const offset = actor => 2 + actor * 6
    if (Array.from({ length: n }, (_, i) => state[offset(i)]).filter(pc => pc === 6).length > 1) {
      return { states, violation: true }
    }
    for (let actor = 0; actor < n; actor++) {
      const k = offset(actor), pc = state[k], bit = 1 << actor
      if (pc === 7) continue
      const next = [...state]
      if (pc === 0) { next[0] |= bit; next[k] = 1 }
      if (pc === 1) { next[k + 1] = weakListings ? bit : state[0]; next[k + 2] = 0; next[k] = 2 }
      if (pc === 2) {
        const index = state[k + 2]
        if (index === n) next[k] = 3
        else {
          if (state[k + 1] & (1 << index)) next[k + 3] = Math.max(state[k + 3], state[offset(index) + 4])
          next[k + 2]++
        }
      }
      if (pc === 3) { next[k + 4] = state[k + 3] + 1; next[k] = 4 }
      if (pc === 4) { next[k + 5] = weakListings ? bit : state[0]; next[k + 2] = 0; next[k] = 5 }
      if (pc === 5) {
        const peer = state[k + 2]
        if (peer === n) next[k] = 6
        else {
          const number = state[offset(peer) + 4], own = state[k + 4]
          const livePeer = peer !== actor && (state[k + 5] & (1 << peer)) && !(state[1] & (1 << peer))
          if (livePeer && (number === 0 || number < own || (number === own && peer < actor))) next[k] = 4
          else next[k + 2]++
        }
      }
      if (pc === 6) { next[1] |= bit; next[k] = 7 }
      todo.push(next)
      // Cancellation is allowed only before the business operation starts;
      // the durable terminal receipt dominates every later ticket observation.
      if (pc > 0 && pc < 6) {
        const cancel = [...state]; cancel[1] |= bit; cancel[k] = 7; todo.push(cancel)
      }
    }
  }
  return { states, violation: false }
}

test('finite model: exhaustive three-contender schedules preserve mutual exclusion', { timeout: 30000 }, () => {
  const result = explore(3)
  console.log('handoff-ticket-model', JSON.stringify(result))
  assert.equal(result.violation, false)
  assert.ok(result.states > 1000)
})

test('negative control: incomplete/stale membership makes the safety property false', () => {
  assert.equal(explore(2, true).violation, true)
})
