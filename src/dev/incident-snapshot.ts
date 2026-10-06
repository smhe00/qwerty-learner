import {
  DEVELOPER_DIAGNOSTICS_CONFIG_KEY,
  createDeveloperTraceEnvelope,
} from './diagnostic-trace'
import { db } from '@/utils/db'

export const DEVELOPER_INCIDENT_SCHEMA =
  'qwerty-developer-incident-v1' as const

type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue }

function safeJson(raw: string | null): SerializableValue | undefined {
  if (raw === null) return undefined
  try {
    return JSON.parse(raw) as SerializableValue
  } catch {
    return raw
  }
}

function readStoredString(key: string): string | undefined {
  const value = safeJson(window.localStorage.getItem(key))
  return typeof value === 'string' ? value : undefined
}

function collectAttributes(
  element: Element | null,
): Record<string, string> | undefined {
  if (!element) return undefined

  const entries = [...element.attributes]
    .filter(
      (attribute) =>
        attribute.name.startsWith('data-typing-') ||
        attribute.name.startsWith('data-review-') ||
        attribute.name.startsWith('data-learn-'),
    )
    .map((attribute) => [attribute.name, attribute.value])

  return entries.length > 0
    ? Object.fromEntries(entries)
    : undefined
}

function collectSafeLocalStorage() {
  const keys = [
    'currentDict',
    'currentChapter',
    'reviewModeInfo',
    DEVELOPER_DIAGNOSTICS_CONFIG_KEY,
    'pronunciation',
    'loopWordConfig',
    'typingTransVisible',
    'phoneticConfig',
    'wordDictationConfig',
    'randomConfig',
  ]

  return Object.fromEntries(
    keys.map((key) => [
      key,
      safeJson(window.localStorage.getItem(key)) ?? null,
    ]),
  )
}

function collectSafeSessionStorage() {
  const values: Record<string, string> = {}

  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index)
    if (!key?.startsWith('qwerty:lazy-route-reload:')) continue

    const value = window.sessionStorage.getItem(key)
    if (value !== null) values[key] = value
  }

  return values
}

export async function createDeveloperIncidentSnapshot() {
  const reviewModeInfo = safeJson(
    window.localStorage.getItem('reviewModeInfo'),
  ) as {
    reviewRecord?: { dict?: string }
  } | undefined
  const dict =
    reviewModeInfo?.reviewRecord?.dict ??
    readStoredString('currentDict')

  const database = await db.transaction(
    'r',
    db.wordRecords,
    db.chapterRecords,
    db.reviewRecords,
    db.reviewWordStates,
    db.achievementEvents,
    db.achievementStates,
    async () => {
      const [
        wordRecords,
        chapterRecords,
        reviewRecords,
        reviewWordStates,
        achievementEvents,
        achievementStates,
      ] = await Promise.all([
        dict
          ? db.wordRecords.where('dict').equals(dict).toArray()
          : db.wordRecords.toArray(),
        dict
          ? db.chapterRecords.where('dict').equals(dict).toArray()
          : db.chapterRecords.toArray(),
        dict
          ? db.reviewRecords.where('dict').equals(dict).toArray()
          : db.reviewRecords.toArray(),
        dict
          ? db.reviewWordStates.where('dict').equals(dict).toArray()
          : db.reviewWordStates.toArray(),
        dict
          ? db.achievementEvents.where('dict').equals(dict).toArray()
          : db.achievementEvents.toArray(),
        db.achievementStates.toArray(),
      ])

      return {
        dict: dict ?? null,
        wordRecords,
        chapterRecords,
        reviewRecords,
        reviewWordStates,
        achievementEvents,
        achievementStates,
      }
    },
  )

  const activeElement = document.activeElement

  return {
    schema: DEVELOPER_INCIDENT_SCHEMA,
    capturedAt: Date.now(),
    build: {
      commit: LATEST_COMMIT_HASH,
    },
    page: {
      href: window.location.href,
      path: window.location.pathname,
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      userAgent: window.navigator.userAgent,
      activeElement: activeElement
        ? {
            tagName: activeElement.tagName,
            role: activeElement.getAttribute('role'),
            ariaLabel: activeElement.getAttribute('aria-label'),
          }
        : null,
    },
    dom: {
      typingWord: collectAttributes(
        document.querySelector('[data-typing-word]'),
      ),
      acquisition: collectAttributes(
        document.querySelector('[data-learn-acquisition-phase]'),
      ),
      resultVisible: Boolean(
        document.querySelector('[data-learn-result-screen]'),
      ),
    },
    localStorage: collectSafeLocalStorage(),
    sessionStorage: collectSafeSessionStorage(),
    trace: createDeveloperTraceEnvelope(),
    database,
  }
}

export async function exportDeveloperIncidentSnapshot(): Promise<void> {
  if (typeof document === 'undefined') return

  const snapshot = await createDeveloperIncidentSnapshot()
  const blob = new Blob(
    [JSON.stringify(snapshot, null, 2)],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download =
    'Qwerty-Plus-Incident-' +
    new Date().toISOString().replace(/[:.]/g, '-') +
    '.json'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
