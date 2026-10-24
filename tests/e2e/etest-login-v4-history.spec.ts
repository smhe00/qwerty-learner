import { acknowledgeInformationDialog } from './information-dialog'
import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'

// Synthetic historical records in NEW disposable browser profiles only.
// Exercises the deployed account UI, never calls Sync/restore/merge directly.
const base = 'https://t.smhe.cn'
const names = ['wordRecords', 'chapterRecords', 'reviewRecords', 'reviewWordStates', 'achievementEvents', 'achievementStates']
async function request(path: string, method: string, body?: object, token?: string) {
  const r = await fetch(base + path, {
    method,
    redirect: 'error',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(40_000),
  })
  return { status: r.status, body: await r.json() }
}
async function account(page: Page) {
  await page.goto(base + '/?s1-account=manage', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-account]')).toBeVisible({ timeout: 60_000 })
}
async function login(page: Page, username: string, password: string) {
  await account(page)
  const toggle = page.getByRole('button', { name: '重新验证登录', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await page.getByLabel('用户名', { exact: true }).fill(username)
  await page.getByLabel('账户密码', { exact: true }).fill(password)
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/login')
  const reauth = page.getByRole('button', { name: '确认重新登录', exact: true })
  await ((await reauth.isVisible()) ? reauth : page.getByRole('button', { name: '登录', exact: true })).click()
  expect((await response).status()).toBe(200)
  await expect(page).toHaveURL(/^https:\/\/t\.smhe\.cn\/(?:learn)?$/, { timeout: 120_000 })
  await acknowledgeInformationDialog(page)
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 60_000 })
}
async function seed(page: Page, branch: string, all = false) {
  // Account UI is pre-mount: no React/learning writer exists during seeding.
  await account(page)
  return page.evaluate(
    async ({ all, branch, names }) => {
      const req = indexedDB.open('RecordDB')
      req.onupgradeneeded = () => req.transaction?.abort()
      const db = await new Promise<IDBDatabase>((ok, fail) => {
        req.onsuccess = () => ok(req.result)
        req.onerror = () => fail(req.error)
      })
      try {
        await new Promise<void>((ok, fail) => {
          const tx = db.transaction(names, 'readwrite')
          const words = tx.objectStore('wordRecords')
          const row = (i: number) => ({
            ...(i === 1 ? { attemptId: '00000000-0000-4000-8000-000000000091' } : {}),
            ...(i === 2 ? { sourceMode: 'typing' } : {}),
            word: 'historical-' + branch + '-' + i,
            dict: 'cet4',
            chapter: 0,
            timeStamp: 1_700_000_000 + i,
            timing: [100, 120],
            wrongCount: 0,
            mistakes: {},
          })
          if (!all) {
            const n = branch === 'left' ? 1 : 2
            const added = words.add(row(100 + n))
            // Both cloned profiles independently reuse review primary key 701.
            // These are different real-session UUIDs, with the current producer's
            // review:N / session:review:N:completed / continue:review:N keys.
            const sessionId = 'review:701'
            tx.objectStore('reviewRecords').add({
              id: 701,
              sessionId: `00000000-0000-4000-8000-00000000000${n}`,
              dict: 'cet4',
              createTime: 1_700_001_000 + n,
              index: 1,
              isFinished: true,
              words: [],
              sessionKind: 'review',
            })
            added.onsuccess = () => {
              tx.objectStore('achievementEvents').add({
                eventId: `session:${sessionId}:completed`,
                eventType: 'session_completed',
                origin: 'live',
                sessionId,
                sourceRecordIds: [added.result],
                occurredAt: 1_700_001_010 + n,
                dict: 'cet4',
                metricValues: {},
                unlockedAchievementIds: ['SYNTHETIC_SESSION_' + branch],
              })
              tx.objectStore('achievementEvents').add({
                eventId: `continue:${sessionId}`,
                eventType: 'continue_intent',
                origin: 'live',
                sessionId,
                occurredAt: 1_700_001_011 + n,
                dict: 'cet4',
                metricValues: { voluntary_continue_intent: 1 },
                unlockedAchievementIds: [],
              })
              tx.objectStore('achievementStates').add({
                achievementId: 'SYNTHETIC_SESSION_' + branch,
                unlockedAt: 1_700_001_010 + n,
                firstTriggerEventId: `session:${sessionId}:completed`,
                sourceRecordId: added.result,
                sessionId,
              })
            }
          } else {
            for (let i = 0; i < 3; i++) words.add(row(i))
            tx.objectStore('chapterRecords').add({
              dict: 'cet4',
              chapter: 0,
              timeStamp: 1_700_000_000,
              time: 12,
              correctCount: 3,
              wrongCount: 0,
            })
            for (let i = 0; i < 700; i++) {
              const shared = {
                name: 'historical-review-' + i,
                trans: ['中文🙂é'.repeat(160), 'synthetic history ' + i],
                ...(i === 0 ? { 'audit.date': new Date('2026-10-24T00:00:00Z') } : {}),
              }
              tx.objectStore('reviewRecords').add({
                dict: 'cet4',
                index: 0,
                createTime: 1_700_000_000 + i,
                isFinished: false,
                words: i === 38 ? [shared, shared] : [shared],
                sessionKind: 'review',
              })
            }
            tx.objectStore('reviewWordStates').add({
              dict: 'cet4',
              word: 'historical-review-0',
              createdAt: 1_700_000_000,
              updatedAt: 1_700_000_000,
              lastReviewedAt: 1_700_000_000,
              nextReviewAt: 1_701_000_000,
              reviewCount: 3,
              lapseCount: 0,
              cleanStreak: 3,
              lastOutcome: 'good',
              lifecycle: 'active',
              stateVersion: 4,
              schedulerState: { kind: 'basic-v2', stage: 4, intervalDays: 14 },
            })
            tx.objectStore('achievementEvents').add({
              eventId: 'synthetic-history-event',
              eventType: 'word_mastered',
              origin: 'live',
              sourceRecordId: 1,
              sessionId: 'synthetic-history',
              occurredAt: 1_700_000_000,
              dict: 'cet4',
              word: 'historical-seed-0',
              metricValues: { mastered_words: 1 },
              unlockedAchievementIds: ['SYNTHETIC_HISTORY'],
            })
            tx.objectStore('achievementStates').add({
              achievementId: 'SYNTHETIC_HISTORY',
              unlockedAt: 1_700_000_000,
              firstTriggerEventId: 'synthetic-history-event',
              sourceRecordId: 1,
              sessionId: 'synthetic-history',
            })
          }
          tx.oncomplete = () => ok()
          tx.onerror = () => fail(tx.error)
          tx.onabort = () => fail(tx.error)
        })
      } finally {
        db.close()
      }
    },
    { all, branch, names },
  )
}
async function evidence(page: Page) {
  return page.evaluate(async (names) => {
    const req = indexedDB.open('RecordDB')
    req.onupgradeneeded = () => req.transaction?.abort()
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      req.onsuccess = () => ok(req.result)
      req.onerror = () => fail(req.error)
    })
    const stable = (v: any): string =>
      v === null || typeof v !== 'object'
        ? JSON.stringify(v)
        : Array.isArray(v)
        ? '[' + v.map(stable).join(',') + ']'
        : '{' +
          Object.keys(v)
            .sort()
            .map((k) => JSON.stringify(k) + ':' + stable(v[k]))
            .join(',') +
          '}'
    try {
      const result: Record<string, { count: number; digest: string }> = {}
      let alias = false
      let unicodeExact = false
      let historyBytes = 0
      const facts: Record<string, string> = {}
      const originalFacts: Record<string, string> = {}
      const wordMap = new Map<number, string>()
      const reviewMap = new Map<string, any>()
      const sessionFacts: string[] = []
      for (const name of names) {
        const rows = await new Promise<any[]>((ok, fail) => {
          const r = db.transaction(name, 'readonly').objectStore(name).getAll()
          r.onsuccess = () => ok(r.result)
          r.onerror = () => fail(r.error)
        })
        if (name === 'wordRecords') rows.forEach((r: any) => wordMap.set(r.id, r.word))
        if (name === 'reviewRecords') {
          rows.forEach((r: any) => reviewMap.set('review:' + r.id, r))
          const r = rows.find((r: any) => r.createTime === 1_700_000_038)
          alias = r?.words[0] === r?.words[1]
          unicodeExact =
            rows.filter((r: any) => r.createTime >= 1_700_000_000 && r.createTime < 1_700_000_700).length === 700 &&
            rows.every((row: any) => row.words.every((word: any) => word.trans[0] === '中文🙂é'.repeat(160)))
          historyBytes = new TextEncoder().encode(JSON.stringify(rows)).byteLength
        }
        if (name === 'achievementEvents') {
          for (const event of rows.filter((e: any) => e.eventType === 'session_completed' || e.eventType === 'continue_intent')) {
            const review = reviewMap.get(event.sessionId)
            if (!review || !review.isFinished || review.dict !== event.dict) throw Error('Wrong restored session reference')
            const completed = event.eventType === 'session_completed'
            const expected = completed ? `session:${event.sessionId}:completed` : `continue:${event.sessionId}`
            if (event.eventId !== expected || event.occurredAt !== review.createTime + (completed ? 10 : 11))
              throw Error('Wrong restored session identity')
            if (completed) {
              const n = review.sessionId.endsWith('1') ? 1 : 2
              const expectedWord = n === 1 ? 'historical-left-101' : 'historical-right-102'
              if (event.sourceRecordIds.length !== 1 || wordMap.get(event.sourceRecordIds[0]) !== expectedWord)
                throw Error('Wrong session learning facts')
            }
            sessionFacts.push(event.eventType + ':' + review.sessionId)
          }
        }
        if (name === 'achievementStates') {
          for (const state of rows.filter((r: any) => r.achievementId.startsWith('SYNTHETIC_SESSION_'))) {
            const review = reviewMap.get(state.sessionId)
            if (!review || state.firstTriggerEventId !== `session:${state.sessionId}:completed`) throw Error('Wrong restored grant session')
            const branch = review.sessionId.endsWith('1') ? 'left' : 'right'
            if (state.achievementId !== 'SYNTHETIC_SESSION_' + branch) throw Error('Grant assigned to another session')
          }
        }
        const logicalRow = (source: any) => {
          const r = structuredClone(source)
          delete r.id
          if (r.sourceRecordId !== undefined) {
            if (!wordMap.has(r.sourceRecordId)) throw Error('Dangling restored history reference')
            r.sourceRecordId = wordMap.get(r.sourceRecordId)
          }
          return stable(r)
        }
        const logical = rows.map(logicalRow).sort()
        const originalRows = rows.filter((r: any) => {
          if (name === 'reviewRecords') return r.createTime >= 1_700_000_000 && r.createTime < 1_700_000_700
          if (name === 'achievementEvents') return r.eventId === 'synthetic-history-event'
          if (name === 'achievementStates') return r.achievementId === 'SYNTHETIC_HISTORY'
          return true
        })
        const originalHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(originalRows.map(logicalRow).sort())))
        originalFacts[name] = Array.from(new Uint8Array(originalHash), (b) => b.toString(16).padStart(2, '0')).join('')
        const factHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(logical)))
        facts[name] = Array.from(new Uint8Array(factHash), (b) => b.toString(16).padStart(2, '0')).join('')
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(rows)))
        result[name] = { count: rows.length, digest: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('') }
      }
      return {
        tables: result,
        facts,
        originalFacts,
        wordNames: Array.from(wordMap.values()).sort(),
        alias,
        unicodeExact,
        historyBytes,
        sessionFacts: sessionFacts.sort(),
      }
    } finally {
      db.close()
    }
  }, names)
}
async function meta(page: Page) {
  return page.evaluate(async () => {
    const auth = JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null')
    const r = await fetch('/api/sync/v2/meta', { cache: 'no-store', headers: { Authorization: 'Bearer ' + auth.token } })
    if (!r.ok) throw Error('metadata HTTP-' + r.status)
    return r.json()
  })
}

