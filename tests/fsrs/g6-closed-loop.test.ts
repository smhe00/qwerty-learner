/**
 * G6-3: synthetic, budget-capped, minute-level CLOSED-LOOP study experiment.
 *
 * FSRS handles due/card state; a separate latent-strength learner determines
 * recall and benefits from practice. No FSRS formula is used to simulate the
 * student's hidden memory. This is a sensitivity test, NOT human-study proof.
 *
 * Six arms: A / B / C / D plus X (10m practice only) and Y (10m independent
 * recall fed into FSRS short-term model without native Relearning state).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Rating, createEmptyCard, fsrs, type Card } from 'ts-fsrs'

const DAY = 86_400_000
const MIN = 60_000
const BASE = Date.parse('2026-10-16T00:00:00.000Z')
const DICTIONARY = 64
const DAYS = 125
const DAILY_BUDGET = 9 * MIN // hard ceiling on ACTIVE learner work
const WINDOWS = [8 * 60, 19 * 60] // minute of virtual local day
const WINDOW_WALL = 25 * MIN
const MAX_NEW_PER_DAY = 2
const SEEDS = [7, 19, 31, 43, 59]
const PERSONAS = [
  { id: 'strong', initial: 2.0, gain: 0.90, slip: 0.012, attendance: 0.96 },
  { id: 'balanced', initial: 1.35, gain: 0.72, slip: 0.025, attendance: 0.92 },
  { id: 'weak-memory', initial: 0.95, gain: 0.60, slip: 0.037, attendance: 0.88 },
  { id: 'fatigued', initial: 1.18, gain: 0.62, slip: 0.075, attendance: 0.82 },
] as const

type MemoryHypothesis = 'spacing-sensitive' | 'repetition-sensitive'
type Arm = 'A' | 'B' | 'C' | 'D' | 'X' | 'Y'
const ARMS: Arm[] = ['A', 'B', 'C', 'D', 'X', 'Y']
type Persona = typeof PERSONAS[number]
type HiddenWord = {
  id: number
  admittedAt: number
  lastAt: number
  strengthDays: number
  card: Card
  dueAt: number
  extraDue: number | null
  // G6-3b common QWERTY same-session reinforcement after four other words.
  reinforcementAfter: number | null
  attempts: number
}
type SimulationMetrics = {
  arm: Arm
  hypothesis: MemoryHypothesis
  persona: string
  seed: number
  admitted: number
  meanActiveMinutes: number
  reviewAttempts: number
  lapses: number
  sameDayIndependent: number
  extraTraining: number
  commonReinforcements: number
  maxDueBacklog: number
  overdueEnd: number
  probe1: number
  probe7: number
  probe30: number
  probe90: number
  eligible1: number
  eligible7: number
  eligible30: number
  eligible90: number
  efficiency30: number
  spentMinutes: number
  worstDayActiveMinutes: number
}

function unit(seed: number, ...keys: (string | number)[]): number {
  let h = (seed ^ 2166136261) >>> 0
  for (const k of keys.join('|')) {
    h ^= k.charCodeAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  return (h + 0.5) / 4_294_967_296
}
function chance(word: HiddenWord, at: number): number {
  const elapsedDays = Math.max(0, at - word.lastAt) / DAY
  return Math.max(0.001, Math.min(0.999,
    Math.exp(-0.65 * elapsedDays / word.strengthDays)))
}
function consumeMemoryPractice(word: HiddenWord, at: number, success: boolean, persona: Persona, hypothesis: MemoryHypothesis): void {
  const gapDays = Math.max(0, at - word.lastAt) / DAY
  if (success) {
    // Massed recalls help less than spaced independent retrieval in this toy learner.
    const spacing = hypothesis === 'spacing-sensitive'
      ? Math.min(1.8, Math.sqrt(gapDays + 0.02))
      : Math.min(1.8, 0.75 + 0.30 * Math.sqrt(gapDays + 0.02))
    word.strengthDays = Math.min(120, word.strengthDays *
      (1 + persona.gain * spacing) + 0.15)
  } else {
    // Again includes QWERTY teaching / hint remediation, never credited as FSRS Good.
    word.strengthDays = Math.max(0.50, word.strengthDays * 0.72) + 0.25
  }
  word.lastAt = at
}
function profile(arm: Arm) {
  return {
    request_retention: 0.84,
    maximum_interval: 36500,
    enable_fuzz: false,
    enable_short_term: arm === 'B' || arm === 'C' || arm === 'D' || arm === 'Y',
    learning_steps: arm === 'D' ? ['1m', '10m'] : [],
    relearning_steps: arm === 'C' || arm === 'D' ? ['10m'] : [],
  }
}

function simulate(
  arm: Arm, persona: Persona, seed: number, hypothesis: MemoryHypothesis,
  useCommonReinforcement = false,
): SimulationMetrics {
  const scheduler = fsrs(profile(arm))
  const words: HiddenWord[] = []
  const probes: Record<1 | 7 | 30 | 90, { ok: number; total: number }> = {
    1: { ok: 0, total: 0 }, 7: { ok: 0, total: 0 },
    30: { ok: 0, total: 0 }, 90: { ok: 0, total: 0 },
  }
  let totalActive = 0
  let attempts = 0
  let lapses = 0
  let sameDayIndependent = 0
  let extraTraining = 0
  let commonReinforcements = 0
  let wordCompletions = 0
  let maxDueBacklog = 0
  let newIndex = 0
  let worstDayActive = 0

  for (let day = 0; day < DAYS; day++) {
    const midnight = BASE + day * DAY
    // Identical study-day decisions across arms; varies by user and day.
    const attends = unit(seed, persona.id, 'attendance', day) < persona.attendance
    let dayActive = 0
    let introducedToday = 0
    if (attends) {
      for (const minuteOfDay of WINDOWS) {
        let now = midnight + minuteOfDay * MIN
        const windowEnd = now + WINDOW_WALL
        let iteration = 0
        while (dayActive < DAILY_BUDGET && now < windowEnd && iteration++ < 100) {
          // Always honor overdue long-term cold probe before any optional
          // delayed practice, so the latter never contaminates that cold test.
          const due = words.map(word => ({
            word,
            longDue: word.dueAt,
            optionalDue: word.extraDue ?? Infinity,
          })).map(item => ({
            ...item,
            effectiveDue: item.longDue <= now
              ? item.longDue
              : Math.min(item.longDue, item.optionalDue),
          })).sort((a, b) =>
            a.effectiveDue - b.effectiveDue || a.word.id - b.word.id)
          const firstDue = due[0]
          if (firstDue && firstDue.effectiveDue <= now) {
            const word = firstDue.word
            const isExtra =
              word.extraDue !== null && word.extraDue <= now && word.dueAt > now
            const needed = 45_000 // cap worst-case even after an Again
            if (dayActive + needed > DAILY_BUDGET || now + needed > windowEnd) break
            const probability = chance(word, now)
            const random = unit(seed, persona.id, 'recall', word.id, word.attempts)
            const slip = unit(seed, persona.id, 'slip', word.id, word.attempts)
            const success = random < probability
            const rating = !success ? Rating.Again :
              slip < persona.slip ? Rating.Hard :
              probability > 0.94 ? Rating.Easy :
              probability < 0.45 ? Rating.Hard : Rating.Good
            word.attempts++
            attempts++
            if (!success) lapses++
            if (isExtra) {
              word.extraDue = null
              if (arm === 'X') {
                // Explicit non-FSRS training: practice still affects learner.
                extraTraining++
              } else {
                sameDayIndependent++
                word.card = scheduler.next(word.card, new Date(now), rating).card
                word.dueAt = word.card.due.getTime()
              }
            } else {
              if (word.card.last_review &&
                  now - word.card.last_review.getTime() < DAY) {
                sameDayIndependent++
              }
              word.card = scheduler.next(word.card, new Date(now), rating).card
              word.dueAt = word.card.due.getTime()
              if ((arm === 'X' || arm === 'Y') && rating === Rating.Again) {
                word.extraDue = now + 10 * MIN
              } else if (word.extraDue !== null && word.dueAt <= now) {
                word.extraDue = null
              }
            }
            // A failed canonical review may request QWERTY's native
            // four-intervening-word reinforcement. It never creates an FSRS
            // rating; the extra 10m path, if present, remains separate.
            if (useCommonReinforcement && !isExtra && rating === Rating.Again) {
              word.reinforcementAfter = wordCompletions + 5
            }
            consumeMemoryPractice(word, now, success, persona, hypothesis)
            wordCompletions += 1
            now += needed
            dayActive += needed
            totalActive += needed
            continue
          }

          // Shared existing QWERTY reinforcement: after four intervening
          // words, before optional new acquisition. This is NOT an FSRS
          // rating even when independent corrective spelling succeeds.
          // Long-term due cold probes always outrank it, avoiding pre-test
          // contamination. Unfinished reinforcements expire at session end.
          if (useCommonReinforcement) {
            const ready = words.find(word =>
              word.reinforcementAfter !== null &&
              word.reinforcementAfter <= wordCompletions &&
              word.dueAt > now)
            if (ready && dayActive + 35_000 <= DAILY_BUDGET &&
                now + 35_000 <= windowEnd) {
              const p = chance(ready, now)
              const recall = unit(seed, persona.id, 'common-reinforcement', ready.id, ready.attempts)
              const success = recall < p
              consumeMemoryPractice(ready, now, success, persona, hypothesis)
              // Conservatively treat the corrective completion as training
              // with some pedagogical benefit, but no FSRS rating.
              ready.reinforcementAfter = null
              commonReinforcements++
              wordCompletions++
              now += 35_000
              dayActive += 35_000
              totalActive += 35_000
              continue
            }
          }

          // New acquisition before idle waiting, due-first.
          if (introducedToday < MAX_NEW_PER_DAY && newIndex < DICTIONARY &&
              dayActive + 55_000 <= DAILY_BUDGET && now + 55_000 <= windowEnd) {
            const id = newIndex++
            const strength = persona.initial * (0.8 +
              0.4 * unit(seed, 'word-difficulty', id))
            let card = createEmptyCard(new Date(now))
            let dueAt = now + DAY // QWERTY's current 24h post-admission rule
            if (arm === 'D') {
              // Research hypothesis only: treat acquisition's final independent
              // Good as a genuine native FSRS Learning event. This differs from
              // baseline admission, and must NOT be presented as a fair A/B
              // test of short-term dynamics alone.
              card = scheduler.next(card, new Date(now), Rating.Good).card
              dueAt = card.due.getTime()
            }
            words.push({
              id, admittedAt: now, lastAt: now, strengthDays: strength,
              card, dueAt, extraDue: null, reinforcementAfter: null, attempts: 0,
            })
            introducedToday++
            wordCompletions++
            now += 55_000
            dayActive += 55_000
            totalActive += 55_000
            continue
          }

          // Can return at an actual minute-level due within this study window,
          // without treating waiting time as active learning.
          const nextDue = firstDue?.effectiveDue ?? Infinity
          if (nextDue > now && nextDue < windowEnd) {
            now = nextDue
          } else {
            break
          }
        }
        assert.ok(iteration <= 100, 'possible nonterminating FSRS due loop')
        // QWERTY's same-session reinforcement is not a persistent cross-day
        // due claim: it is forfeited when the study window ends.
        if (useCommonReinforcement) {
          for (const word of words) word.reinforcementAfter = null
        }
      }
    }
    worstDayActive = Math.max(worstDayActive, dayActive)
    const endOfDay = midnight + DAY - 1
    maxDueBacklog = Math.max(maxDueBacklog,
      words.filter(word => word.dueAt <= endOfDay).length)

    // Non-training probe, always before its day-end virtual clock.
    // This independent synthetic "measurement" never updates FSRS or memory.
    for (const word of words) {
      for (const age of [1, 7, 30, 90] as const) {
        const ageDays = Math.floor((midnight - word.admittedAt) / DAY) + 1
        if (ageDays !== age) continue
        const measuredAt = midnight + 23 * 3_600_000
        const p = chance(word, measuredAt)
        probes[age].total++
        if (unit(seed, persona.id, 'independent-probe', word.id, age) < p) {
          probes[age].ok++
        }
      }
    }
  }
  const spentMinutes = totalActive / MIN
  const overdueEnd = words.filter(word => word.dueAt <= BASE + DAYS * DAY).length
  return {
    arm, hypothesis, persona: persona.id, seed, admitted: words.length,
    meanActiveMinutes: spentMinutes / DAYS,
    reviewAttempts: attempts, lapses,
    sameDayIndependent, extraTraining, commonReinforcements,
    maxDueBacklog, overdueEnd,
    probe1: probes[1].ok, probe7: probes[7].ok, probe30: probes[30].ok,
    probe90: probes[90].ok, eligible1: probes[1].total,
    eligible7: probes[7].total, eligible30: probes[30].total,
    eligible90: probes[90].total,
    efficiency30: spentMinutes ? probes[30].ok / spentMinutes * 60 : 0,
    spentMinutes, worstDayActiveMinutes: worstDayActive / MIN,
  }
}
function rounded(n: number) { return Math.round(n * 10_000) / 10_000 }
function summarize(rows: SimulationMetrics[]) {
  const mean = (f: (item: SimulationMetrics) => number) =>
    rounded(rows.reduce((total, item) => total + f(item), 0) / rows.length)
  const pass = (probe: 1 | 7 | 30 | 90) => {
    const good = rows.reduce((sum, row) => sum + row[`probe${probe}`], 0)
    const eligible = rows.reduce((sum, row) => sum + row[`eligible${probe}`], 0)
    return { passRate: rounded(good / Math.max(1, eligible)), eligible, passed: good }
  }
  return {
    arm: rows[0].arm, hypothesis: rows[0].hypothesis, runs: rows.length,
    admitted: mean(x => x.admitted),
    activeMinutes: mean(x => x.spentMinutes),
    dailyActiveMinutes: mean(x => x.meanActiveMinutes),
    reviewAttempts: mean(x => x.reviewAttempts),
    lapses: mean(x => x.lapses),
    sameDayIndependent: mean(x => x.sameDayIndependent),
    extraTraining: mean(x => x.extraTraining),
    commonReinforcements: mean(x => x.commonReinforcements),
    maxDueBacklog: mean(x => x.maxDueBacklog),
    overdueEnd: mean(x => x.overdueEnd),
    maxDayMinutes: mean(x => x.worstDayActiveMinutes),
    independentProbe1: pass(1), independentProbe7: pass(7),
    independentProbe30: pass(30), independentProbe90: pass(90),
    probe30PerActiveHour: mean(x => x.efficiency30),
  }
}

test('G6-3: fixed budget closed-loop learner compares native vs extra training vs extra FSRS feedback', () => {
  const hypotheses: MemoryHypothesis[] = ['spacing-sensitive', 'repetition-sensitive']
  const runs = hypotheses.flatMap(hypothesis => ARMS.flatMap(arm =>
    PERSONAS.flatMap(persona => SEEDS.map(seed => simulate(arm, persona, seed, hypothesis)))))
  for (const r of runs) {
    assert.ok(r.spentMinutes >= 0)
    assert.ok(r.worstDayActiveMinutes <= DAILY_BUDGET / MIN + 1e-6,
      'a candidate exceeded the fixed daily active study budget')
    assert.ok(r.maxDueBacklog <= DICTIONARY)
    assert.ok(r.admitted <= DICTIONARY)
    assert.ok(r.probe30 <= r.eligible30)
    assert.ok(r.eligible30 <= r.admitted)
    assert.ok(r.overdueEnd <= r.admitted)
  }
  const matrix = hypotheses.flatMap(hypothesis => ARMS.map(arm =>
    summarize(runs.filter(r => r.arm === arm && r.hypothesis === hypothesis))))
  assert.equal(matrix.length, 12)
  assert.ok(matrix.some(x => x.sameDayIndependent > 0))
  assert.ok(matrix.some(x => x.extraTraining > 0))
  // A/B are NOT assumed equal: even with empty step arrays a New/Review
  // transition can produce a real short-interval event. Assert a matched
  // cohort and *measure* differences rather than making a false invariant.
  const a = runs.filter(x => x.arm === 'A')
  const b = runs.filter(x => x.arm === 'B')
  assert.deepEqual(a.map(x => [x.persona, x.seed]), b.map(x => [x.persona, x.seed]))
  console.log('G6_A_VS_B_NATIVE_SHORT_TERM_DIFF ' + JSON.stringify({
    differentTrajectories: a.filter((x, i) =>
      x.reviewAttempts !== b[i].reviewAttempts ||
      x.probe30 !== b[i].probe30 ||
      x.lapses !== b[i].lapses).length,
    runs: a.length,
    aSameDay: a.reduce((s, x) => s + x.sameDayIndependent, 0),
    bSameDay: b.reduce((s, x) => s + x.sameDayIndependent, 0),
  }))
  console.log('G6_CLOSED_LOOP_SYNTHETIC_MATRIX ' + JSON.stringify({
    days: DAYS, dictionary: DICTIONARY, personas: PERSONAS.map(x => x.id),
    seeds: SEEDS, hypotheses, budgetMinutesPerDay: DAILY_BUDGET / MIN,
    model: 'synthetic latent memory; not empirical efficacy',
    matrix,
  }))
})


test('G6-3b: fixed 10m delayed reinforcement must beat a realistic shared 4-word baseline, not a stripped one', () => {
  const hypotheses: MemoryHypothesis[] = ['spacing-sensitive', 'repetition-sensitive']
  const studyArms: Arm[] = ['A', 'X', 'C']
  const runs = hypotheses.flatMap(hypothesis => studyArms.flatMap(arm =>
    PERSONAS.flatMap(persona =>
      SEEDS.map(seed => simulate(arm, persona, seed, hypothesis, true)))))
  for (const run of runs) {
    assert.ok(run.commonReinforcements >= 0)
    assert.ok(run.spentMinutes > 0)
    assert.ok(run.worstDayActiveMinutes <= DAILY_BUDGET / MIN + 1e-6)
    assert.ok(run.maxDueBacklog <= DICTIONARY)
    assert.ok(run.overdueEnd <= run.admitted)
  }
  assert.ok(runs.some(run => run.commonReinforcements > 0),
    'existing four-word reinforcement must actually execute')
  assert.ok(runs.some(run => run.arm === 'X' && run.extraTraining > 0),
    'X must actually execute fixed-time non-FSRS extra practice')
  assert.ok(runs.some(run => run.arm === 'C' && run.sameDayIndependent > 0),
    'C must actually execute native FSRS Relearning')
  const matrix = hypotheses.flatMap(hypothesis =>
    studyArms.map(arm =>
      summarize(runs.filter(run => run.hypothesis === hypothesis && run.arm === arm))))
  console.log('G6_DELAYED_REINFORCEMENT_SHARED_BASELINE ' + JSON.stringify({
    explanation: 'all arms use identical simplified four-intervening-word reinforcement, hard daily active budget, no real student data',
    days: DAYS,
    seeds: SEEDS,
    personas: PERSONAS.map(p => p.id),
    hypotheses,
    matrix,
  }))
})
