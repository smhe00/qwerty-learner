import {
  DEVELOPER_TRACE_SCHEMA,
  type DeveloperTraceEvent,
} from './diagnostic-trace'
import {
  LEARN_TRACE_IR_VERSION,
  type LearnSystemTraceEvent,
  type LearnTraceEnvelope,
} from '../../tests/simulation/trace-ir'

export const DEVELOPER_INCIDENT_SCHEMA =
  'qwerty-developer-incident-v1' as const

export type DiagnosticExportKind = 'trace' | 'incident'
export type DiagnosticEvidenceKind = 'observed' | 'derived' | 'mixed'

type UnknownRecord = Record<string, unknown>

export class DiagnosticReplayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiagnosticReplayError'
  }
}

export type NormalizedDiagnosticEvent = {
  originalIndex: number
  sequence: number
  at: number
  scope: string
  event: string
  path?: string
  word?: string
  sessionId?: string
  sessionEvidence: 'observed' | 'derived' | 'none'
  index?: number
  queueLength?: number
  details: UnknownRecord
}

export type DiagnosticIncidentSnapshot = {
  schema: typeof DEVELOPER_INCIDENT_SCHEMA
  capturedAt?: number
  build?: { commit?: string }
  page?: {
    href?: string
    path?: string
    visibilityState?: string
    hasFocus?: boolean
    viewport?: { width?: number; height?: number }
  }
  dom?: {
    typingWord?: Record<string, string>
    acquisition?: Record<string, string>
    resultVisible?: boolean
  }
  localStorage?: UnknownRecord
  sessionStorage?: UnknownRecord
  trace: {
    schema: typeof DEVELOPER_TRACE_SCHEMA
    exportedAt?: number
    events: DeveloperTraceEvent[]
  }
  database?: UnknownRecord
}

export type ParsedDiagnosticExport = {
  kind: DiagnosticExportKind
  schema: string
  buildCommit?: string
  capturedAt?: number
  incident?: DiagnosticIncidentSnapshot
  events: NormalizedDiagnosticEvent[]
}

export type ReplayAnomalyCode =
  | 'terminal-ui-divergence'
  | 'finished-session-evidence-after-terminal'
  | 'finished-checkpoint-regression'
  | 'invalid-session-index'
  | 'audio-owner-lifecycle-violation'
  | 'oversized-acquisition-classification'

export type ReplayAnomaly = {
  code: ReplayAnomalyCode
  signature: string
  evidenceKind: DiagnosticEvidenceKind
  sessionId?: string
  word?: string
  firstBadEventIndex?: number
  eventIndexes: number[]
  summary: string
}

export type DiagnosticReplayReport = {
  schema: string
  kind: DiagnosticExportKind
  buildCommit?: string
  eventCount: number
  sessionsSeen: string[]
  anomalies: ReplayAnomaly[]
  learnTrace: LearnTraceEnvelope
}

export type DiagnosticMinimizationResult = {
  targetSignature: string
  originalEventCount: number
  minimizedEventCount: number
  retainedSequences: number[]
  events: NormalizedDiagnosticEvent[]
}

function normalizedToDeveloperTraceEvent(
  event: NormalizedDiagnosticEvent,
): DeveloperTraceEvent {
  return {
    schemaVersion: 1,
    sequence: event.sequence,
    at: event.at,
    path: event.path ?? '',
    scope: event.scope as DeveloperTraceEvent['scope'],
    event: event.event,
    ...(event.word ? { word: event.word } : {}),
    ...(event.sessionId && event.sessionEvidence === 'observed'
      ? { sessionId: event.sessionId }
      : {}),
    ...(event.index !== undefined
      ? { index: event.index }
      : {}),
    ...(event.queueLength !== undefined
      ? { queueLength: event.queueLength }
      : {}),
    ...(Object.keys(event.details).length > 0
      ? {
          details: event.details as DeveloperTraceEvent['details'],
        }
      : {}),
  }
}

