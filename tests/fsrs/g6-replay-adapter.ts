/**
 * G6-2: research-only native FSRS card replay and cloud-merge contract.
 * Not imported by production. The event digest is a consistency check, not a
 * cryptographic authentication or a substitute for durable source history.
 */
import { createHash } from 'node:crypto'
import { Rating, createEmptyCard, fsrs, type Card } from 'ts-fsrs'

export type G6Profile = {
  id: string
  shortTerm: boolean
  learningSteps: string[]
  relearningSteps: string[]
}
export const G6_PROFILES: readonly G6Profile[] = [
  { id: 'A', shortTerm: false, learningSteps: [], relearningSteps: [] },
  { id: 'B', shortTerm: true, learningSteps: [], relearningSteps: [] },
  { id: 'C', shortTerm: true, learningSteps: [], relearningSteps: ['10m'] },
  { id: 'D', shortTerm: true, learningSteps: ['1m', '10m'], relearningSteps: ['10m'] },
]

export type G6Context = {
  workspaceId: string
  dict: string
  word: string
  seedAtMs: number
}
export type G6ResearchEvent = {
  // In actual cloud history, prefer immutable cross-device attemptId, not DB row ID.
  eventId: string
  attemptId: string
  workspaceId: string
  dict: string
  word: string
  occurredAtMs: number
  role: 'long-term-independent' | 'short-term-independent' | 'assisted-training'
  rating: Rating | null
  eligible: boolean
}
export type G6CardProjection = {
  due: string
  state: number
  learningSteps: number
  stability: number
  difficulty: number
  reps: number
  lapses: number
  scheduledDays: number
  elapsedDays: number
  lastReview: string | null
}
export type G6Snapshot = {
  version: 1
  context: G6Context
  profileId: string
  eventsSha256: string
  appliedEventIds: string[]
  card: G6CardProjection
}

function hash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}
function project(card: Card): G6CardProjection {
  return {
    due: card.due.toISOString(),
    state: card.state,
    learningSteps: card.learning_steps,
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    scheduledDays: card.scheduled_days,
    elapsedDays: card.elapsed_days,
    lastReview: card.last_review?.toISOString() ?? null,
  }
}
function validateContext(context: G6Context): void {
  if (!context.workspaceId || !context.dict || !context.word) {
    throw new Error('G6 replay needs a unique workspace, dictionary and word')
  }
  if (!Number.isSafeInteger(context.seedAtMs) || context.seedAtMs < 0) {
    throw new Error('G6 replay needs a valid seed timestamp')
  }
}
function eventFingerprint(event: G6ResearchEvent): string {
  return hash(event)
}

/**
 * Conflict detection runs BEFORE sorting or filtering: a duplicate ID must
 * not be silently interpreted as two distinct ratings or overwritten during
 * a merge. Reject attempted cross-workspace contamination even when disabled.
 */
export function canonicalG6Events(
  context: G6Context,
  events: readonly G6ResearchEvent[],
): G6ResearchEvent[] {
  validateContext(context)
  const eventFingerprints = new Map<string, string>()
  const attemptFingerprints = new Map<string, string>()
  const canonical: G6ResearchEvent[] = []
  for (const event of events) {
    if (
      event.workspaceId !== context.workspaceId ||
      event.dict !== context.dict ||
      event.word !== context.word
    ) {
      throw new Error('G6 cross-workspace/dict/word event rejected')
    }
    if (
      !event.eventId || !event.attemptId ||
      !Number.isSafeInteger(event.occurredAtMs) ||
      event.occurredAtMs < context.seedAtMs
    ) {
      throw new Error('G6 incomplete or pre-seed learning event')
    }
    if (event.eligible !== (event.rating !== null)) {
      throw new Error('G6 inconsistent rating eligibility')
    }
    if (event.role === 'assisted-training' && event.eligible) {
      throw new Error('G6 assisted work cannot update FSRS')
    }
    if (event.eligible && ![Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].includes(event.rating!)) {
      throw new Error('G6 invalid FSRS rating')
    }
    const fingerprint = eventFingerprint(event)
    const priorEvent = eventFingerprints.get(event.eventId)
    const priorAttempt = attemptFingerprints.get(event.attemptId)
    if ((priorEvent && priorEvent !== fingerprint) || (priorAttempt && priorAttempt !== fingerprint)) {
      throw new Error('G6 conflicting immutable event/attempt identity')
    }
    if (priorEvent || priorAttempt) continue
    eventFingerprints.set(event.eventId, fingerprint)
    attemptFingerprints.set(event.attemptId, fingerprint)
    canonical.push({ ...event })
  }
  return canonical.sort((a, b) =>
    a.occurredAtMs - b.occurredAtMs ||
    a.eventId.localeCompare(b.eventId, 'en'),
  )
}

export function mergeG6Events(
  context: G6Context,
  left: readonly G6ResearchEvent[],
  right: readonly G6ResearchEvent[],
): G6ResearchEvent[] {
  return canonicalG6Events(context, [...left, ...right])
}

export function replayG6Card(
  context: G6Context,
  profile: G6Profile,
  records: readonly G6ResearchEvent[],
): { card: Card; snapshot: G6Snapshot } {
  if (!G6_PROFILES.some((candidate) =>
    candidate.id === profile.id &&
    candidate.shortTerm === profile.shortTerm &&
    JSON.stringify(candidate.learningSteps) === JSON.stringify(profile.learningSteps) &&
    JSON.stringify(candidate.relearningSteps) === JSON.stringify(profile.relearningSteps)
  )) {
    throw new Error('G6 unrecognized parameter set')
  }
  const events = canonicalG6Events(context, records)
  const scheduler = fsrs({
    request_retention: 0.84,
    maximum_interval: 36500,
    enable_fuzz: false,
    enable_short_term: profile.shortTerm,
    learning_steps: profile.learningSteps,
    relearning_steps: profile.relearningSteps,
  })
  let card = createEmptyCard(new Date(context.seedAtMs))
  const appliedEventIds: string[] = []
  for (const event of events) {
    if (!event.eligible) continue
    card = scheduler.next(card, new Date(event.occurredAtMs), event.rating!).card
    if (!Number.isFinite(card.stability) || !Number.isFinite(card.difficulty) ||
        !Number.isFinite(card.due.getTime())) {
      throw new Error('G6 nonfinite card state')
    }
    appliedEventIds.push(event.eventId)
  }
  const snapshot: G6Snapshot = {
    version: 1,
    context: { ...context },
    profileId: profile.id,
    eventsSha256: hash(events),
    appliedEventIds,
    card: project(card),
  }
  return { card, snapshot }
}

export function verifyG6Snapshot(
  snapshot: G6Snapshot,
  context: G6Context,
  profile: G6Profile,
  records: readonly G6ResearchEvent[],
): boolean {
  const recomputed = replayG6Card(context, profile, records).snapshot
  return hash(snapshot) === hash(recomputed)
}
