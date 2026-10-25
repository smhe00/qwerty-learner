/* eslint-env node */
// Test-only atomic store; NOT a production or cross-process implementation.
export class AtomicTestStore {
  states = new Map()
  waiters = []
  async transact(key, update) {
    // Synchronous transition models one durable atomic transaction. Separate
    // barrier instances share this store only to test protocol interleavings.
    const { state, result } = update(structuredClone(this.states.get(key) ?? null))
    this.states.set(key, structuredClone(state))
    for (const entry of [...this.waiters]) {
      if (entry.predicate(state)) {
        this.waiters.splice(this.waiters.indexOf(entry), 1)
        entry.resolve(structuredClone(state))
      }
    }
    return structuredClone(result)
  }
  when(predicate) {
    const found = [...this.states.values()].find(predicate)
    if (found) return Promise.resolve(structuredClone(found))
    return new Promise(resolve => this.waiters.push({ predicate, resolve }))
  }
}
export function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
