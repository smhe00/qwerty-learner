import {
  LEARN_TRACE_IR_VERSION,
  type LearnTraceEnvelope,
  type LearnSystemTraceEvent,
} from '../simulation/trace-ir'

export type TlcState = {
  number: number
  action: string
  values: Record<string, string | number | boolean>
}

function parseScalar(raw: string): string | number | boolean {
  const value = raw.trim()
  if (value === 'TRUE') return true
  if (value === 'FALSE') return false
  if (/^-?\d+$/.test(value)) return Number(value)
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  return value
}

export function parseTlcCounterexample(text: string): TlcState[] {
  const states: TlcState[] = []
  let current: TlcState | undefined

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const stateMatch = line.match(/^State\s+(\d+):\s*<(.+)>\s*$/)
    if (stateMatch) {
      current = {
        number: Number(stateMatch[1]),
        action: stateMatch[2],
        values: {},
      }
      states.push(current)
      continue
    }

    if (!current) continue

    const valueMatch = line.match(
      /^\/\\\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/,
    )
    if (!valueMatch) continue

    current.values[valueMatch[1]] = parseScalar(valueMatch[2])
  }

  return states
}

function numberValue(
  state: TlcState,
  key: string,
): number | null {
  const value = state.values[key]
  return typeof value === 'number' ? value : null
}

function stringValue(
  state: TlcState,
  key: string,
): string | null {
  const value = state.values[key]
  return typeof value === 'string' ? value : null
}

export function tlcStatesToLearnTrace(
  states: TlcState[],
  scenario = 'tlc-counterexample',
): LearnTraceEnvelope {
  const events: LearnSystemTraceEvent[] = []

  for (let index = 0; index < states.length; index += 1) {
    const state = states[index]
    const previous = states[index - 1]
    const phase = stringValue(state, 'phase')
    const previousPhase = previous
      ? stringValue(previous, 'phase')
      : null

    if (
      phase === 'acquisition' &&
      previousPhase !== 'acquisition'
    ) {
      const batchSize = numberValue(state, 'sessionSize') ?? 0
      events.push({
        kind: 'session-prepared',
        source: 'acquisition',
        sessionKind: 'acquisition',
        sessionId: `tlc:${state.number}`,
        batchSize,
        uniqueWords: batchSize,
        dueCount: numberValue(state, 'due') ?? 0,
        unseenCount: numberValue(state, 'unseen'),
        allowedNewWordsNow: batchSize,
        introducedToday: numberValue(state, 'introduced'),
        acquiredToday: numberValue(state, 'acquired'),
      })
    }
  }

  return {
    version: LEARN_TRACE_IR_VERSION,
    source: 'tlc-counterexample',
    scenario,
    events,
  }
}
