export const DEVELOPER_DIAGNOSTICS_CONFIG_KEY =
  'developerDiagnosticsConfig'
export const DEVELOPER_TRACE_STORAGE_KEY =
  'qwertyDeveloperTraceV1'
export const DEVELOPER_TRACE_SCHEMA =
  'qwerty-developer-trace-v1' as const

const MAX_DEVELOPER_TRACE_EVENTS = 800

export type DeveloperTraceScope =
  | 'audio'
  | 'learn-terminal'
  | 'persistence'
  | 'navigation'
  | 'runtime'

export type DeveloperTraceEventInput = {
  scope: DeveloperTraceScope
  event: string
  word?: string
  sessionId?: string
  wordEpoch?: number
  index?: number
  queueLength?: number
  details?: Record<
    string,
    string | number | boolean | null | undefined
  >
}

export type DeveloperTraceEvent = DeveloperTraceEventInput & {
  schemaVersion: 1
  sequence: number
  at: number
  path: string
}

export type DeveloperTraceEnvelope = {
  schema: typeof DEVELOPER_TRACE_SCHEMA
  exportedAt: number
  events: DeveloperTraceEvent[]
}

function safeParse<T>(
  raw: string | null,
  fallback: T,
): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function isDeveloperDiagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const config = safeParse<{ isOpen?: boolean }>(
    window.localStorage.getItem(
      DEVELOPER_DIAGNOSTICS_CONFIG_KEY,
    ),
    {},
  )
  return config.isOpen === true
}

export function readDeveloperTrace(): DeveloperTraceEvent[] {
  if (typeof window === 'undefined') return []
  const events = safeParse<DeveloperTraceEvent[]>(
    window.localStorage.getItem(
      DEVELOPER_TRACE_STORAGE_KEY,
    ),
    [],
  )
  return Array.isArray(events) ? events : []
}

export function appendDeveloperTrace(
  input: DeveloperTraceEventInput,
): void {
  if (
    typeof window === 'undefined' ||
    !isDeveloperDiagnosticsEnabled()
  ) {
    return
  }

  try {
    const events = readDeveloperTrace()
    const previous = events.at(-1)
    const details = input.details
      ? Object.fromEntries(
          Object.entries(input.details).filter(
            ([, value]) => value !== undefined,
          ),
        )
      : undefined

    const event: DeveloperTraceEvent = {
      ...input,
      ...(details && Object.keys(details).length > 0
        ? { details }
        : {}),
      schemaVersion: 1,
      sequence: (previous?.sequence ?? 0) + 1,
      at: Date.now(),
      path: window.location.pathname,
    }
    const next = [...events, event].slice(
      -MAX_DEVELOPER_TRACE_EVENTS,
    )
    window.localStorage.setItem(
      DEVELOPER_TRACE_STORAGE_KEY,
      JSON.stringify(next),
    )
  } catch (error) {
    // Diagnostics must never become a product dependency or block learning.
    console.warn('developer trace write failed', error)
  }
}

export function clearDeveloperTrace(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(
    DEVELOPER_TRACE_STORAGE_KEY,
  )
}

export function createDeveloperTraceEnvelope(): DeveloperTraceEnvelope {
  return {
    schema: DEVELOPER_TRACE_SCHEMA,
    exportedAt: Date.now(),
    events: readDeveloperTrace(),
  }
}

export function exportDeveloperTrace(): void {
  if (typeof document === 'undefined') return
  const envelope = createDeveloperTraceEnvelope()
  const blob = new Blob(
    [JSON.stringify(envelope, null, 2)],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download =
    'Qwerty-Plus-Developer-Trace-' +
    new Date().toISOString().replace(/[:.]/g, '-') +
    '.json'
  anchor.click()
  URL.revokeObjectURL(url)
}
