import assert from 'node:assert/strict'
import test from 'node:test'
import {
  prepareLearnSession,
  type LearnPreparationDependencies,
} from '../../src/learn/controller'
import {
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
  LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
} from '../../src/learn/acquisition'
import { decideDailyAcquisitionQuota } from '../../src/learn/quota'
import { createInitialReviewWordState } from '../../src/review/types'
import type { IReviewWordState } from '../../src/review/types'
import type { Word } from '../../src/typings'
import type {
  IWordRecord,
  ReviewRecord,
} from '../../src/utils/db/record'
import {
  detectLearnSystemAnomalies,
  preparationResultToTraceEvent,
  type LearnSystemTraceEvent,
} from './system-oracle'

function word(name: string): Word {
  return {
    name,
    trans: [],
    usphone: '',
    ukphone: '',
  }
}

function admittedRecord(
  wordName: string,
  timeStamp: number,
): IWordRecord {
  return {
    word: wordName,
    timeStamp,
    dict: 'simulation',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'acquisition',
    reviewPolicyDecision: {
      version: 1,
      policyVersion:
        LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
      reasonCodes: ['spacing-eligible'],
      conditionVersion: 1,
    },
    reviewEvidence: {
      version: 1,
      memoryGrade: 'good',
      errorCause: 'clean',
      confidence: 1,
      retrievalValidity: 'independent',
      evidenceStrength: 1,
      reasonCodes: ['simulation-admission'],
    },
  }
}

function exposureRecord(
  wordName: string,
  timeStamp: number,
): IWordRecord {
  return {
    word: wordName,
    timeStamp,
    dict: 'simulation',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'acquisition',
    reviewPolicyDecision: {
      version: 1,
      policyVersion:
        LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
      reasonCodes: [
        'learn-acquisition-exposure',
        'visible-copy',
        'scheduler-neutral',
      ],
      conditionVersion: 1,
    },
  }
}

function createEntryHarness(input: {
  mutateQuotaAccounting: boolean
}) {
  const now = Math.floor(
    new Date(2026, 9, 4, 10, 0, 0).getTime() / 1000,
  )
  const words = Array.from(
    { length: 30 },
    (_, index) => word(`w${index}`),
  )
  const records: IWordRecord[] = Array.from(
    { length: 19 },
    (_, index) =>
      admittedRecord(`w${index}`, now - 100 + index),
  )
  const states: IReviewWordState[] = Array.from(
    { length: 19 },
    (_, index) => {
      const state = createInitialReviewWordState(
        'simulation',
        `w${index}`,
        now - 100,
      )
      state.nextReviewAt = now + 86_400
      return state
    },
  )
  let nextSessionId = 1

  const dependencies: LearnPreparationDependencies<never> = {
    now: () => now,
    bootstrap: async () => undefined,
    getLatestSession: async () => undefined,
    generateDueReview: async () => undefined,
    getWordRecords: async () => [...records],
    getWordStates: async () => [...states],
    generateAcquisition: async (_dictId, allWords, freshLimit) => {
      const known = new Set(
        records
          .filter(
            (record) =>
              record.learnItemKind === 'acquisition',
          )
          .map((record) => record.word),
      )
      for (const state of states) known.add(state.word)

      const selected = allWords
        .filter((item) => !known.has(item.name))
        .slice(0, freshLimit)
      if (selected.length === 0) return undefined

      for (const item of selected) {
        records.push(exposureRecord(item.name, now))
      }

      const session = {
        id: nextSessionId,
        dict: 'simulation',
        index: 0,
        createTime: now,
        isFinished: false,
        words: selected,
        sessionKind: 'acquisition' as const,
      } as ReviewRecord
      nextSessionId += 1
      return session
    },
    getNextSpacingResumeAt: async () => undefined,
    ...(input.mutateQuotaAccounting
      ? {
          decideQuota: (stats) => {
            const baseline = decideDailyAcquisitionQuota(stats)
            const remaining = Math.max(
              0,
              baseline.targetDailyNewWords -
                stats.today.acquiredWords,
            )
            const bounded =
              stats.lifecycle.unseen === null
                ? remaining
                : Math.min(
                    remaining,
                    Math.max(0, stats.lifecycle.unseen),
                  )

            return {
              ...baseline,
              remainingDailyNewWords: bounded,
              allowedNow:
                stats.lifecycle.due > 0 ? 0 : bounded,
              reasonCodes: [
                ...baseline.reasonCodes,
                'mutation-admitted-based-quota',
              ],
            }
          },
        }
      : {}),
  }

  return { words, dependencies }
}

