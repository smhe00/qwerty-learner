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

    const stutteringMatch = line.match(
      /^State\s+(\d+):\s*Stuttering\s*$/,
    )
    if (stutteringMatch && current) {
      current = {
        number: Number(stutteringMatch[1]),
        action: 'Stuttering',
        values: { ...current.values },
      }
      states.push(current)
      continue
    }

    const backMatch = line.match(/^Back to state\s+(\d+):/)
    if (backMatch) {
      const target = states.find(
        (state) => state.number === Number(backMatch[1]),
      )
      if (target) {
        current = {
          number: (states.at(-1)?.number ?? target.number) + 1,
          action: `Back to state ${target.number}`,
          values: { ...target.values },
        }
        states.push(current)
      }
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

function booleanValue(
  state: TlcState,
  key: string,
): boolean | null {
  const value = state.values[key]
  return typeof value === 'boolean' ? value : null
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

    const clock = numberValue(state, 'clock')
    const resumeAfter = numberValue(state, 'resumeAfter')
    if (
      phase === 'deferred' &&
      clock !== null &&
      resumeAfter !== null
    ) {
      events.push({
        kind: 'acquisition-health',
        now: clock,
        opportunity: clock >= resumeAfter,
        pending: [
          {
            word: 'tlc:deferred-word',
            phase: 'deferred',
            deferredReason: 'formal',
            resumeAfter,
          },
        ],
      })
    } else if (phase === 'resumed') {
      events.push({
        kind: 'acquisition-health',
        now: clock ?? resumeAfter ?? 0,
        opportunity: false,
        pending: [],
      })
    }

    const durableVersion = numberValue(
      state,
      'durableVersion',
    )
    const previousDurableVersion = previous
      ? numberValue(previous, 'durableVersion')
      : null
    if (
      durableVersion !== null &&
      (index === 0 ||
        durableVersion !== previousDurableVersion)
    ) {
      events.push({
        kind: 'checkpoint',
        action: 'save',
        sessionId: 'tlc:checkpoint-session',
        index: durableVersion,
        isFinished:
          booleanValue(state, 'durableFinished') ?? false,
        queueSignature: 'formal-checkpoint-queue',
        wordCount: 3,
      })
    }

    if (
      phase === 'restored' &&
      previousPhase !== 'restored'
    ) {
      events.push({
        kind: 'checkpoint',
        action: 'restore',
        sessionId: 'tlc:checkpoint-session',
        index:
          numberValue(state, 'restoredVersion') ?? 0,
        isFinished:
          booleanValue(state, 'restoredFinished') ?? false,
        queueSignature: 'formal-checkpoint-queue',
        wordCount: 3,
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
