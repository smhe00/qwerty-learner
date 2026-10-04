export const LEARN_TRACE_IR_VERSION = 1 as const

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