async function runRepeatedEntryScenario(
  mutateQuotaAccounting: boolean,
): Promise<LearnSystemTraceEvent[]> {
  const harness = createEntryHarness({
    mutateQuotaAccounting,
  })
  const events: LearnSystemTraceEvent[] = []

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await prepareLearnSession({
      dictId: 'simulation',
      words: harness.words,
      errorEvidence: [],
      dependencies: harness.dependencies,
    })
    events.push(preparationResultToTraceEvent(result))

    if (result.kind === 'waiting') break
  }

  return events
}

test('shared preparation controller does not form repeated singleton acquisition under production quota accounting', async () => {
  const events = await runRepeatedEntryScenario(false)
  const anomalies = detectLearnSystemAnomalies(events)

  assert.equal(
    anomalies.some(
      (item) =>
        item.code === 'repeated-singleton-acquisition',
    ),
    false,
  )

  const sessions = events.filter(
    (event) => event.kind === 'session-prepared',
  )
  assert.equal(sessions.length, 1)
})

test('generic oracle blindly detects admitted-based quota mutation through repeated singleton behavior', async () => {
  const events = await runRepeatedEntryScenario(true)
  const anomalies = detectLearnSystemAnomalies(events)

  const singleton = anomalies.find(
    (item) =>
      item.code === 'repeated-singleton-acquisition',
  )
  assert.ok(singleton)
  assert.equal(singleton.severity, 'high')
  assert.ok(singleton.eventIndex >= 2)

  const sessions = events.filter(
    (event) => event.kind === 'session-prepared',
  )
  assert.ok(sessions.length >= 3)
  assert.ok(
    sessions.slice(0, 3).every(
      (event) =>
        event.kind === 'session-prepared' &&
        event.sessionKind === 'acquisition' &&
        event.batchSize === 1,
    ),
  )
})

test('oracle detects progress and persistence anomalies without mutation-specific rules', () => {
  const events: LearnSystemTraceEvent[] = [
    {
      kind: 'attempt-completed',
      sessionKind: 'review',
      word: 'stuck',
      success: true,
      beforeIndex: 1,
      afterIndex: 1,
      expectedAfterIndex: 1,
      beforeQueueSignature: 'a|stuck|c',
      afterQueueSignature: 'a|stuck|c',
      expectedAfterQueueSignature: 'a|stuck|c',
      beforeItemStateSignature: 'cold',
      afterItemStateSignature: 'cold',
      afterFinished: false,
      expectedAfterFinished: false,
    },
    {
      kind: 'checkpoint',
      action: 'save',
      sessionId: 's1',
      index: 4,
      isFinished: false,
      queueSignature: 'a|b|c|d|e',
      wordCount: 5,
    },
    {
      kind: 'checkpoint',
      action: 'restore',
      sessionId: 's1',
      index: 2,
      isFinished: false,
      queueSignature: 'a|b|c|d|e',
      wordCount: 5,
    },
  ]

  const anomalies = detectLearnSystemAnomalies(events)
  assert.ok(
    anomalies.some(
      (item) => item.code === 'success-without-progress',
    ),
  )
  assert.ok(
    anomalies.some(
      (item) => item.code === 'checkpoint-regression',
    ),
  )
})
