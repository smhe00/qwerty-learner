import type { IWordRecord, WordAttemptRecord, WordRecordTelemetry } from '@/utils/db/record'

function toIntervals(keyTimesMs: number[]): number[] {
  const intervals: number[] = []
  for (let i = 1; i < keyTimesMs.length; i++) {
    intervals.push(Math.max(0, keyTimesMs[i] - keyTimesMs[i - 1]))
  }
  return intervals
}

/**
 * Collects raw per-attempt typing telemetry without putting high-frequency
 * keystroke timestamps into React state.
 */
export class WordTelemetryCollector {
  private wordReadyAtMs: number | null = null
  private attemptReadyAtMs: number | null = null
  private keyTimesMs: number[] = []
  private attempts: WordAttemptRecord[] = []
  private firstKeyLatencyMs: number | undefined
  private attemptClosed = false

  resetWord() {
    this.wordReadyAtMs = null
    this.attemptReadyAtMs = null
    this.keyTimesMs = []
    this.attempts = []
    this.firstKeyLatencyMs = undefined
    this.attemptClosed = false
  }

  markReady(nowMs: number) {
    if (this.wordReadyAtMs === null) {
      this.wordReadyAtMs = nowMs
    }
    if (this.attemptReadyAtMs === null) {
      this.attemptReadyAtMs = nowMs
    }
  }

  recordKey(nowMs: number) {
    if (this.attemptClosed) return
    if (this.attemptReadyAtMs === null) {
      this.markReady(nowMs)
    }

    if (this.keyTimesMs.length === 0 && this.firstKeyLatencyMs === undefined && this.wordReadyAtMs !== null) {
      this.firstKeyLatencyMs = Math.max(0, nowMs - this.wordReadyAtMs)
    }

    this.keyTimesMs.push(nowMs)
  }

  recordWrong(correctPrefixLength: number, wrongIndex: number, wrongKey: string, endedAtMs: number) {
    this.closeAttempt('wrong', correctPrefixLength, endedAtMs, wrongIndex, wrongKey)
  }

  recordClean(correctPrefixLength: number, endedAtMs: number) {
    this.closeAttempt('clean', correctPrefixLength, endedAtMs)
  }

  startNextAttempt(nowMs: number) {
    this.attemptReadyAtMs = nowMs
    this.keyTimesMs = []
    this.attemptClosed = false
  }

  snapshot(): WordRecordTelemetry | undefined {
    if (this.firstKeyLatencyMs === undefined || this.attempts.length === 0) {
      return undefined
    }

    return {
      telemetryVersion: 1,
      firstKeyLatencyMs: this.firstKeyLatencyMs,
      attempts: this.attempts.map((attempt) => ({
        ...attempt,
        interKeyIntervalsMs: attempt.interKeyIntervalsMs ? [...attempt.interKeyIntervalsMs] : undefined,
      })),
    }
  }

  private closeAttempt(
    result: 'clean' | 'wrong',
    correctPrefixLength: number,
    endedAtMs: number,
    wrongIndex?: number,
    wrongKey?: string,
  ) {
    if (this.attemptClosed || this.keyTimesMs.length === 0 || this.attemptReadyAtMs === null) {
      return
    }

    const firstKeyAtMs = this.keyTimesMs[0]
    const attempt: WordAttemptRecord = {
      startLatencyMs: Math.max(0, firstKeyAtMs - this.attemptReadyAtMs),
      durationMs: Math.max(0, endedAtMs - firstKeyAtMs),
      correctPrefixLength,
      result,
      interKeyIntervalsMs: toIntervals(this.keyTimesMs),
    }

    if (result === 'wrong') {
      attempt.wrongIndex = wrongIndex
      attempt.wrongKey = wrongKey
    }

    this.attempts.push(attempt)
    this.attemptClosed = true
  }
}

/**
 * Reads v1 telemetry only when all required v1 fields are present.
 * Legacy WordRecord rows simply return undefined.
 */
export function readWordTelemetry(record: IWordRecord): WordRecordTelemetry | undefined {
  if (record.telemetryVersion !== 1 || record.firstKeyLatencyMs === undefined || !record.attempts) {
    return undefined
  }

  return {
    telemetryVersion: 1,
    firstKeyLatencyMs: record.firstKeyLatencyMs,
    attempts: record.attempts,
  }
}
