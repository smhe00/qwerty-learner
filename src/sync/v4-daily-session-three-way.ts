/**
 * M2 conservative, per-dictionary LearnDailySession V4 merge.
 *
 * A single full V4 has ONE daily session per dictionary. Independently
 * changing the SAME dictionary on two devices may represent two active
 * cohorts; choosing a winner would silently discard a session cursor.
 * Therefore only disjoint dictionary changes, a single-side edit or exact
 * identical change are admissible. Never infer progress from timestamps.
 *
 * This is pure projection; it confers NO M4 or cloud publication authority.
 */
import type { LearnDailySessionV1 } from '@/learn/daily-session'
import { stableWorkspaceJson } from './workspace-v4'

type Runtime = { dailySessions: Record<string, LearnDailySessionV1> }
type Result =
  | { status: 'blocked'; reason: string;
      publishReady: false; convergenceComplete: false }
  | { status: 'merged'; dailySessions: Record<string, LearnDailySessionV1>
      changedDictionaries: string[];
      publishReady: false; convergenceComplete: false }

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
function tagged(records: Runtime['dailySessions'], key: string): string {
  return stableWorkspaceJson(has(records, key)
    ? { present: true, value: records[key] }
    : { present: false })
}
export function mergeDailySessionsThreeWay(input: {
  ancestor: Runtime
  local: Runtime
  remote: Runtime
}): Result {
  const denied = (reason: string): Result => ({
    status: 'blocked', reason, publishReady: false,
    convergenceComplete: false,
  })
  try {
    const keys = new Set(Object.keys(input.ancestor.dailySessions))
    for (const side of [input.local, input.remote]) {
      for (const key of Object.keys(side.dailySessions)) keys.add(key)
    }
    const dailySessions: Runtime['dailySessions'] = {}
    const changedDictionaries: string[] = []
    for (const key of [...keys].sort()) {
      if (!key || key === '__proto__' || key === 'constructor' ||
          key === 'prototype') {
        return denied('invalid-dictionary-key')
      }
      const a = tagged(input.ancestor.dailySessions, key)
      const l = tagged(input.local.dailySessions, key)
      const r = tagged(input.remote.dailySessions, key)
      if (a !== l || a !== r) changedDictionaries.push(key)
      if (has(input.ancestor.dailySessions, key) &&
          (!has(input.local.dailySessions, key) ||
           !has(input.remote.dailySessions, key))) {
        return denied('ancestral-daily-session-deleted:' + key)
      }
      const picked = l === r ? input.local.dailySessions :
        l === a ? input.remote.dailySessions :
          r === a ? input.local.dailySessions : null
      if (!picked) return denied('concurrent-daily-session-divergence:' + key)
      if (has(picked, key)) {
        const session = picked[key]
        if (!session || session.dict !== key ||
            session.version !== 1 ||
            typeof session.sessionId !== 'string' || !session.sessionId ||
            !Array.isArray(session.completedBlockIds)) {
          return denied('invalid-daily-session:' + key)
        }
        dailySessions[key] = structuredClone(session)
      }
    }
    // Unknown future learnRuntime fields may carry new persistent state.
    // Do not silently drop them by projecting just dailySessions.
    const rest = (runtime: Runtime) => {
      const { dailySessions: _sessions, ...other } =
        runtime as Runtime & Record<string, unknown>
      return stableWorkspaceJson(other)
    }
    const baseRest = rest(input.ancestor)
    if (rest(input.local) !== baseRest ||
        rest(input.remote) !== baseRest) {
      return denied('unsupported-learn-runtime-fields')
    }
    return { status: 'merged', dailySessions, changedDictionaries,
      publishReady: false, convergenceComplete: false }
  } catch (error) {
    return denied('invalid-runtime:' +
      (error instanceof Error ? error.message : 'unknown'))
  }
}