async function rawWords(page: Page): Promise<Array<Record<string, any>>> {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      request.onsuccess = () => ok(request.result)
      request.onerror = () => fail(request.error)
    })
    try {
      return await new Promise<Array<Record<string, any>>>((ok, fail) => {
        const rows = db.transaction('wordRecords').objectStore('wordRecords').getAll()
        rows.onsuccess = () => ok(rows.result)
        rows.onerror = () => fail(rows.error)
      })
    } finally {
      db.close()
    }
  })
}
async function syncDiagnostics(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem('qwerty.learning-sync-diagnostics.v1') || '[]') as Array<{
        stage: string
        status: string
        code?: string
      }>,
  )
}

test('historical six-table startup download and automatic divergent reauth converge both profiles', async ({ browser }, info) => {
  test.setTimeout(600_000)
  expect(process.env.GITHUB_REF_NAME).toBe('edgeone-test')
  expect(process.env.QWERTY_SYNC_BASE_URL).toBe(base + '/')
  const sha = process.env.GITHUB_SHA || ''
  expect(sha).toMatch(/^[a-f0-9]{40}$/)
  const source = await fetch(base + '/source-commit.txt?history=' + sha + '-' + Date.now())
  expect(source.status).toBe(200)
  const deployed = (await source.text()).trim()
  expect(deployed).toMatch(/^[a-f0-9]{7,40}$/)
  expect(sha.startsWith(deployed)).toBe(true)
  const health = await request('/api/health', 'GET')
  expect(health.body.authMode).toBe('single-active-session')
  const username = 'e2e_hist_' + process.env.GITHUB_RUN_ID + '_' + (process.env.GITHUB_RUN_ATTEMPT || '1')
  expect(username).toMatch(/^e2e_hist_\d+_\d+$/)
  const password = 'History-' + crypto.randomUUID()
  const contexts = await Promise.all([browser.newContext({ serviceWorkers: 'block' }), browser.newContext({ serviceWorkers: 'block' })])
  const pages = await Promise.all(contexts.map((c) => c.newPage()))
  pages.forEach((p) => p.on('dialog', (d) => d.accept()))
  let owner: string | undefined
  const failures: unknown[] = []
  const proof: Record<string, unknown> = { historicalFixture: true, source: deployed }
  try {
    const created = await request('/api/auth/register', 'POST', { username, password, deviceId: 'qwerty-web-' + crypto.randomUUID() })
    expect(created.status).toBe(201)
    owner = created.body.user.userId
    await login(pages[0], username, password)
    await seed(pages[0], 'seed', true)
    const original = await evidence(pages[0])
    expect(original.alias).toBe(true)
    expect(original.unicodeExact).toBe(true)
    expect(original.historyBytes).toBeGreaterThan(1024 * 1024)
    proof.unicodeHistoryBytes = original.historyBytes
    expect(Object.values(original.tables).map((t) => t.count)).toEqual([3, 1, 700, 1, 1, 1])
    const aRequests: string[] = []
    pages[0].on('request', (r) => {
      const p = new URL(r.url()).pathname
      if (p.startsWith('/api/sync/')) aRequests.push(r.method() + ' ' + p)
    })
    await login(pages[0], username, password)
    expect(aRequests).toContain('GET /api/sync/v2/meta')
    expect(aRequests).toContain('POST /api/sync/v2/binary/direct')
    expect(await evidence(pages[0])).toEqual(original)
    const first = await meta(pages[0])
    expect(first.revision).toBe(1)
    expect(first.clientFormatVersion).toBe('qwerty-backup-v4')
    await account(pages[0])
    const bRequests: string[] = []
    pages[1].on('request', (r) => {
      const p = new URL(r.url()).pathname
      if (p.startsWith('/api/sync/')) bRequests.push(r.method() + ' ' + p)
    })
    // Fail the single startup preflight. Keep local data and do not silently
    // retry an uncertain operation. A later ordinary entry checks cloud again.
    await pages[1].route(
      '**/api/sync/v2/meta',
      (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'synthetic_preflight_unavailable' }),
        }),
      { times: 1 },
    )
    await login(pages[1], username, password)
    expect(await pages[1].evaluate(() => sessionStorage.getItem('qwerty.s2.startup-check.v1'))).toBe('pending')
    expect(bRequests.filter((x) => x === 'GET /api/sync/v2/meta')).toHaveLength(1)
    expect(bRequests).not.toContain('GET /api/sync/v2/binary/manifest')
    expect(await rawWords(pages[1])).toHaveLength(0)
    await pages[1].goto(base + '/learn', { waitUntil: 'domcontentloaded' })
    await acknowledgeInformationDialog(pages[1])
    await expect(pages[1].getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 60_000 })
    expect(await pages[1].evaluate(() => sessionStorage.getItem('qwerty.s2.startup-check.v1'))).toBe('noop')
    proof.ordinaryStartupRecoveredFullV4 = true
    expect(bRequests).toContain('GET /api/sync/v2/meta')
    expect(bRequests).toContain('GET /api/sync/v2/binary/manifest')
    expect(bRequests).toContain('GET /api/sync/v2/binary/part')
    expect(await evidence(pages[1])).toEqual(original)
    bRequests.length = 0
    await pages[1].goto(base + '/learn', { waitUntil: 'domcontentloaded' })
    await expect.poll(() => bRequests.includes('GET /api/sync/v2/meta')).toBe(true)
    await acknowledgeInformationDialog(pages[1])
    await expect(pages[1].getByRole('button', { name: '开始 Learn', exact: true })).toBeVisible({ timeout: 60_000 })
    expect(await evidence(pages[1])).toEqual(original)
    proof.sixTablePullExact = true
    proof.sharedReferencePreserved = true
    await seed(pages[0], 'left')
    await seed(pages[1], 'right')
    await login(pages[1], username, password)
    const second = await meta(pages[1])
    expect(second.revision).toBe(2)
    await account(pages[1])
    aRequests.length = 0
    await login(pages[0], username, password)
    const merged = await evidence(pages[0])
    expect(merged.tables.wordRecords.count).toBe(5)
    expect(merged.alias).toBe(true)
    expect(merged.unicodeExact).toBe(true)
    proof.unicodeTranslationsExact = true
    expect(merged.wordNames).toEqual([...original.wordNames, 'historical-left-101', 'historical-right-102'].sort())
    for (const name of ['chapterRecords', 'reviewWordStates']) {
      expect(merged.tables[name].count).toBe(original.tables[name].count)
      expect(merged.facts[name]).toBe(original.facts[name])
    }
    for (const name of ['reviewRecords', 'achievementEvents', 'achievementStates']) {
      expect(merged.originalFacts[name], 'original history preserved: ' + name).toBe(original.facts[name])
    }
    expect(merged.tables.reviewRecords.count).toBe(702)
    expect(merged.tables.achievementEvents.count).toBe(5)
    expect(merged.tables.achievementStates.count).toBe(3)
    expect(merged.sessionFacts).toEqual(
      [1, 2]
        .flatMap((n) => ['continue_intent', 'session_completed'].map((type) => `${type}:00000000-0000-4000-8000-00000000000${n}`))
        .sort(),
    )
    proof.independentCompletedSessionsPreserved = true
    proof.sessionReferencesFollowOriginalUUID = true
    const third = await meta(pages[0])
    expect(third.revision).toBe(second.revision + 1)
    expect(aRequests).toContain('GET /api/sync/v2/binary/manifest')
    expect(aRequests).toContain('POST /api/sync/v2/binary/direct')
    const archives = await pages[0].evaluate(async () => {
      const open = indexedDB.open('QwertyPlusWorkspaceVaultV1')
      const vault = await new Promise<IDBDatabase>((ok, fail) => {
        open.onsuccess = () => ok(open.result)
        open.onerror = () => fail(open.error)
      })
      try {
        const saved = await new Promise<any[]>((ok, fail) => {
          const request = vault.transaction('snapshots').objectStore('snapshots').getAll()
          request.onsuccess = () => ok(request.result)
          request.onerror = () => fail(request.error)
        })
        return saved
          .filter((r) => r.key.startsWith('auto-v4-merge:'))
          .map((r) => {
            const tables = JSON.parse(r.json).workspaceData.database.data.data
            return tables
              .find((t: any) => t.tableName === 'wordRecords')
              .rows.map((w: any) => w.word)
              .sort()
          })
      } finally {
        vault.close()
      }
    })
    const leftWord = 'historical-left-101',
      rightWord = 'historical-right-102'
    expect(archives.some((words) => words.length === 4 && words.includes(leftWord) && !words.includes(rightWord))).toBe(true)
    expect(archives.some((words) => words.length === 4 && words.includes(rightWord) && !words.includes(leftWord))).toBe(true)
    expect(archives.some((words) => words.length === 5 && words.includes(leftWord) && words.includes(rightWord))).toBe(true)
    proof.automaticForkMergedBoth = true
    proof.originalForkArchivesPreserved = true
    const diagnosticStages = await pages[0].evaluate(
      () => JSON.parse(sessionStorage.getItem('qwerty.perf-diagnostics.v1') || '[]') as Array<{ stage: string; outcome?: string }>,
    )
    for (const stage of [
      'merge-download',
      'merge-verify-cloud',
      'merge-decode-local',
      'merge-decode-cloud',
      'merge-records',
      'merge-decode-candidate',
      'merge-build',
      'merge-archive',
      'merge-upload',
      'merge-stage-journal',
    ]) {
      expect(
        diagnosticStages.some((row) => row.stage === stage && row.outcome === 'ok'),
        stage,
      ).toBe(true)
    }
    proof.automaticMergeStageEvidence = true
    const priorFailures = await pages[1].evaluate(
      () => JSON.parse(sessionStorage.getItem('qwerty.perf-diagnostics.v1') || '[]') as Array<{ stage: string; outcome?: string }>,
    )
    expect(priorFailures.some((row) => row.stage === 'remote-meta' && row.outcome === 'failed')).toBe(true)
    proof.failedMetadataStageRecorded = true

    await account(pages[0])
    await login(pages[1], username, password)
    expect(await evidence(pages[1])).toEqual(merged)
    proof.sixTableForkConvergence = true
    bRequests.length = 0
    await pages[1].goto(base + '/learn', { waitUntil: 'domcontentloaded' })
    await acknowledgeInformationDialog(pages[1])
    await expect(pages[1].getByRole('button', { name: '开始 Learn', exact: true })).toBeVisible({ timeout: 60_000 })
    expect(await evidence(pages[1])).toEqual(merged)
    expect((await meta(pages[1])).revision).toBe(third.revision)
    expect(bRequests.filter((x) => x.startsWith('POST '))).toEqual([])
    proof.repeatedStartupNoDuplicateWrite = true
    proof.mergedWordRecords = merged.tables.wordRecords.count
    proof.counts = Object.fromEntries(Object.entries(original.tables).map(([k, v]) => [k, v.count]))

    // One real Learn attempt amidst five untouched historical rows. Only M3
    // publishes it; unchanged V4 metadata proves the receiver must use M4.
    const historicalRows = await rawWords(pages[1])
    await pages[1].getByRole('button', { name: '开始 Learn', exact: true }).click()
    const word = pages[1].locator('[data-typing-word]').first()
    await expect(word).toBeVisible()
    const spelling = await word.getAttribute('data-typing-word')
    expect(spelling).toBeTruthy()
    if (
      await pages[1]
        .getByText('按任意键开始')
        .isVisible()
        .catch(() => false)
    )
      await pages[1].keyboard.press('a')
    await pages[1].keyboard.type(spelling!)
    await expect.poll(async () => (await rawWords(pages[1])).length, { timeout: 50_000 }).toBe(6)
    const modern = (await rawWords(pages[1])).find((r) => !String(r.word).startsWith('historical-'))!
    expect(modern.attemptId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    await expect
      .poll(
        async () => (await syncDiagnostics(pages[1])).some((e) => e.stage === 'm3-publication' && e.status === 'uploaded-events-only'),
        { timeout: 60_000 },
      )
      .toBe(true)
    expect(bRequests).toContain('POST /api/sync/events/v2')
    expect(bRequests).not.toContain('POST /api/sync/v2/binary/direct')
    expect((await meta(pages[1])).revision).toBe(third.revision)
    proof.mixedLegacyM3Publication = true
    await account(pages[1])
    await login(pages[0], username, password)
    const received = await rawWords(pages[0])
    expect(received.filter((r) => r.attemptId === modern.attemptId)).toHaveLength(1)
    expect(received.filter((r) => String(r.word).startsWith('historical-'))).toEqual(historicalRows)
    expect((await syncDiagnostics(pages[0])).some((e) => e.stage === 'm4-adoption' && e.status === 'adopted')).toBe(true)
    proof.mixedLegacyM4Adoption = true
    proof.legacyRowsUnchanged = true

    // Reproduce the owner's ordinary logout/login with no intervening study.
    await account(pages[0])
    await pages[0].getByRole('button', { name: '安全退出登录', exact: true }).click()
    await expect(pages[0]).toHaveURL(/^https:\/\/t\.smhe\.cn\/(?:learn)?$/, { timeout: 120_000 })
    await acknowledgeInformationDialog(pages[0])
    await expect(pages[0].getByRole('button', { name: '打开设置对话框' })).toBeVisible()
    expect(await pages[0].evaluate(() => localStorage.getItem('qwerty.cloudAuth.v1'))).toBeNull()
    expect(await rawWords(pages[0])).toHaveLength(0)
    proof.logoutRestoresEmptyAnonymousWorkspace = true
    await pages[0].evaluate(() => {
      sessionStorage.removeItem('qwerty.perf-diagnostics.v1')
      sessionStorage.removeItem('qwerty.etest.m4.stageTrace.v1')
    })
    aRequests.length = 0
    const loginStarted = Date.now()
    await login(pages[0], username, password)
    const loginElapsedMs = Date.now() - loginStarted
    const startupPerformance = await pages[0].evaluate(() => JSON.parse(sessionStorage.getItem('qwerty.perf-diagnostics.v1') || '[]'))
    expect(startupPerformance.filter((s: any) => s.stage === 'account-sync')).toHaveLength(1)
    expect(startupPerformance.filter((s: any) => s.stage === 'm3-publication')).toHaveLength(1)
    expect(startupPerformance.filter((s: any) => s.stage === 'm4-witness')).toHaveLength(1)
    expect(startupPerformance.filter((s: any) => s.stage === 'm4-capture' || s.stage === 'm4-transaction')).toHaveLength(0)
    expect(aRequests.filter((x) => x === 'GET /api/sync/v2/meta')).toHaveLength(1)
    expect(aRequests.filter((x) => x === 'GET /api/sync/events/v2')).toHaveLength(0)
    expect((await syncDiagnostics(pages[0])).some((e) => e.code === 'verified-prefix-already-local')).toBe(true)
    proof.unchangedLogin = {
      elapsedMs: loginElapsedMs,
      fullV4Checks: 1,
      publications: 1,
      witnessedChecks: 1,
      repeatedEventDownloads: 0,
      extraM4Captures: 0,
      stages: startupPerformance.map(({ stage, elapsedMs, outcome }: any) => ({ stage, elapsedMs, outcome })),
    }
    expect(await rawWords(pages[0])).toEqual(received)
    const notices = (await pages[0].getByRole('status').allTextContents()).join(' ')
    expect(notices).not.toMatch(/V4|事件发布|安全检查阻止|格式|暂未同步/)
    proof.reloginWithoutLearningPreservesAllRows = true
    proof.noLegacyWarningInOrdinaryUI = true

    // Export via the shipped settings UI; retain only counts in CI artifacts.
    await pages[0].getByRole('button', { name: '打开设置对话框' }).click()
    await pages[0].getByRole('tab', { name: '开发诊断' }).click()
    const download = pages[0].waitForEvent('download')
    await pages[0].getByRole('button', { name: '导出现场诊断包', exact: true }).click()
    const downloaded = await download
    const bundle = JSON.parse(await readFile((await downloaded.path())!, 'utf8'))
    expect(bundle.synchronization.currentRecords).toEqual({
      scanned: 6,
      eligible: 1,
      snapshotOnly: 5,
      rejected: 0,
      issues: { 'missing-attempt-id': 4, 'missing-source-mode': 4 },
    })
    expect(bundle.synchronization.recoveryStatus).toBe('ready')
    expect(await rawWords(pages[0])).toEqual(received)
    proof.diagnosticExportReadOnly = true
    proof.legacyCompatibilityCounts = bundle.synchronization.currentRecords
  } catch (e) {
    failures.push(e)
    proof.applicationFailed = true
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close()))
    try {
      if (owner) {
        const fresh = await request('/api/auth/login', 'POST', { username, password, deviceId: 'qwerty-web-' + crypto.randomUUID() })
        expect(fresh.status).toBe(200)
        expect(fresh.body.user.userId === owner).toBe(true)
        const removed = await request('/api/auth/account', 'DELETE', { currentPassword: password }, fresh.body.token)
        proof.cleanupStatus = removed.status
        expect(removed.status).toBe(200)
        expect(removed.body.deleted?.accountDeleted).toBe(true)
        proof.cleanupVerified = true
      }
    } catch (e) {
      failures.push(e)
      proof.cleanupFailed = true
    }
    await writeFile(info.outputPath('login-history-redacted-trace.json'), JSON.stringify(proof, null, 2))
    console.log('LOGIN_HISTORY_REDACTED', JSON.stringify(proof))
  }
  if (failures.length) throw new AggregateError(failures, failures.map((e) => (e instanceof Error ? e.stack : String(e))).join('\n'))
})
