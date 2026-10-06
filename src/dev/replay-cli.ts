import fs from 'node:fs/promises'
import path from 'node:path'
import {
  DiagnosticReplayError,
  createReplayableMinimizedExport,
  minimizeDiagnosticEvents,
  parseDiagnosticExport,
  replayDiagnostic,
} from './replay'

async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    console.error(
      'usage: yarn diagnostic:replay <Qwerty-Plus-Incident-or-Trace.json>',
    )
    process.exitCode = 1
    return
  }

  try {
    const absolute = path.resolve(filePath)
    const raw = await fs.readFile(absolute, 'utf8')
    const parsed = parseDiagnosticExport(raw)
    const report = replayDiagnostic(parsed)

    const output = {
      file: absolute,
      schema: report.schema,
      kind: report.kind,
      buildCommit: report.buildCommit ?? null,
      eventCount: report.eventCount,
      sessionsSeen: report.sessionsSeen,
      anomalies: report.anomalies,
    }

    console.log(JSON.stringify(output, null, 2))

    if (report.anomalies.length > 0) {
      const target = report.anomalies[0]
      const minimized = minimizeDiagnosticEvents(
        parsed,
        target.signature,
      )
      const minimizedPath = absolute.replace(
        /\.json$/i,
        '.min.json',
      )
      await fs.writeFile(
        minimizedPath,
        JSON.stringify(
          createReplayableMinimizedExport(
            parsed,
            minimized,
          ),
          null,
          2,
        ),
      )
      console.error(
        `anomaly ${target.signature}; minimized ${minimized.originalEventCount} -> ${minimized.minimizedEventCount}; artifact: ${minimizedPath}`,
      )
      process.exitCode = 2
    }
  } catch (error) {
    if (error instanceof DiagnosticReplayError) {
      console.error(error.message)
    } else {
      console.error(error)
    }
    process.exitCode = 1
  }
}

void main()
