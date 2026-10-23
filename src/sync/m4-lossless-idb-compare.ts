/**
 * Fail-closed comparison of structured-clone IndexedDB rows. JSON.stringify
 * silently equates NaN and null, drops undefined and loses sparse array
 * structure. That is unsuitable as evidence for an untouched V4 table.
 *
 * Unsupported prototypes, cycles or extremely deep/large structures block
 * rather than pretending that the stored values are identical.
 */
export function sameLosslessIndexedDbValue(a: unknown, b: unknown): boolean {
  const activeLeft = new WeakSet<object>()
  const activeRight = new WeakSet<object>()
  // Check shared-reference topology, not only nested field values. A
  // structured-clone payload with two aliases must NOT be mistaken for one
  // that duplicated the same Word object into independent instances.
  const leftToRight = new WeakMap<object, object>()
  const rightToLeft = new WeakMap<object, object>()
  let visited = 0

  const equal = (left: unknown, right: unknown, depth: number): boolean => {
    if (++visited > 1_000_000 || depth > 100) return false
    if (Object.is(left, right)) return true
    if (!left || !right || typeof left !== 'object' ||
        typeof right !== 'object') return false
    if (activeLeft.has(left) || activeRight.has(right)) return false
    const mappedRight = leftToRight.get(left)
    const mappedLeft = rightToLeft.get(right)
    if ((mappedRight !== undefined && mappedRight !== right) ||
        (mappedLeft !== undefined && mappedLeft !== left)) return false
    leftToRight.set(left, right)
    rightToLeft.set(right, left)

    if (left instanceof Date || right instanceof Date) {
      return left instanceof Date && right instanceof Date &&
        Object.is(left.getTime(), right.getTime())
    }
    if (left instanceof ArrayBuffer || right instanceof ArrayBuffer) {
      if (!(left instanceof ArrayBuffer) ||
          !(right instanceof ArrayBuffer) ||
          left.byteLength !== right.byteLength) return false
      const l = new Uint8Array(left)
      const r = new Uint8Array(right)
      return l.every((value, index) => value === r[index])
    }
    if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
      if (!ArrayBuffer.isView(left) || !ArrayBuffer.isView(right) ||
          left.constructor !== right.constructor ||
          left.byteLength !== right.byteLength) return false
      const l = new Uint8Array(left.buffer, left.byteOffset, left.byteLength)
      const r = new Uint8Array(right.buffer, right.byteOffset, right.byteLength)
      return l.every((value, index) => value === r[index])
    }
    if (Array.isArray(left) !== Array.isArray(right)) return false
    if (Array.isArray(left) && Array.isArray(right) &&
        left.length !== right.length) return false

    if (!Array.isArray(left)) {
      const lp = Object.getPrototypeOf(left)
      const rp = Object.getPrototypeOf(right)
      if ((lp !== Object.prototype && lp !== null) ||
          (rp !== Object.prototype && rp !== null)) return false
    }
    const lk = Object.keys(left).sort()
    const rk = Object.keys(right).sort()
    if (lk.length !== rk.length || lk.some((key, i) => key !== rk[i])) {
      return false
    }
    activeLeft.add(left)
    activeRight.add(right)
    try {
      return lk.every(key => equal(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key], depth + 1,
      ))
    } finally {
      activeLeft.delete(left)
      activeRight.delete(right)
    }
  }
  return equal(a, b, 0)
}
