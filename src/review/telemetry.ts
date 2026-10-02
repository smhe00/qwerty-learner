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
 *
 * Time is measured in active foreground milliseconds. Window blur / hidden-tab
 * time is removed so a user switching away is not misclassified as forgetting.
 */
export class WordTelemetryCollector {
  private wordReadyAtMs: number | null = null
  private attemptReadyAtMs: number | null = null
  private keyTimesMs: number[] = []
  private attempts: WordAttemptRecord[] = []
  private firstKeyLatencyMs: number | undefined
  private attemptClosed = false

  private pauseStartedAtMs: number | null = null
  private totalPausedMs = 0
  private backgroundPauseMs = 0
  private backgroundPauseCount = 0
  private backgroundPauseBeforeFirstKeyMs = 0
  private backgroundPauseBeforeFirstKeyCount = 0

  resetWord() {
    this.wordReadyAtMs = null
    this.attemptReadyAtMs = null
    this.keyTimesMs = []
    this.attempts = []
    this.firstKeyLatencyMs = undefined
    this.attemptClosed = false
    this.pauseStartedAtMs = null
    this.totalPausedMs = 0
    this.backgroundPauseMs = 0
    this.backgroundPauseCount = 0
    this.backgroundPauseBeforeFirstKeyMs = 0
    this.backgroundPauseBeforeFirstKeyCount = 0
  }

  pause(nowMs: number) {
    if (this.pauseStartedAtMs !== null) return
    this.pauseStartedAtMs = nowMs
    this.backgroundPauseCount += 1
  }

  resume(nowMs: number) {
    if (this.pauseStartedAtMs === null) return

    const pauseDuration = Math.max(0, nowMs - this.pauseStartedAtMs)
    this.totalPausedMs += pauseDuration
    this.backgroundPauseMs += pauseDuration
    if (this.firstKeyLatencyMs === undefined) {
      this.backgroundPauseBeforeFirstKeyMs += pauseDuration
      this.backgroundPauseBeforeFirstKeyCount += 1
    }
    this.pauseStartedAtMs = null
  }

  markReady(nowMs: number) {
    const activeNow = this.toActiveTime(nowMs)
    if (this.wordReadyAtMs === null) {
      this.wordReadyAtMs = activeNow
    }
    if (this.attemptReadyAtMs === null) {
      this.attemptReadyAtMs = activeNow
    }
  }

  recordKey(nowMs: number) {
    if (this.attemptClosed) return

    const activeNow = this.toActiveTime(nowMs)
    if (this.attemptReadyAtMs === null) {
      this.markReady(nowMs)
    }

    if (this.keyTimesMs.length === 0 && this.firstKeyLatencyMs === undefined && this.wordReadyAtMs !== null) {
      this.firstKeyLatencyMs = Math.max(0, activeNow - this.wordReadyAtMs)
    }

    this.keyTimesMs.push(activeNow)
  }

  recordWrong(
    correctPrefixLength: number,
    wrongIndex: number,
    wrongKey: string | undefined,
    endedAtMs: number,
  ): boolean {
    return this.closeAttempt(
      'wrong',
      correctPrefixLength,
      this.toActiveTime(endedAtMs),
      wrongIndex,
      wrongKey,
    )
  }

  recordClean(correctPrefixLength: number, endedAtMs: number): boolean {
    return this.closeAttempt(
      'clean',
      correctPrefixLength,
      this.toActiveTime(endedAtMs),
    )
  }

  startNextAttempt(nowMs: number) {
    this.attemptReadyAtMs = this.toActiveTime(nowMs)
    this.keyTimesMs = []
    this.attemptClosed = false
  }

  snapshot(): WordRecordTelemetry | undefined {
    if (this.firstKeyLatencyMs === undefined || this.attempts.length === 0) {
      return undefined
    }

    return {
      telemetryVersion: 2,
      firstKeyLatencyMs: this.firstKeyLatencyMs,
      attempts: this.attempts.map((attempt) => ({
        ...attempt,
        interKeyIntervalsMs: attempt.interKeyIntervalsMs ? [...attempt.interKeyIntervalsMs] : undefined,
      })),
      backgroundPauseMs: this.backgroundPauseMs || undefined,
      backgroundPauseCount: this.backgroundPauseCount || undefined,
      backgroundPauseBeforeFirstKeyMs: this.backgroundPauseBeforeFirstKeyMs || undefined,
      backgroundPauseBeforeFirstKeyCount: this.backgroundPauseBeforeFirstKeyCount || undefined,
    }
  }

  private toActiveTime(nowMs: number): number {
    const currentPauseMs =
      this.pauseStartedAtMs === null ? 0 : Math.max(0, nowMs - this.pauseStartedAtMs)
    return nowMs - this.totalPausedMs - currentPauseMs
  }

  private closeAttempt(
    result: 'clean' | 'wrong',
    correctPrefixLength: number,
    activeEndedAtMs: number,
    wrongIndex?: number,
    wrongKey?: string,
  ): boolean {
    if (
      this.attemptClosed ||
      this.keyTimesMs.length === 0 ||
      this.attemptReadyAtMs === null
    ) {
      return false
    }

    const firstKeyAtMs = this.keyTimesMs[0]
    const attempt: WordAttemptRecord = {
      startLatencyMs: Math.max(0, firstKeyAtMs - this.attemptReadyAtMs),
      durationMs: Math.max(0, activeEndedAtMs - firstKeyAtMs),
      correctPrefixLength,
      result,
      interKeyIntervalsMs: toIntervals(this.keyTimesMs),
    }

    if (result === 'wrong') {
      attempt.wrongIndex = wrongIndex
      if (wrongKey !== undefined) {
        attempt.wrongKey = wrongKey
      }
    }

    this.attempts.push(attempt)
    this.attemptClosed = true
    return true
  }
}

/**
 * Reads the canonical telemetry format. Original qwerty-learner rows and
 * experimental pre-v2 telemetry are intentionally ignored.
 */
export function readWordTelemetry(record: IWordRecord): WordRecordTelemetry | undefined {
  const telemetry = record.typingTelemetry
  if (telemetry?.telemetryVersion !== 2) return undefined
  return telemetry
}
