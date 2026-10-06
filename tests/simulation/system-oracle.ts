import type { LearnPreparationResult } from '../../src/learn/controller'
import type {
  LearnSystemAnomaly,
  LearnSystemTraceEvent,
} from '../../src/learn/trace-ir'

export type {
  LearnSystemAnomaly,
  LearnSystemTraceEvent,
} from '../../src/learn/trace-ir'

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
  const readyDeferredMisses = new Map<string, number>()
  const persistenceOrder = new Map<
    string,
    {
      highestRequested: number
      lastCommitted: number
    }
  >()
  const pendingTerminalHandoffs = new Map<
    string,
    {
      eventIndex: number
      word: string
      index: number
      queueLength: number
    }
  >()

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

      if (event.source === 'restored') {
        continue
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

    if (event.kind === 'terminal-word-durable') {
      if (event.index === event.queueLength - 1) {
        pendingTerminalHandoffs.set(event.sessionId, {
          eventIndex: index,
          word: event.word,
          index: event.index,
          queueLength: event.queueLength,
        })
      }
      continue
    }

    if (event.kind === 'terminal-ui-finished') {
      pendingTerminalHandoffs.delete(event.sessionId)
      continue
    }

    if (event.kind === 'audio-play') {
      if (
        event.displayedEpoch !== event.audioEpoch ||
        event.displayedWord !== event.audioWord
      ) {
        anomalies.push({
          code: 'audio-owner-mismatch',
          severity: 'high',
          eventIndex: index,
          details: {
            displayedWord: event.displayedWord,
            displayedEpoch: event.displayedEpoch,
            audioWord: event.audioWord,
            audioEpoch: event.audioEpoch,
          },
        })
      }
      continue
    }

    if (event.kind === 'success-advance') {
      const lifecycleIncomplete =
        event.audioRequired &&
        !event.fastForward &&
        !event.timeoutExpired &&
        (!event.audioStarted || !event.audioSettled)

      if (lifecycleIncomplete) {
        anomalies.push({
          code: 'success-audio-lifecycle-violation',
          severity: 'high',
          eventIndex: index,
          details: {
            word: event.word,
            audioRequired: event.audioRequired,
            audioStarted: event.audioStarted,
            audioSettled: event.audioSettled,
            timeoutExpired: event.timeoutExpired,
            fastForward: event.fastForward,
          },
        })
      }
      continue
    }

    if (event.kind === 'acquisition-health') {
      const pendingNames = new Set(
        event.pending.map((item) => item.word),
      )
      for (const word of readyDeferredMisses.keys()) {
        if (!pendingNames.has(word)) {
          readyDeferredMisses.delete(word)
        }
      }

      for (const item of event.pending) {
        if (item.phase !== 'deferred') {
          readyDeferredMisses.delete(item.word)
          continue
        }

        if (item.resumeAfter === null) {
          anomalies.push({
            code: 'stranded-pending-acquisition',
            severity: 'high',
            eventIndex: index,
            details: {
              word: item.word,
              phase: item.phase,
              deferredReason: item.deferredReason,
              reason: 'missing-resume-time',
            },
          })
          continue
        }

        const ready = item.resumeAfter <= event.now
        if (!ready) {
          readyDeferredMisses.delete(item.word)
          continue
        }

        if (!event.opportunity) continue

        const misses =
          (readyDeferredMisses.get(item.word) ?? 0) + 1
        readyDeferredMisses.set(item.word, misses)

        if (misses === 2) {
          anomalies.push({
            code: 'stranded-pending-acquisition',
            severity: 'high',
            eventIndex: index,
            details: {
              word: item.word,
              phase: item.phase,
              deferredReason: item.deferredReason,
              resumeAfter: item.resumeAfter,
              now: event.now,
              missedOpportunities: misses,
            },
          })
        }
      }
      continue
    }

    if (event.kind === 'persistence-write') {
      const state =
        persistenceOrder.get(event.sessionId) ?? {
          highestRequested: 0,
          lastCommitted: 0,
        }

      if (event.action === 'requested') {
        state.highestRequested = Math.max(
          state.highestRequested,
          event.sequence,
        )
        persistenceOrder.set(event.sessionId, state)
        continue
      }

      const commitBeforeRequest =
        event.sequence > state.highestRequested
      const completionRegression =
        event.sequence < state.lastCommitted

      if (commitBeforeRequest || completionRegression) {
        anomalies.push({
          code: 'persistence-order-violation',
          severity: 'high',
          eventIndex: index,
          details: {
            sessionId: event.sessionId,
            sequence: event.sequence,
            highestRequested: state.highestRequested,
            lastCommitted: state.lastCommitted,
            semanticSignature: event.semanticSignature,
            commitBeforeRequest,
            completionRegression,
          },
        })
      }

      state.lastCommitted = Math.max(
        state.lastCommitted,
        event.sequence,
      )
      persistenceOrder.set(event.sessionId, state)
      continue
    }

    if (event.kind === 'fresh-budget') {
      const remaining = Math.max(
        0,
        event.targetDailyNewWords -
          event.introducedToday,
      )
      const boundedRemaining =
        event.unseenCount === null
          ? remaining
          : Math.min(
              remaining,
              Math.max(0, event.unseenCount),
            )
      const expectedAllowed =
        event.dueCount > 0 ? 0 : boundedRemaining
      const expectedPendingSelected =
        event.dueCount > 0
          ? 0
          : event.readyPendingCount
      const allowedMismatch =
        event.allowedNow !== expectedAllowed
      const freshOverBudget =
        event.freshSelected > event.allowedNow ||
        (
          event.unseenCount !== null &&
          event.freshSelected > event.unseenCount
        )
      const pendingBudgetLeak =
        event.pendingSelected !==
        expectedPendingSelected

      if (
        allowedMismatch ||
        freshOverBudget ||
        pendingBudgetLeak
      ) {
        anomalies.push({
          code: 'fresh-budget-violation',
          severity: 'high',
          eventIndex: index,
          details: {
            targetDailyNewWords:
              event.targetDailyNewWords,
            introducedToday: event.introducedToday,
            acquiredToday: event.acquiredToday,
            unseenCount: event.unseenCount,
            dueCount: event.dueCount,
            allowedNow: event.allowedNow,
            expectedAllowed,
            freshSelected: event.freshSelected,
            readyPendingCount:
              event.readyPendingCount,
            pendingSelected: event.pendingSelected,
            expectedPendingSelected,
          },
        })
      }
      continue
    }

    if (event.kind === 'session-arbitration') {
      const mustRestore = event.recoverableCount > 0
      const validRestore =
        event.decision === 'restore' &&
        event.selectedCount === 1 &&
        event.selectedSessionId ===
          event.expectedSessionId &&
        event.selectedDict === event.activeDict &&
        event.selectedFinished === false
      const invalidUnexpectedRestore =
        !mustRestore && event.decision === 'restore'

      if (
        (mustRestore && !validRestore) ||
        invalidUnexpectedRestore
      ) {
        anomalies.push({
          code: 'session-arbitration-violation',
          severity: 'high',
          eventIndex: index,
          details: {
            activeDict: event.activeDict,
            recoverableCount: event.recoverableCount,
            expectedSessionId: event.expectedSessionId,
            decision: event.decision,
            selectedSessionId: event.selectedSessionId,
            selectedDict: event.selectedDict,
            selectedFinished: event.selectedFinished,
            selectedCount: event.selectedCount,
          },
        })
      }
      continue
    }

    if (event.kind === 'candidate-selection') {
      const lifecycleValid =
        event.candidateKind === 'fresh'
          ? event.lifecycle === 'unseen'
          : event.candidateKind === 'pending'
            ? event.lifecycle === 'pending'
            : event.candidateKind === 'due'
              ? event.lifecycle === 'admitted' && event.due
              : event.lifecycle === 'admitted'
      const uniqueSelection = event.selectedCount === 1

      if (!lifecycleValid || !uniqueSelection) {
        anomalies.push({
          code: 'candidate-lifecycle-violation',
          severity: 'high',
          eventIndex: index,
          details: {
            word: event.word,
            candidateKind: event.candidateKind,
            lifecycle: event.lifecycle,
            due: event.due,
            selectedCount: event.selectedCount,
            lifecycleValid,
            uniqueSelection,
          },
        })
      }
      continue
    }

    if (event.kind === 'checkpoint') {
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

  for (const [
    sessionId,
    pending,
  ] of pendingTerminalHandoffs) {
    anomalies.push({
      code: 'terminal-handoff-stall',
      severity: 'high',
      eventIndex: pending.eventIndex,
      details: {
        sessionId,
        word: pending.word,
        index: pending.index,
        queueLength: pending.queueLength,
      },
    })
  }

  return anomalies
}
