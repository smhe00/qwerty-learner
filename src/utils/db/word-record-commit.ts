import { db } from './core'
import { buildWordRecord } from './word-record-builder'
import { commitWordRecord } from '@/learn/word-record-commit'
import type { WordRecordCommitResult, WordRecordContext, WordRecordInput } from '@/learn/word-record-commit'
import { appendDeveloperTrace } from '@/dev/diagnostic-trace'
import { scheduleLearnReviewCommit } from '@/review/learn-review-commit'
import { learningEventSyncEnabled } from '@/sync/learning-sync-policy'

/** Browser composition only. UI binding supplies context and notification;
 * ownership/transaction enforcement remains in the existing db writer.
 */
export async function commitBrowserWordRecord(
  input: WordRecordInput,
  context: WordRecordContext,
  notifySaved: (id: number) => void,
): Promise<WordRecordCommitResult> {
  const result = await commitWordRecord(input, context, {
    prepare: buildWordRecord,
    add: (record) => db.wordRecords.add(record),
    effects: [
      { name: 'typing-notification', run: (receipt) => notifySaved(receipt.id) },
      {
        name: 'achievement',
        run: (receipt) => {
          if (input.sourceMode !== 'learn') return
          return import('@/achievement/engine').then(({ processLiveLearnWordRecord }) =>
            processLiveLearnWordRecord(receipt.id, { sessionId: context.sessionId }),
          )
        },
      },
      {
        name: 'event-publication',
        run: () => {
          if (!learningEventSyncEnabled()) return
          // Publication recovery still scans durable raw events after a crash.
          return import('@/sync/m3-publication-browser').then(({ scheduleEtestM3Publication }) => scheduleEtestM3Publication())
        },
      },
      {
        name: 'review-projection',
        run: (receipt) => {
          if (input.sourceMode !== 'learn') return
          return scheduleLearnReviewCommit({
            dict: context.dict, word: input.word, itemKind: input.learnItemKind,
            wordRecordId: receipt.id, decision: input.reviewRatingDecision,
          })
        },
      },
    ],
    reportEffectError: (name, error) => console.error(`post-commit ${name} failed; original WordRecord retained`, error),
  })
  if (result.status === 'rejected') {
    appendDeveloperTrace({
      scope: 'learn-terminal', event: 'finished-session-word-record-blocked', word: input.word,
      sessionId: context.sessionId, index: context.sessionIndex, queueLength: context.sessionQueueLength,
      details: { reason: 'terminal-session-is-immutable' },
    })
  } else if (result.status === 'failed') {
    console.error('failed to commit word record', result.error)
  }
  return result
}
