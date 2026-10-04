import { readFileSync } from 'node:fs'
import {
  detectLearnSystemAnomalies,
} from '../simulation/system-oracle'
import {
  parseTlcCounterexample,
  tlcStatesToLearnTrace,
} from './tla-trace-bridge'

const [, , logPath, expectedCode] = process.argv

if (!logPath || !expectedCode) {
  throw new Error(
    'usage: tla-counterexample-check <tlc-log> <expected-anomaly-code>',
  )
}

const states = parseTlcCounterexample(
  readFileSync(logPath, 'utf8'),
)
if (states.length === 0) {
  throw new Error('TLC counterexample did not contain parseable states')
}

const trace = tlcStatesToLearnTrace(
  states,
  'live-tlc-counterexample',
)
const anomalies = detectLearnSystemAnomalies(trace.events)

if (!anomalies.some((item) => item.code === expectedCode)) {
  throw new Error(
    `expected anomaly ${expectedCode}; got ${anomalies
      .map((item) => item.code)
      .join(', ') || 'none'}`,
  )
}

console.log(
  'TLC_SHARED_TRACE',
  JSON.stringify({
    states: states.length,
    events: trace.events.length,
    anomalies: anomalies.map((item) => item.code),
  }),
)
