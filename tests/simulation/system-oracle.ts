import type { LearnPreparationResult } from '../../src/learn/controller'

export type LearnSystemTraceEvent =
  | {
      kind: 'session-prepared'
      source: 'restored' | 'review' | 'acquisition'
      sessionKind: 'review' | 'acquisition'
      sessionId: string
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
      expectedAfterIndex: number
      beforeQueueSignature: string
      afterQueueSignature: string
      expectedAfterQueueSignature: string
      beforeItemStateSignature: string
      afterItemStateSignature: string
      afterFinished: boolean
      expectedAfterFinished: boolean
    }
  | {
      kind: 'checkpoint'
      action: 'save' | 'restore'
      sessionId: string
      index: number
      isFinished: boolean
      queueSignature: string
      wordCount: number
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
    | 'controller-driver-divergence'
    | 'checkpoint-regression'
    | 'due-work-bypassed'
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
    sessionId:
      result.record.id !== undefined
        ? `id:${result.record.id}`
        : `created:${result.record.dict}:${result.record.createTime}`,
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
  const lastSavedCheckpoint = new Map<
    string,
    {
      index: number
      isFinished: boolean
      queueSignature: string
      wordCount: number
    }
  >()
  const savedCheckpointHistory = new Map<string, string[]>()
  const checkpointKey = (checkpoint: {
    index: number
    isFinished: boolean
    queueSignature: string
    wordCount: number
  }) =>
    [
      checkpoint.index,
      checkpoint.isFinished ? 1 : 0,
      checkpoint.wordCount,
      checkpoint.queueSignature,
    ].join('::')
  let singletonRun = 0
  let lastSingletonSessionId: string | null = null

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

      const suspiciousSingleton =
        event.sessionKind === 'acquisition' &&
        event.batchSize === 1 &&
        event.uniqueWords === 1 &&
        event.allowedNewWordsNow === 1 &&
        (event.unseenCount === null || event.unseenCount > 1)

      if (suspiciousSingleton) {
        if (event.sessionId !== lastSingletonSessionId) {
          singletonRun += 1
          lastSingletonSessionId = event.sessionId
        }
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
        lastSingletonSessionId = null
      }
      continue
    }

    if (event.kind === 'attempt-completed') {
      singletonRun = 0
      lastSingletonSessionId = null

      const projectionMismatch =
        event.afterIndex !== event.expectedAfterIndex ||
        event.afterQueueSignature !==
          event.expectedAfterQueueSignature ||
        event.afterFinished !== event.expectedAfterFinished

      if (projectionMismatch) {
        anomalies.push({
          code: 'controller-driver-divergence',
          severity: 'high',
          eventIndex: index,
          details: {
            word: event.word,
            actualIndex: event.afterIndex,
            expectedIndex: event.expectedAfterIndex,
            actualFinished: event.afterFinished,
            expectedFinished: event.expectedAfterFinished,
          },
        })
      }

      const noSemanticProgress =
        event.beforeIndex === event.afterIndex &&
        event.beforeQueueSignature ===
          event.afterQueueSignature &&
        event.beforeItemStateSignature ===
          event.afterItemStateSignature

      if (
        event.success &&
        !event.afterFinished &&
        noSemanticProgress
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
      lastSingletonSessionId = null
      if (event.action === 'save') {
        const checkpoint = {
          index: event.index,
          isFinished: event.isFinished,
          queueSignature: event.queueSignature,
          wordCount: event.wordCount,
        }
        lastSavedCheckpoint.set(event.sessionId, checkpoint)
        const history =
          savedCheckpointHistory.get(event.sessionId) ?? []
        history.push(checkpointKey(checkpoint))
        savedCheckpointHistory.set(event.sessionId, history)
      } else {
        const saved = lastSavedCheckpoint.get(event.sessionId)
        if (saved) {
          const terminalResurrection =
            saved.isFinished && !event.isFinished
          const sameQueueRollback =
            saved.queueSignature === event.queueSignature &&
            event.index < saved.index
          const queueGrowthOnRestore =
            event.wordCount > saved.wordCount
          const restoredKey = checkpointKey({
            index: event.index,
            isFinished: event.isFinished,
            queueSignature: event.queueSignature,
            wordCount: event.wordCount,
          })
          const latestKey = checkpointKey(saved)
          const history =
            savedCheckpointHistory.get(event.sessionId) ?? []
          const staleExactMatch =
            restoredKey !== latestKey &&
            history.slice(0, -1).includes(restoredKey)

          if (
            terminalResurrection ||
            sameQueueRollback ||
            queueGrowthOnRestore ||
            staleExactMatch
          ) {
            anomalies.push({
              code: 'checkpoint-regression',
              severity: 'high',
              eventIndex: index,
              details: {
                sessionId: event.sessionId,
                savedIndex: saved.index,
                restoredIndex: event.index,
                savedFinished: saved.isFinished,
                restoredFinished: event.isFinished,
                savedWordCount: saved.wordCount,
                restoredWordCount: event.wordCount,
                sameQueue:
                  saved.queueSignature === event.queueSignature,
                staleExactMatch,
              },
            })
          }
        }
      }
      continue
    }

    // Waiting breaks a run of consecutive prepared sessions.
    singletonRun = 0
    lastSingletonSessionId = null
  }

  return anomalies
}
