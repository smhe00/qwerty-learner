export type P3BrowserAction =
  | { kind: 'complete-current' }
  | { kind: 'reload' }
  | { kind: 'resize'; width: number; height: number }
  | { kind: 'blur-focus' }
  | { kind: 'route-cycle' }

export type P3BrowserFailure = {
  seed: number
  actions: P3BrowserAction[]
  failedAt: number
  message: string
}

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function generateP3BrowserActions(
  seed: number,
  steps: number,
): P3BrowserAction[] {
  const random = mulberry32(seed)
  const actions: P3BrowserAction[] = []

  for (let index = 0; index < steps; index += 1) {
    const value = random()
    if (value < 0.24) {
      actions.push({ kind: 'complete-current' })
    } else if (value < 0.45) {
      actions.push({ kind: 'reload' })
    } else if (value < 0.68) {
      actions.push({
        kind: 'resize',
        width: 900 + Math.floor(random() * 500),
        height: 650 + Math.floor(random() * 250),
      })
    } else if (value < 0.86) {
      actions.push({ kind: 'blur-focus' })
    } else {
      actions.push({ kind: 'route-cycle' })
    }
  }

  // Every seed includes at least one browser-only lifecycle action.
  if (
    !actions.some(
      (action) =>
        action.kind === 'resize' ||
        action.kind === 'blur-focus',
    )
  ) {
    actions[0] = {
      kind: 'resize',
      width: 1080 + (seed % 120),
      height: 720,
    }
  }

  return actions
}

export async function minimizeP3ActionSequence(
  actions: P3BrowserAction[],
  reproduces: (
    candidate: P3BrowserAction[],
  ) => Promise<boolean>,
): Promise<P3BrowserAction[]> {
  let current = [...actions]
  let granularity = 2

  while (current.length >= 2) {
    const chunkSize = Math.ceil(
      current.length / granularity,
    )
    let reduced = false

    for (
      let start = 0;
      start < current.length;
      start += chunkSize
    ) {
      const candidate = [
        ...current.slice(0, start),
        ...current.slice(start + chunkSize),
      ]
      if (
        candidate.length > 0 &&
        (await reproduces(candidate))
      ) {
        current = candidate
        granularity = Math.max(2, granularity - 1)
        reduced = true
        break
      }
    }

    if (reduced) continue
    if (granularity >= current.length) break
    granularity = Math.min(
      current.length,
      granularity * 2,
    )
  }

  let index = 0
  while (index < current.length) {
    const candidate = [
      ...current.slice(0, index),
      ...current.slice(index + 1),
    ]
    if (
      candidate.length > 0 &&
      (await reproduces(candidate))
    ) {
      current = candidate
    } else {
      index += 1
    }
  }

  return current
}
