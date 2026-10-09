import Dexie from 'dexie'

declare global {
  interface Window {
    __legacyV5?: {
      db: Dexie
      opened: boolean
      versionChangeCount: number
      tryWordWrite(word: string): Promise<string>
    }
  }
}

// Model the code still running from the previous release in a browser tab.
// It does not participate in new S1 writer Web Locks or boot recovery.
const db = new Dexie('RecordDB')
db.version(5).stores({
  wordRecords: '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
  chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
  reviewRecords: '++id,dict,createTime,isFinished',
  reviewWordStates: '++id,&[dict+word],dict,word,nextReviewAt,[dict+nextReviewAt],lastReviewedAt',
  achievementEvents: '&eventId,sourceRecordId,occurredAt,dict,word',
  achievementStates: '&achievementId,unlockedAt,seenAt',
})

window.__legacyV5 = {
  db,
  opened: false,
  versionChangeCount: 0,
  async tryWordWrite(word: string): Promise<string> {
    try {
      await db.table('wordRecords').add({
        word, dict: 'cet4', chapter: 0, timeStamp: 1,
        timing: [100], wrongCount: 0, mistakes: {},
      })
      return 'WRITTEN'
    } catch (error) {
      return error instanceof Error ? error.name + ':' + error.message : String(error)
    }
  },
}
db.on('versionchange', () => {
  if (window.__legacyV5) window.__legacyV5.versionChangeCount++
  db.close()
})
void db.open().then(() => {
  if (window.__legacyV5) window.__legacyV5.opened = true
})