export function createReplayableMinimizedExport(
  parsed: ParsedDiagnosticExport,
  minimized: DiagnosticMinimizationResult,
): unknown {
  const rawEvents = minimized.events.map(
    normalizedToDeveloperTraceEvent,
  )

  if (parsed.kind === 'trace') {
    return {
      schema: DEVELOPER_TRACE_SCHEMA,
      exportedAt: parsed.capturedAt ?? 0,
      events: rawEvents,
    }
  }

  if (!parsed.incident) {
    throw new DiagnosticReplayError(
      'incident export is missing its incident snapshot',
    )
  }

  return {
    ...parsed.incident,
    trace: {
      ...parsed.incident.trace,
      events: rawEvents,
    },
  }
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object'
    ? (value as UnknownRecord)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function parseInput(input: string | unknown): UnknownRecord {
  let value: unknown = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch (error) {
      throw new DiagnosticReplayError(
        `invalid diagnostic JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  const record = asRecord(value)
  if (!record) {
    throw new DiagnosticReplayError(
      'diagnostic export must be a JSON object',
    )
  }
  return record
}

function readIncidentSessionId(
  incident: DiagnosticIncidentSnapshot | undefined,
): string | undefined {
  const local = asRecord(incident?.localStorage)
  const reviewModeInfo = asRecord(local?.reviewModeInfo)
  const reviewRecord = asRecord(reviewModeInfo?.reviewRecord)
  const id = reviewRecord?.id ?? reviewRecord?.createTime
  if (
    typeof id === 'string' ||
    typeof id === 'number'
  ) {
    return String(id)
  }
  return undefined
}

function eventSessionId(
  event: DeveloperTraceEvent,
): string | undefined {
  if (event.sessionId) return String(event.sessionId)
  const details = asRecord(event.details)
  const nested = details?.sessionId
  if (
    typeof nested === 'string' ||
    typeof nested === 'number'
  ) {
    return String(nested)
  }
  return undefined
}

function normalizeEvents(
  rawEvents: DeveloperTraceEvent[],
  incident?: DiagnosticIncidentSnapshot,
): NormalizedDiagnosticEvent[] {
  const incidentSessionId = readIncidentSessionId(incident)
  let activeSessionId = incidentSessionId

  return rawEvents.map((event, originalIndex) => {
    const observedSessionId = eventSessionId(event)
    if (observedSessionId) activeSessionId = observedSessionId
    const sessionId = observedSessionId ?? activeSessionId
    const details = asRecord(event.details) ?? {}

    return {
      originalIndex,
      sequence:
        typeof event.sequence === 'number'
          ? event.sequence
          : originalIndex + 1,
      at: typeof event.at === 'number' ? event.at : 0,
      scope: event.scope,
      event: event.event,
      ...(event.path ? { path: event.path } : {}),
      ...(event.word ? { word: event.word } : {}),
      ...(sessionId ? { sessionId } : {}),
      sessionEvidence: observedSessionId
        ? 'observed'
        : sessionId
          ? 'derived'
          : 'none',
      ...(typeof event.index === 'number'
        ? { index: event.index }
        : {}),
      ...(typeof event.queueLength === 'number'
        ? { queueLength: event.queueLength }
        : {}),
      details,
    }
  })
}

function validateRawEvents(value: unknown): DeveloperTraceEvent[] {
  if (!Array.isArray(value)) {
    throw new DiagnosticReplayError(
      'diagnostic export events must be an array',
    )
  }
  return value as DeveloperTraceEvent[]
}

export function parseDiagnosticExport(
  input: string | unknown,
): ParsedDiagnosticExport {
  const record = parseInput(input)
  const schema = asString(record.schema)

  if (schema === DEVELOPER_TRACE_SCHEMA) {
    const events = validateRawEvents(record.events)
    return {
      kind: 'trace',
      schema,
      capturedAt: asNumber(record.exportedAt),
      events: normalizeEvents(events),
    }
  }

  if (schema === DEVELOPER_INCIDENT_SCHEMA) {
    const trace = asRecord(record.trace)
    if (!trace || trace.schema !== DEVELOPER_TRACE_SCHEMA) {
      throw new DiagnosticReplayError(
        `incident trace schema must be ${DEVELOPER_TRACE_SCHEMA}`,
      )
    }

    const incident = record as unknown as DiagnosticIncidentSnapshot
    const events = validateRawEvents(trace.events)

    return {
      kind: 'incident',
      schema,
      buildCommit: asString(asRecord(record.build)?.commit),
      capturedAt: asNumber(record.capturedAt),
      incident,
      events: normalizeEvents(events, incident),
    }
  }

  throw new DiagnosticReplayError(
    `unsupported diagnostic schema: ${schema ?? 'missing'}`,
  )
}

function checkpointFinished(
  event: NormalizedDiagnosticEvent,
): boolean | undefined {
  if (
    event.event !== 'review-checkpoint-requested' &&
    event.event !== 'review-checkpoint-durable'
  ) {
    return undefined
  }
  return asBoolean(event.details.isFinished)
}

function signature(
  code: ReplayAnomalyCode,
  sessionId?: string,
  word?: string,
): string {
  return [
    code,
    sessionId ?? '-',
    word ?? '-',
  ].join('|')
}

function anomaly(
  input: Omit<ReplayAnomaly, 'signature'>,
): ReplayAnomaly {
  return {
    ...input,
    signature: signature(
      input.code,
      input.sessionId,
      input.word,
    ),
  }
}

function terminalIndexes(
  events: NormalizedDiagnosticEvent[],
): Map<string, number> {
  const result = new Map<string, number>()
  for (const event of events) {
    if (!event.sessionId) continue
    if (
      checkpointFinished(event) === true ||
      event.event === 'ui-finish-dispatch'
    ) {
      const previous = result.get(event.sessionId)
      if (
        previous === undefined ||
        event.originalIndex < previous
      ) {
        result.set(event.sessionId, event.originalIndex)
      }
    }
  }
  return result
}

function incidentReviewRecords(
  incident: DiagnosticIncidentSnapshot | undefined,
): UnknownRecord[] {
  const database = asRecord(incident?.database)
  const records = database?.reviewRecords
  return Array.isArray(records)
    ? records
        .map(asRecord)
        .filter((record): record is UnknownRecord => Boolean(record))
    : []
}

function logicalWordNames(record: UnknownRecord): string[] {
  if (!Array.isArray(record.words)) return []
  const names = record.words
    .map((word) => asString(asRecord(word)?.name))
    .filter((name): name is string => Boolean(name))
  return [...new Set(names)]
}

function acquisitionWordCount(
  record: UnknownRecord,
): number | undefined {
  const kind = asString(record.sessionKind)
  const names = logicalWordNames(record)

  if (kind === 'review') return 0
  if (kind === 'acquisition') return names.length
  if (kind !== 'mixed') return undefined

  const itemKinds = asRecord(record.itemKinds)
  const acquisitionStates = asRecord(record.acquisitionStates)
  const acquisition = new Set<string>()

  for (const name of names) {
    if (itemKinds?.[name] === 'acquisition') {
      acquisition.add(name)
    }
  }
  for (const name of Object.keys(acquisitionStates ?? {})) {
    acquisition.add(name)
  }

  if (!itemKinds && !acquisitionStates) return undefined
  return acquisition.size
}

function ownerWord(ownerKey: string): string | undefined {
  const separator = ownerKey.lastIndexOf(':')
  if (separator < 0 || separator === ownerKey.length - 1) {
    return undefined
  }
  return ownerKey.slice(separator + 1)
}

function audioOwnerKey(
  event: NormalizedDiagnosticEvent,
): string | undefined {
  for (const key of [
    'audioOwnerKey',
    'ownerKey',
    'requestedOwnerKey',
  ]) {
    const value = asString(event.details[key])
    if (value) return value
  }
  return undefined
}

function deriveLearnTrace(
  parsed: ParsedDiagnosticExport,
): LearnTraceEnvelope {
  const events: LearnSystemTraceEvent[] = []

  for (const event of parsed.events) {
    if (
      event.event === 'word-record-durable' &&
      asBoolean(event.details.finalQueueItem) === true &&
      event.sessionId &&
      event.word &&
      event.index !== undefined &&
      event.queueLength !== undefined
    ) {
      events.push({
        kind: 'terminal-word-durable',
        sessionId: event.sessionId,
        word: event.word,
        index: event.index,
        queueLength: event.queueLength,
      })
    }

    if (
      event.event === 'ui-finish-dispatch' &&
      event.sessionId
    ) {
      events.push({
        kind: 'terminal-ui-finished',
        sessionId: event.sessionId,
      })
    }

    const finished = checkpointFinished(event)
    if (
      finished !== undefined &&
      event.sessionId &&
      event.index !== undefined &&
      event.queueLength !== undefined
    ) {
      events.push({
        kind: 'checkpoint',
        action: 'save',
        sessionId: event.sessionId,
        index: event.index,
        isFinished: finished,
        queueSignature: `field:${event.queueLength}`,
        wordCount: event.queueLength,
      })
    }
  }

  return {
    version: LEARN_TRACE_IR_VERSION,
    source: 'historical-replay',
    scenario: parsed.kind,
    events,
  }
}

export function replayDiagnostic(
  input: string | unknown | ParsedDiagnosticExport,
): DiagnosticReplayReport {
  const parsed =
    asRecord(input)?.kind === 'trace' ||
    asRecord(input)?.kind === 'incident'
      ? (input as ParsedDiagnosticExport)
      : parseDiagnosticExport(input)
  const anomalies: ReplayAnomaly[] = []
  const events = parsed.events
  const terminals = terminalIndexes(events)

  // Checkpoint monotonicity and active index bounds.
  const finishedBySession = new Set<string>()
  for (const event of events) {
    const finished = checkpointFinished(event)

    if (
      event.sessionId &&
      finishedBySession.has(event.sessionId) &&
      finished === false
    ) {
      anomalies.push(
        anomaly({
          code: 'finished-checkpoint-regression',
          evidenceKind:
            event.sessionEvidence === 'observed'
              ? 'observed'
              : 'mixed',
          sessionId: event.sessionId,
          firstBadEventIndex: event.originalIndex,
          eventIndexes: [event.originalIndex],
          summary:
            'A finished Learn checkpoint regressed to isFinished=false.',
        }),
      )
    }
    if (event.sessionId && finished === true) {
      finishedBySession.add(event.sessionId)
    }

    if (
      event.index !== undefined &&
      event.queueLength !== undefined &&
      event.queueLength >= 0
    ) {
      const invalid =
        event.index < 0 ||
        (finished !== true &&
          event.queueLength > 0 &&
          event.index >= event.queueLength)
      if (invalid) {
        anomalies.push(
          anomaly({
            code: 'invalid-session-index',
            evidenceKind: 'observed',
            sessionId: event.sessionId,
            word: event.word,
            firstBadEventIndex: event.originalIndex,
            eventIndexes: [event.originalIndex],
            summary:
              `Active index ${event.index} is outside queue length ${event.queueLength}.`,
          }),
        )
      }
    }
  }

  // No additional Learn evidence is legal after terminal immutability.
  for (const event of events) {
    if (event.event !== 'word-record-durable') continue
    if (!event.sessionId) continue
    const terminal = terminals.get(event.sessionId)
    if (
      terminal !== undefined &&
      event.originalIndex > terminal
    ) {
      anomalies.push(
        anomaly({
          code: 'finished-session-evidence-after-terminal',
          evidenceKind:
            event.sessionEvidence === 'observed'
              ? 'observed'
              : 'derived',
          sessionId: event.sessionId,
          word: event.word,
          firstBadEventIndex: event.originalIndex,
          eventIndexes: [terminal, event.originalIndex],
          summary:
            'Learn evidence was recorded after the session became terminal.',
        }),
      )
    }
  }

  // Audio owner mismatch only when owner key and displayed word are explicit.
  for (const event of events) {
    if (!event.event.includes('audio')) continue
    const owner = audioOwnerKey(event)
    if (!owner || !event.word) continue
    const ownedWord = ownerWord(owner)
    if (ownedWord && ownedWord !== event.word) {
      anomalies.push(
        anomaly({
          code: 'audio-owner-lifecycle-violation',
          evidenceKind: 'observed',
          sessionId: event.sessionId,
          word: event.word,
          firstBadEventIndex: event.originalIndex,
          eventIndexes: [event.originalIndex],
          summary:
            `Audio owner ${owner} does not match displayed word ${event.word}.`,
        }),
      )
    }
  }

  // Incident-only terminal UI divergence.
  if (parsed.incident) {
    const resultVisible =
      parsed.incident.dom?.resultVisible === true
    const typingWord =
      parsed.incident.dom?.typingWord?.['data-typing-word']
    const finishedSessions = new Set(
      events
        .filter(
          (event) =>
            event.sessionId &&
            checkpointFinished(event) === true,
        )
        .map((event) => event.sessionId as string),
    )

    for (const sessionId of finishedSessions) {
      const finishDispatch = events.find(
        (event) =>
          event.sessionId === sessionId &&
          event.event === 'ui-finish-dispatch',
      )
      if (
        finishDispatch &&
        !resultVisible &&
        typingWord
      ) {
        const finishedCheckpoint = events.find(
          (event) =>
            event.sessionId === sessionId &&
            checkpointFinished(event) === true,
        )
        anomalies.push(
          anomaly({
            code: 'terminal-ui-divergence',
            evidenceKind: 'mixed',
            sessionId,
            word: typingWord,
            firstBadEventIndex:
              finishDispatch.originalIndex,
            eventIndexes: [
              ...(finishedCheckpoint
                ? [finishedCheckpoint.originalIndex]
                : []),
              finishDispatch.originalIndex,
            ],
            summary:
              'The session is durably finished and finish UI was dispatched, but the captured DOM still renders an active word without the Learn result screen.',
          }),
        )
      }
    }

    for (const record of incidentReviewRecords(parsed.incident)) {
      const count = acquisitionWordCount(record)
      if (count === undefined || count <= 20) continue
      const id = record.id ?? record.createTime
      const sessionId =
        typeof id === 'string' || typeof id === 'number'
          ? String(id)
          : undefined
      anomalies.push(
        anomaly({
          code: 'oversized-acquisition-classification',
          evidenceKind: 'observed',
          sessionId,
          eventIndexes: [],
          summary:
            `Acquisition cohort contains ${count} logical words (>20).`,
        }),
      )
    }
  }

  const deduped = new Map<string, ReplayAnomaly>()
  for (const item of anomalies) {
    const key = [
      item.signature,
      item.firstBadEventIndex ?? '-',
      item.eventIndexes.join(','),
    ].join('|')
    if (!deduped.has(key)) deduped.set(key, item)
  }

  return {
    schema: parsed.schema,
    kind: parsed.kind,
    ...(parsed.buildCommit
      ? { buildCommit: parsed.buildCommit }
      : {}),
    eventCount: events.length,
    sessionsSeen: [
      ...new Set(
        events
          .map((event) => event.sessionId)
          .filter((id): id is string => Boolean(id)),
      ),
    ],
    anomalies: [...deduped.values()],
    learnTrace: deriveLearnTrace(parsed),
  }
}

function parsedWithEvents(
  parsed: ParsedDiagnosticExport,
  events: NormalizedDiagnosticEvent[],
): ParsedDiagnosticExport {
  return {
    ...parsed,
    events,
  }
}

export function minimizeDiagnosticEvents(
  input: string | unknown | ParsedDiagnosticExport,
  targetSignature: string,
): DiagnosticMinimizationResult {
  const parsed =
    asRecord(input)?.kind === 'trace' ||
    asRecord(input)?.kind === 'incident'
      ? (input as ParsedDiagnosticExport)
      : parseDiagnosticExport(input)
  const original = [...parsed.events]

  const reproduces = (
    candidate: NormalizedDiagnosticEvent[],
  ): boolean =>
    replayDiagnostic(
      parsedWithEvents(parsed, candidate),
    ).anomalies.some(
      (item) => item.signature === targetSignature,
    )

  if (!reproduces(original)) {
    throw new DiagnosticReplayError(
      `target anomaly is not reproducible: ${targetSignature}`,
    )
  }

  let current = original
  let granularity = 2

  while (current.length >= 2) {
    const chunkSize = Math.ceil(
      current.length / granularity,
    )
    let reduced = false

    for (
      let start = 0;
      start < current.length;
      start += chunkSize
    ) {
      const candidate = [
        ...current.slice(0, start),
        ...current.slice(start + chunkSize),
      ]
      if (
        candidate.length > 0 &&
        reproduces(candidate)
      ) {
        current = candidate
        granularity = Math.max(2, granularity - 1)
        reduced = true
        break
      }
    }

    if (reduced) continue
    if (granularity >= current.length) break
    granularity = Math.min(
      current.length,
      granularity * 2,
    )
  }

  // Deterministic 1-minimal cleanup.
  let index = 0
  while (index < current.length) {
    const candidate = [
      ...current.slice(0, index),
      ...current.slice(index + 1),
    ]
    if (
      candidate.length > 0 &&
      reproduces(candidate)
    ) {
      current = candidate
    } else {
      index += 1
    }
  }

  return {
    targetSignature,
    originalEventCount: original.length,
    minimizedEventCount: current.length,
    retainedSequences: current.map(
      (event) => event.sequence,
    ),
    events: current,
  }
}
