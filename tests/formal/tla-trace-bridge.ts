import {
  LEARN_TRACE_IR_VERSION,
  type LearnTraceEnvelope,
  type LearnSystemTraceEvent,
} from '../../src/learn/trace-ir'

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
      (phase === 'acquisition' || phase === 'mixed') &&
      previousPhase !== phase
    ) {
      const batchSize = numberValue(state, 'sessionSize') ?? 0
      const acquisitionSize =
        phase === 'mixed'
          ? numberValue(state, 'acquisitionSize') ?? 0
          : batchSize
      events.push({
        kind: 'session-prepared',
        source: phase,
        sessionKind: phase,
        sessionId: `tlc:${state.number}`,
        batchSize,
        uniqueWords: batchSize,
        dueCount: numberValue(state, 'due') ?? 0,
        unseenCount: numberValue(state, 'unseen'),
        allowedNewWordsNow: acquisitionSize,
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

    const isCheckpointSave =
      state.action.includes('SaveProgress') ||
      state.action.includes('SaveTerminal')
    if (isCheckpointSave) {
      const version = numberValue(state, 'durableVersion')
      const finished = state.values.durableFinished
      if (
        version !== null &&
        typeof finished === 'boolean'
      ) {
        events.push({
          kind: 'checkpoint',
          action: 'save',
          sessionId: 'tlc:checkpoint-session',
          index: version,
          isFinished: finished,
          queueSignature: 'formal-checkpoint',
          wordCount: 3,
        })
      }
    }

    const isCheckpointRestore =
      state.action.includes('Refresh') &&
      phase === 'restored'
    if (isCheckpointRestore) {
      const version = numberValue(state, 'restoredVersion')
      const finished = state.values.restoredFinished
      if (
        version !== null &&
        typeof finished === 'boolean'
      ) {
        events.push({
          kind: 'checkpoint',
          action: 'restore',
          sessionId: 'tlc:checkpoint-session',
          index: version,
          isFinished: finished,
          queueSignature: 'formal-checkpoint',
          wordCount: 3,
        })
      }
    }

    if (
      phase === 'budget-selected' &&
      previousPhase !== 'budget-selected'
    ) {
      const targetDailyNewWords =
        numberValue(state, 'target') ?? 0
      const introducedToday =
        numberValue(state, 'introduced') ?? 0
      const acquiredToday =
        numberValue(state, 'acquired') ?? 0
      const unseenCount =
        numberValue(state, 'unseen')
      const dueCount =
        state.values.due === true ? 1 : 0
      const allowedNow =
        numberValue(state, 'allowedNow') ?? 0
      const freshSelected =
        numberValue(state, 'freshSelected') ?? 0
      const readyPendingCount =
        numberValue(state, 'readyPending') ?? 0
      const pendingSelected =
        numberValue(state, 'pendingSelected') ?? 0
      const expectedAllowedNow = Math.min(
        Math.max(0, targetDailyNewWords - introducedToday),
        Math.max(0, unseenCount ?? 0),
      )
      const expectedPendingSelected =
        readyPendingCount

      events.push({
        kind: 'fresh-budget',
        targetDailyNewWords,
        introducedToday,
        acquiredToday,
        unseenCount,
        dueCount,
        allowedNow,
        expectedAllowedNow,
        freshSelected,
        readyPendingCount,
        pendingSelected,
        expectedPendingSelected,
      })
    }

    if (
      phase === 'decided' &&
      previousPhase !== 'decided'
    ) {
      const recoverableCount =
        numberValue(state, 'recoverableCount') ?? 0
      const expectedSession =
        numberValue(state, 'expectedSession') ?? 0
      const selectedSession =
        numberValue(state, 'selectedSession') ?? 0
      const selectedCount =
        numberValue(state, 'selectedCount') ?? 0
      const decision = stringValue(state, 'decision')
      const selectedDictMatches =
        state.values.selectedDictMatches === true
      const selectedFinished =
        state.values.selectedFinished === true

      if (
        decision === 'restore' ||
        decision === 'new' ||
        decision === 'waiting'
      ) {
        events.push({
          kind: 'session-arbitration',
          activeDict: 'tlc:active-dict',
          recoverableCount,
          expectedSessionId:
            expectedSession > 0
              ? `tlc:session:${expectedSession}`
              : null,
          decision:
            decision === 'restore'
              ? 'restore'
              : decision === 'new'
                ? 'new-acquisition'
                : 'waiting',
          selectedSessionId:
            selectedSession > 0
              ? `tlc:session:${selectedSession}`
              : null,
          selectedDict:
            selectedSession > 0
              ? selectedDictMatches
                ? 'tlc:active-dict'
                : 'tlc:other-dict'
              : null,
          selectedFinished:
            selectedSession > 0
              ? selectedFinished
              : null,
          selectedCount,
        })
      }
    }

    if (
      phase === 'selected' &&
      previousPhase !== 'selected'
    ) {
      const candidateKind = stringValue(
        state,
        'candidateKind',
      )
      const lifecycle = stringValue(state, 'lifecycle')
      const selectedCount =
        numberValue(state, 'selectedCount') ?? 0
      const due = state.values.due === true

      if (
        candidateKind !== null &&
        lifecycle !== null &&
        (
          candidateKind === 'fresh' ||
          candidateKind === 'pending' ||
          candidateKind === 'due' ||
          candidateKind === 'force'
        ) &&
        (
          lifecycle === 'unseen' ||
          lifecycle === 'introduced' ||
          lifecycle === 'pending' ||
          lifecycle === 'admitted' ||
          lifecycle === 'excluded'
        )
      ) {
        events.push({
          kind: 'candidate-selection',
          candidateKind,
          word: 'tlc:candidate-word',
          lifecycle,
          due,
          selectedCount,
        })
      }
    }

    if (
      phase === 'resolved' &&
      previousPhase !== 'resolved' &&
      state.values.success === true
    ) {
      const beforeIndex =
        numberValue(state, 'beforeIndex') ?? 0
      const beforeItemVersion =
        numberValue(state, 'beforeItemVersion') ?? 0
      const afterItemVersion =
        numberValue(state, 'afterItemVersion') ??
        beforeItemVersion
      const actualIndex = numberValue(state, 'actualIndex')
      const expectedIndex =
        numberValue(state, 'expectedIndex')

      if (actualIndex !== null && expectedIndex !== null) {
        const actualQueueVersion =
          numberValue(state, 'actualQueueVersion') ?? 0
        const expectedQueueVersion =
          numberValue(state, 'expectedQueueVersion') ?? 0
        const actualFinished =
          state.values.actualFinished === true
        const expectedFinished =
          state.values.expectedFinished === true

        events.push({
          kind: 'attempt-completed',
          sessionKind: 'review',
          word: 'tlc:projection-word',
          success: true,
          beforeIndex,
          afterIndex: actualIndex,
          expectedAfterIndex: expectedIndex,
          beforeQueueSignature: 'queue:0',
          afterQueueSignature:
            `queue:${actualQueueVersion}`,
          expectedAfterQueueSignature:
            `queue:${expectedQueueVersion}`,
          beforeItemStateSignature:
            `version:${beforeItemVersion}`,
          afterItemStateSignature:
            `version:${afterItemVersion}`,
          afterFinished: actualFinished,
          expectedAfterFinished: expectedFinished,
        })
      } else {
        const afterIndex =
          numberValue(state, 'afterIndex') ?? beforeIndex
        const finished = state.values.finished === true

        events.push({
          kind: 'attempt-completed',
          sessionKind: 'review',
          word: 'tlc:progress-word',
          success: true,
          beforeIndex,
          afterIndex,
          expectedAfterIndex: afterIndex,
          beforeQueueSignature: 'formal-progress-queue',
          afterQueueSignature: 'formal-progress-queue',
          expectedAfterQueueSignature:
            'formal-progress-queue',
          beforeItemStateSignature:
            `version:${beforeItemVersion}`,
          afterItemStateSignature:
            `version:${afterItemVersion}`,
          afterFinished: finished,
          expectedAfterFinished: finished,
        })
      }
    }

  }

  return {
    version: LEARN_TRACE_IR_VERSION,
    source: 'tlc-counterexample',
    scenario,
    events,
  }
}
