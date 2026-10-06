export const LEARN_TRACE_IR_VERSION = 1 as const

export type LearnSystemTraceEvent =
  | {
      kind: 'session-prepared'
      source: 'restored' | 'review' | 'acquisition' | 'mixed'
      sessionKind: 'review' | 'acquisition' | 'mixed'
      sessionId: string
      batchSize: number
      uniqueWords: number
      dueCount: number | null
      unseenCount: number | null
      allowedNewWordsNow: number | null
      introducedToday: number | null
      acquiredToday: number | null
      itemOwnership?: Array<{
        word: string
        itemKind: 'review' | 'acquisition'
        hasAcquisitionState: boolean
      }>
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
      kind: 'acquisition-health'
      now: number
      opportunity: boolean
      pending: Array<{
        word: string
        phase: string
        deferredReason: string | null
        resumeAfter: number | null
      }>
    }
  | {
      kind: 'persistence-write'
      action: 'requested' | 'committed'
      sessionId: string
      sequence: number
      semanticSignature: string
    }
  | {
      kind: 'fresh-budget'
      targetDailyNewWords: number
      introducedToday: number
      acquiredToday: number
      unseenCount: number | null
      dueCount: number
      allowedNow: number
      freshSelected: number
      readyPendingCount: number
      pendingSelected: number
    }
  | {
      kind: 'session-arbitration'
      activeDict: string
      recoverableCount: number
      expectedSessionId: string | null
      decision:
        | 'restore'
        | 'new-review'
        | 'new-acquisition'
        | 'waiting'
      selectedSessionId: string | null
      selectedDict: string | null
      selectedFinished: boolean | null
      selectedCount: number
    }
  | {
      kind: 'candidate-selection'
      candidateKind: 'fresh' | 'pending' | 'due' | 'force'
      word: string
      lifecycle:
        | 'unseen'
        | 'introduced'
        | 'pending'
        | 'admitted'
        | 'excluded'
      due: boolean
      selectedCount: number
    }
  | {
      kind: 'learn-evidence-durable'
      sessionId: string
      word: string
      itemKind: 'review' | 'acquisition'
    }
  | {
      kind: 'lifecycle'
      action:
        | 'route-enter'
        | 'route-leave'
        | 'reload'
        | 'background'
        | 'foreground'
      sessionId: string | null
      isFinished: boolean | null
    }
  | {
      kind: 'occurrence-identity'
      sessionId: string
      word: string
      occurrenceCount: number
      logicalStateEntries: number
    }
  | {
      kind: 'terminal-word-durable'
      sessionId: string
      word: string
      index: number
      queueLength: number
    }
  | {
      kind: 'terminal-ui-finished'
      sessionId: string
    }
  | {
      kind: 'audio-play'
      displayedWord: string
      displayedEpoch: number
      audioWord: string
      audioEpoch: number
    }
  | {
      kind: 'success-advance'
      word: string
      audioRequired: boolean
      audioStarted: boolean
      audioSettled: boolean
      timeoutExpired: boolean
      fastForward: boolean
    }
  | {
      kind: 'waiting'
      reason:
        | 'deferred'
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
    | 'stranded-pending-acquisition'
    | 'candidate-lifecycle-violation'
    | 'session-arbitration-violation'
    | 'fresh-budget-violation'
    | 'persistence-order-violation'
    | 'terminal-handoff-stall'
    | 'audio-owner-mismatch'
    | 'success-audio-lifecycle-violation'
    | 'terminal-session-resurrection'
    | 'post-finish-evidence'
    | 'mixed-item-ownership-violation'
    | 'occurrence-identity-violation'
  severity: 'medium' | 'high'
  eventIndex: number
  details: Record<string, number | string | boolean | null>
}

export type LearnTraceEnvelope = {
  version: typeof LEARN_TRACE_IR_VERSION
  source:
    | 'simulation'
    | 'tlc-counterexample'
    | 'browser'
    | 'historical-replay'
  scenario?: string
  events: LearnSystemTraceEvent[]
}


export type LearnLifecycleSeedAction =
  | { kind: 'enter' }
  | { kind: 'route-leave' }
  | { kind: 'reload' }
  | { kind: 'background' }
  | { kind: 'foreground' }
  | { kind: 'retry-current' }

export type LearnLifecycleSeed = {
  version: 1
  source: 'diagnostic-replay' | 'synthetic'
  anomalyCodes: string[]
  actions: LearnLifecycleSeedAction[]
}
