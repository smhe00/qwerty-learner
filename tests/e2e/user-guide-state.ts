import type { Page } from '@playwright/test'

/** Compare durable learning/account content, excluding transient UI preferences. */
export async function readGuideLearningState(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      const names = Array.from(db.objectStoreNames).sort()
      const rows = await Promise.all(
        names.map(
          (name) =>
            new Promise((resolve, reject) => {
              const read = db.transaction(name).objectStore(name).getAll()
              read.onsuccess = () => resolve([name, read.result])
              read.onerror = () => reject(read.error)
            }),
        ),
      )
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
        .filter(
          (key) =>
            key.startsWith('qwerty.learn.dailySession.') ||
            ['reviewModeInfo', 'qwerty.cloudAuth.v1', 'currentDict', 'currentChapter'].includes(key),
        )
        .sort()
      return JSON.stringify({ rows, storage: keys.map((key) => [key, localStorage.getItem(key)]) })
    } finally {
      db.close()
    }
  })
}
