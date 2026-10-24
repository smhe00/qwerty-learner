import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

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
  await expect(page).toHaveURL(base + '/', { timeout: 120_000 })
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
            word: 'historical-' + branch + '-' + i,
            dict: 'cet4',
            chapter: 0,
            timeStamp: 1_700_000_000 + i,
            timing: [100, 120],
            wrongCount: 0,
            mistakes: {},
          })
          if (!all) words.add(row(branch === 'left' ? 101 : 102))
          else {
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
      const wordMap = new Map<number, string>()
      for (const name of names) {
        const rows = await new Promise<any[]>((ok, fail) => {
          const r = db.transaction(name, 'readonly').objectStore(name).getAll()
          r.onsuccess = () => ok(r.result)
          r.onerror = () => fail(r.error)
        })
        if (name === 'wordRecords') rows.forEach((r: any) => wordMap.set(r.id, r.word))
        if (name === 'reviewRecords') {
          const r = rows.find((r: any) => r.createTime === 1_700_000_038)
          alias = r?.words[0] === r?.words[1]
          unicodeExact =
            rows.length === 700 && rows.every((row: any) => row.words.every((word: any) => word.trans[0] === '中文🙂é'.repeat(160)))
          historyBytes = new TextEncoder().encode(JSON.stringify(rows)).byteLength
        }
        const logical = rows
          .map((source: any) => {
            const r = structuredClone(source)
            delete r.id
            if (r.sourceRecordId !== undefined) {
              if (!wordMap.has(r.sourceRecordId)) throw Error('Dangling restored history reference')
              r.sourceRecordId = wordMap.get(r.sourceRecordId)
            }
            return stable(r)
          })
          .sort()
        const factHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(logical)))
        facts[name] = Array.from(new Uint8Array(factHash), (b) => b.toString(16).padStart(2, '0')).join('')
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(rows)))
        result[name] = { count: rows.length, digest: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('') }
      }
      return { tables: result, facts, wordNames: Array.from(wordMap.values()).sort(), alias, unicodeExact, historyBytes }
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
    // Lose ONLY the login preflight. The fresh ordinary root startup must
    // independently fetch/download the cloud V4 with the still-valid session.
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
    expect(await pages[1].evaluate(() => sessionStorage.getItem('qwerty.s2.startup-check.v1'))).toBe('noop')
    proof.ordinaryStartupRecoveredFullV4 = true
    expect(bRequests).toContain('GET /api/sync/v2/meta')
    expect(bRequests).toContain('GET /api/sync/v2/binary/manifest')
    expect(bRequests).toContain('GET /api/sync/v2/binary/part')
    expect(await evidence(pages[1])).toEqual(original)
    bRequests.length = 0
    await pages[1].goto(base + '/learn', { waitUntil: 'domcontentloaded' })
    await expect.poll(() => bRequests.includes('GET /api/sync/v2/meta')).toBe(true)
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
    for (const name of names.filter((name) => name !== 'wordRecords')) {
      expect(merged.tables[name].count).toBe(original.tables[name].count)
      expect(merged.facts[name]).toBe(original.facts[name])
    }
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
    await account(pages[0])
    await login(pages[1], username, password)
    expect(await evidence(pages[1])).toEqual(merged)
    proof.sixTableForkConvergence = true
    bRequests.length = 0
    await pages[1].goto(base + '/learn', { waitUntil: 'domcontentloaded' })
    await expect(pages[1].getByRole('button', { name: '开始 Learn', exact: true })).toBeVisible({ timeout: 60_000 })
    expect(await evidence(pages[1])).toEqual(merged)
    expect((await meta(pages[1])).revision).toBe(third.revision)
    expect(bRequests.filter((x) => x.startsWith('POST '))).toEqual([])
    proof.repeatedStartupNoDuplicateWrite = true
    proof.mergedWordRecords = merged.tables.wordRecords.count
    proof.counts = Object.fromEntries(Object.entries(original.tables).map(([k, v]) => [k, v.count]))
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
