import type { AchievementEventRecord } from './types'

/**
 * Persist only observed non-zero achievement metrics. A zero value never
 * signals an unlock; the full metric vector is transient and is recalculated
 * at the next evaluation from learning evidence. Source IDs, event identity,
 * session lineage and unlocked achievement IDs stay untouched.
 *
 * No retrospective rewrite: existing V4 data, revisions and fingerprints
 * stay identical. The schema retains metricValues as a record (possibly {}).
 */
export function compactAchievementEvent(
  event: AchievementEventRecord,
): AchievementEventRecord {
  const values = Object.fromEntries(Object.entries(event.metricValues)
    .filter(([, value]) => value !== 0))
  return { ...event, metricValues: values }
}
