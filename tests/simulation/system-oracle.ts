import type { LearnPreparationResult } from '../../src/learn/controller'

export type LearnSystemTraceEvent =
  | {
      kind: 'session-prepared'
      source: 'restored' | 'review' | 'acquisition'
      sessionKind: 'review' | 'acquisition'
      batchSize: number
      uniqueWords: number
      dueCount: number | null
      unseenCount: number | null
      allowedNewWordsNow: number | null
      introducedToday: number | null
      acquiredToday: number | null
    }
  | {
      kind: 'attempt-completed'
      sessionKind: 'review' | 'acquisition'
      word: string
      success: boolean
      beforeIndex: number
      afterIndex: number
      beforeQueueSignature: string
      afterQueueSignature: string
    }
  | {
      kind: 'checkpoint'
      action: 'save' | 'restore'
      sessionId: string
      semanticSignature: string
    }
  | {
      kind: 'waiting'
      reason:
        | 'spacing'
        | 'empty'
        | 'review-due'
        | 'workload-budget'
        | 'quota'
      dueCount: number | null
      unseenCount: number | null
    }

export type LearnSystemAnomaly = {
  code:
    | 'repeated-singleton-acquisition'
    | 'success-without-progress'
    | 'checkpoint-regression'
    | 'due-work-bypassed'
    | 'fresh-work-after-zero-allowance'
  severity: 'medium' | 'high'
  eventIndex: number
  details: Record<string, number | string | boolean | null>
}

export function preparationResultToTraceEvent(
  result: LearnPreparationResult,
): LearnSystemTraceEvent {
  if (result.kind === 'waiting') {
    return {
      kind: 'waiting',
      reason: result.reason,
      dueCount: result.diagnostics.stats?.lifecycle.due ?? null,
      unseenCount:
        result.diagnostics.stats?.lifecycle.unseen ?? null,
    }
  }

  const words = result.record.words ?? []
  return {
    kind: 'session-prepared',
    source: result.source,
    sessionKind: result.record.sessionKind ?? 'review',
    batchSize: words.length,
    uniqueWords: new Set(words.map((word) => word.name)).size,
    dueCount: result.diagnostics.stats?.lifecycle.due ?? null,
    unseenCount:
      result.diagnostics.stats?.lifecycle.unseen ?? null,
    allowedNewWordsNow:
      result.diagnostics.allowedNewWordsNow ?? null,
    introducedToday:
      result.diagnostics.stats?.today.introducedWords ?? null,
    acquiredToday:
      result.diagnostics.stats?.today.acquiredWords ?? null,
  }
}

/**
 * Generic behavioral oracle.
 *
 * It deliberately knows only observable invariants and suspicious temporal
 * patterns. It does not know which implementation mutation produced them.
 */
export function detectLearnSystemAnomalies(
  events: LearnSystemTraceEvent[],
): LearnSystemAnomaly[] {
  const anomalies: LearnSystemAnomaly[] = []
  const lastSavedCheckpoint = new Map<string, string>()
  let singletonRun = 0

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]

    if (event.kind === 'session-prepared') {
      if (
        event.sessionKind === 'acquisition' &&
        (event.dueCount ?? 0) > 0
      ) {
        anomalies.push({
          code: 'due-work-bypassed',
          severity: 'high',
          eventIndex: index,
          details: {
            dueCount: event.dueCount,
            batchSize: event.batchSize,
          },
        })
      }

      if (
        event.sessionKind === 'acquisition' &&
        event.batchSize > 0 &&
        event.allowedNewWordsNow === 0
      ) {
        anomalies.push({
          code: 'fresh-work-after-zero-allowance',
          severity: 'high',
          eventIndex: index,
          details: {
            batchSize: event.batchSize,
            allowedNewWordsNow: event.allowedNewWordsNow,
          },
        })
      }

      const suspiciousSingleton =
        event.sessionKind === 'acquisition' &&
        event.batchSize === 1 &&
        event.uniqueWords === 1 &&
        (event.unseenCount === null || event.unseenCount > 1)

      if (suspiciousSingleton) {
        singletonRun += 1
        if (singletonRun === 3) {
          anomalies.push({
            code: 'repeated-singleton-acquisition',
            severity: 'high',
            eventIndex: index,
            details: {
              consecutiveSessions: singletonRun,
              unseenCount: event.unseenCount,
              introducedToday: event.introducedToday,
              acquiredToday: event.acquiredToday,
            },
          })
        }
      } else {
        singletonRun = 0
      }
      continue
    }

    if (event.kind === 'attempt-completed') {
      singletonRun = 0
      if (
        event.success &&
        event.beforeIndex === event.afterIndex &&
        event.beforeQueueSignature ===
          event.afterQueueSignature
      ) {
        anomalies.push({
          code: 'success-without-progress',
          severity: 'high',
          eventIndex: index,
          details: {
            word: event.word,
            index: event.beforeIndex,
            sessionKind: event.sessionKind,
          },
        })
      }
      continue
    }

    if (event.kind === 'checkpoint') {
      singletonRun = 0
      if (event.action === 'save') {
        lastSavedCheckpoint.set(
          event.sessionId,
          event.semanticSignature,
        )
      } else {
        const saved = lastSavedCheckpoint.get(event.sessionId)
        if (
          saved !== undefined &&
          saved !== event.semanticSignature
        ) {
          anomalies.push({
            code: 'checkpoint-regression',
            severity: 'high',
            eventIndex: index,
            details: {
              sessionId: event.sessionId,
              saved,
              restored: event.semanticSignature,
            },
          })
        }
      }
      continue
    }

    // Waiting breaks a run of consecutive prepared sessions.
    singletonRun = 0
  }

  return anomalies
}
